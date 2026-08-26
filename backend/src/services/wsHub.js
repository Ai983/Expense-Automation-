/**
 * WebSocket client registry and broadcasters.
 *
 * These live outside index.js on purpose: index.js starts an HTTP server as a
 * side effect of being imported, so anything that merely needs to broadcast
 * (a service, a maintenance script, a worker) must not have to import it.
 * index.js registers connections here and re-exports these functions.
 */

const financeClients = new Set();

export function registerClient(ws) {
  financeClients.add(ws);
}

export function unregisterClient(ws) {
  financeClients.delete(ws);
}

function send(type, data) {
  const payload = JSON.stringify({ type, data });
  for (const ws of financeClients) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

/** Broadcast a new expense event to all connected finance dashboard clients */
export function broadcastNewExpense(expenseData) {
  send('NEW_EXPENSE', expenseData);
}

/** Broadcast a new imprest request event to all connected finance dashboard clients */
export function broadcastNewImprest(data) {
  send('new_imprest', data);
}

/** Broadcast an AI audit result so the finance queue updates the row in place */
export function broadcastAiAudit(data) {
  send('ai_audit_complete', data);
}
