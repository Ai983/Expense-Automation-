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
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const server = http.createServer(app);

// ── WebSocket server for real-time finance dashboard updates ──────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
const financeClients = new Set();

wss.on('connection', (ws) => {
  financeClients.add(ws);
  ws.on('close', () => financeClients.delete(ws));
  ws.on('error', (err) => {
    console.error('WebSocket client error:', err.message);
    financeClients.delete(ws);
  });
  // Send heartbeat every 30s to keep connection alive
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'HagerStone live updates active' }));
});

/** Broadcast a new expense event to all connected finance dashboard clients */
export function broadcastNewExpense(expenseData) {
  const message = JSON.stringify({ type: 'NEW_EXPENSE', data: expenseData });
  for (const ws of financeClients) {
    if (ws.readyState === 1) {
      ws.send(message);
    }
  }
}

/** Broadcast a new imprest request event to all connected finance dashboard clients */
export function broadcastNewImprest(data) {
  const payload = JSON.stringify({ type: 'new_imprest', data });
  for (const ws of financeClients) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

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
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
