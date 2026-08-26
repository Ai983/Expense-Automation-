import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';

import authRoutes from './routes/auth.js';
import expenseRoutes from './routes/expenses.js';
import dashboardRoutes from './routes/dashboard.js';
import employeeRoutes from './routes/employees.js';
import imprestRoutes from './routes/imprest.js';
import reportRoutes from './routes/reports.js';
import whatsappWebhookRoutes from './routes/whatsappWebhook.js';
import feedbackRoutes from './routes/feedback.js';
import poPaymentsRoutes from './routes/poPayments.js';
import woPaymentsRoutes from './routes/woPayments.js';
import prqPaymentsRoutes from './routes/prqPayments.js';
import headRoutes from './routes/head.js';
import projectRoutes from './routes/projects.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sweepPendingAudits } from './services/aiAuditService.js';
import {
  registerClient,
  unregisterClient,
  broadcastNewExpense,
  broadcastNewImprest,
  broadcastAiAudit,
} from './services/wsHub.js';
import { AI_AUDIT_MODE, AI_AUDIT_MODEL, AI_AUDIT_SWEEP_INTERVAL_MS } from './config/constants.js';

const app = express();
const server = http.createServer(app);

// ── WebSocket server for real-time finance dashboard updates ──────────────────
// The client registry and broadcasters live in services/wsHub.js so services
// and scripts can broadcast without importing this file (which would start a
// second HTTP server as a side effect).
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  registerClient(ws);
  ws.on('close', () => unregisterClient(ws));
  ws.on('error', (err) => {
    console.error('WebSocket client error:', err.message);
    unregisterClient(ws);
  });
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'HagerStone live updates active' }));
});

// Re-exported for the existing importers in routes/.
export { broadcastNewExpense, broadcastNewImprest, broadcastAiAudit };

// ── Express middleware ────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, React Native)
      if (!origin) return callback(null, true);
      // Allow any vercel.app or railway.app deployment (covers preview URLs too)
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.endsWith('.railway.app')
      ) {
        return callback(null, true);
      }
      // Deny but return null (not an Error) to avoid 500
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'HagerStone Expense API', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/imprest', imprestRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/whatsapp', whatsappWebhookRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/po-payments', poPaymentsRoutes);
app.use('/api/wo-payments', woPaymentsRoutes);
app.use('/api/prq-payments', prqPaymentsRoutes);
app.use('/api/head', headRoutes);
app.use('/api/projects', projectRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000');
server.listen(PORT, () => {
  console.log(`\n🚀 HagerStone Expense API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   AI expense audit: ${AI_AUDIT_MODE}${AI_AUDIT_MODE !== 'off' ? ` (${AI_AUDIT_MODEL})` : ''}\n`);

  // Background sweeper — audits anything the inline pass missed (API outage,
  // restart mid-submission) and works through the existing backlog. This is a
  // single long-running process, so an interval is sufficient; the shared-secret
  // endpoint POST /api/expenses/internal/ai-audit-sweep is the manual fallback.
  if (AI_AUDIT_MODE !== 'off') {
    const timer = setInterval(() => {
      sweepPendingAudits().catch((err) => console.warn('AI audit sweep failed:', err.message));
    }, AI_AUDIT_SWEEP_INTERVAL_MS);
    timer.unref?.();
  }
});
