# HagerStone Expense Tracker – Setup Guide

Follow these steps so the app works in the browser and on your phone (iOS/Android).

**Backend `.env`** has been updated with your Supabase **service_role** key and **JWT secret**. You only need to do the steps below in the Supabase Dashboard and run the backend.

---

## 1. Supabase database (required)

Your app already has Supabase URL and anon key in `mobile-app/.env`. You still need to create the tables and RLS in your Supabase project.

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **SQL Editor** → **New query**.
3. Run the scripts in this order:
   - Copy/paste and run **`database/001_schema.sql`** (tables).
   - Then copy/paste and run **`database/002_rls_policies.sql`** (RLS policies).

After this, your Supabase database is ready. No need to “setup Supabase” again unless you create a new project.

---

## 1b. Supabase Storage (required for expense screenshots)

The app stores payment screenshots in Supabase Storage. Create one bucket:

1. In Supabase Dashboard go to **Storage** (left sidebar).
2. Click **New bucket**.
3. Set **Name** to exactly: `expense-screenshots`
4. Leave it **Private**.
5. Click **Create bucket**.

---

## 2. Backend API (required for register/login)

The **request timed out** and **POST .../api/auth/register net::ERR_CONNECTION_TIMED_OUT** happen because the app calls a backend at `EXPO_PUBLIC_API_BASE_URL` and that server is not running or not reachable.

1. **Backend env**
   - `backend/.env` is already filled with your **service_role** key and **JWT secret**.
   - CORS includes `http://localhost:8081` for Expo web. If you use a different port or your PC IP for the app, add it to `CORS_ORIGINS` in `backend/.env`.

2. **Run the backend**
   - From project root:
     ```bash
     cd backend
     npm install
     npm run dev
     ```
   - You should see: `HagerStone Expense API running on port 4000`.

3. **Make sure the app uses the right API URL**
   - **Web (localhost):** In `mobile-app/.env` use:
     - `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000`
   - **Phone (same Wi‑Fi as your PC):**
     - Find your PC’s IP (e.g. Windows: `ipconfig` → IPv4, e.g. `192.168.1.100`).
     - In `mobile-app/.env` use:
       - `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.100:4000`
       - (Use your real IP; the phone must be able to reach this address.)
   - Restart Expo after changing `.env` (`npm start` in `mobile-app/`).

---

## 2b. Finance admin panel (dashboard and expense queue)

**There are two different apps:**

| App | URL | Who uses it |
|-----|-----|-------------|
| **Employee app** (Expo) | `http://localhost:8081` | Employees: Submit Expense, History, Profile |
| **Finance dashboard** (Vite) | `http://localhost:5173` | Finance/Admin: Expense Queue, Dashboard, approve/reject |

The screen with **Submit Expense** and **Submit / History / Profile** tabs is the **employee app**. To see the **dashboard and expense queue**, you must open the **finance dashboard** app.

1. **Start the finance dashboard** (if not already running):
   ```bash
   cd web-dashboard
   npm install
   npm run dev
   ```
2. **Open in your browser:** `http://localhost:5173`
3. **Log in** with your finance user (e.g. `finance@hagerstone.com`). After login you will see:
   - **Expense Queue** – list of expenses to review, approve, or reject
   - **Dashboard** – overview and stats (link in the sidebar)

**Backend** must be running (`cd backend` then `npm run dev`) so the dashboard can load expenses. Ensure `web-dashboard/.env` has `VITE_API_BASE_URL=http://localhost:4000`.

---

## 3. iOS: “There was a problem running the requested app” / “The request timed out”

This is usually one of two things:

**A) Metro (JS bundle) timeout**

- iPhone and the computer running `npm start` must be on the **same Wi‑Fi**.
- In the Expo terminal you’ll see something like `exp://192.168.x.x:8081`. The IP must be your computer’s IP. If it’s wrong, start with:
  ```bash
  npx expo start --tunnel
  ```
  and scan the new QR code (slower but works across networks).

**B) API timeout (after the app loads)**

- Same as in section 2: backend must be running and `EXPO_PUBLIC_API_BASE_URL` in `mobile-app/.env` must be the URL the phone can reach (your PC’s IP + `:4000` if testing on LAN).

---

## Quick checklist

| Step | Action |
|------|--------|
| Supabase DB | Run `database/001_schema.sql` and `002_rls_policies.sql` in Supabase SQL Editor. |
| Supabase Storage | In Dashboard → Storage → **New bucket** → name: `expense-screenshots` (private). |
| Backend | `cd backend` → `npm run dev` (`.env` already has service_role + JWT). |
| Web | `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000` in `mobile-app/.env`. |
| Phone | Same Wi‑Fi; `EXPO_PUBLIC_API_BASE_URL=http://YOUR_PC_IP:4000`; restart Expo. |
| iOS timeout | Same Wi‑Fi; or run `npx expo start --tunnel` and scan the new QR code. |

**Authentication:** "No users in your project" in Supabase Auth is normal until someone registers through the app. No extra Auth configuration is required for email/password sign-up.

Once Supabase is set up and the backend is running with the correct API URL in `.env`, the registration timeout and the iOS “request timed out” issue should be resolved.
