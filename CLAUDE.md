# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Monorepo for an AI-powered employee expense tracking system with three independent applications:
- **backend/** — Express.js REST API + WebSocket server (port 4000)
- **mobile-app/** — React Native (Expo) app for employees (port 8081)
- **web-dashboard/** — React + Vite dashboard for finance team (port 5173)
- **database/** — Supabase SQL migrations

## Development Commands

Each app has its own `node_modules` — run commands from the respective subdirectory.

### Backend
```bash
cd backend
npm install
npm run dev      # nodemon watch mode
npm start        # production
```

### Mobile App
```bash
cd mobile-app
npm install
npm start        # Expo dev server (web default)
npm run android
npm run ios
npm run web
```

### Web Dashboard
```bash
cd web-dashboard
npm install
npm run dev      # Vite dev server
npm run build
npm run preview
```

**No test or lint scripts are configured in any package.json.**

## Architecture

### Startup Order
Backend must start first (port 4000), then mobile-app and/or web-dashboard. The web dashboard Vite config proxies `/api` and `/ws` to the backend.

### Authentication Flow
1. Supabase Auth handles credential verification and issues JWT tokens
2. Backend `auth.js` middleware verifies JWT and loads the employee profile from the `employees` table
3. `roleGuard.js` middleware restricts routes by role: `employee`, `finance`, `manager`, `admin`
4. Two Supabase clients in `backend/src/config/supabase.js`: admin client (service role key) for backend ops, anon client for client-side auth

### Expense Submission Pipeline
1. Employee uploads screenshot + metadata → Multer handles file, Supabase Storage stores it
2. Google Vision API OCR extracts receipt data (`services/visionService.js`)
3. Verification service scores the expense across 4 checks (`services/verificationService.js`):
   - Amount match vs submitted (40 pts, ₹10 tolerance)
   - Date within 2 days of submission (20 pts)
   - Payment status = "SUCCESS" (30 pts)
   - Valid transaction ID (10 pts)
   - Final confidence = 70% × weighted_score + 30% × OCR confidence
4. Duplicate detection runs 5 rules (`services/duplicateService.js`):
   - Same transaction ID in 7 days → BLOCK
   - Same amount + site + same day → WARN
   - Same amount + site in 3 days → WARN
   - 3+ failures/blocks in 24h → BLOCK
5. Status assigned: `auto_verified` (≥94%), `manual_review` (70–93%), `blocked` (<70% or duplicate)
6. WebSocket broadcasts new expense to finance dashboard

### Expense Status Lifecycle
`pending` → `verified` (auto) or `manual_review` → `approved` / `rejected` by finance
`blocked` is terminal (set automatically)

### Real-time Updates
Backend creates a WebSocket server at `/ws` in `index.js`. Finance dashboard subscribes via `web-dashboard/src/hooks/useWebSocket.js` for live expense queue updates.

### Database
PostgreSQL via Supabase. Run migrations in order: `001_schema.sql` → `002_rls_policies.sql` → `003_indexes.sql` → `004_seed_data.sql`. Row-level security is enforced — RLS policies must be applied for the app to function correctly.

Key tables: `employees`, `expenses` (with `screenshot_metadata` JSONB), `verification_logs`, `audit_trail`.

Expense ref IDs use format `HSE-YYYYMMDD-XXXX` (generated in `backend/src/utils/refIdGenerator.js`).

### Response Conventions
Backend uses `ok()` and `fail()` helpers from `backend/src/utils/responseHelper.js` for all API responses. All significant user actions are logged via `services/auditService.js` to the `audit_trail` table.

## Environment Setup

Each app requires its own `.env` file. Key variables:

**backend/.env**
```
PORT=4000
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
JWT_SECRET=...
GOOGLE_APPLICATION_CREDENTIALS=./config/service-account.json
VISION_PROJECT_ID=...
CONFIDENCE_AUTO_APPROVE=94
CONFIDENCE_MANUAL_REVIEW=70
CORS_ORIGINS=http://localhost:5173,http://localhost:3000,http://localhost:8081
```

**mobile-app/.env**: `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000`
**web-dashboard/.env**: `VITE_API_BASE_URL=http://localhost:4000`

Google Vision API requires a service account JSON file at `backend/config/service-account.json`. If Vision API fails, expenses default to `manual_review` status.
