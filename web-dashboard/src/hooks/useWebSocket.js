import { useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000';

/**
 * Maintains a WebSocket connection to the backend.
 * Calls onNewExpense(data) whenever a NEW_EXPENSE event arrives.
 * Calls onNewImprest(data) whenever a new_imprest event arrives.
 * Automatically reconnects with exponential backoff.
 */
export function useWebSocket(onNewExpense, onNewImprest) {
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelay = useRef(1000);

  useEffect(() => {
    let mounted = true;

    async function connect() {
      if (!mounted) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const ws = new WebSocket(`${WS_URL}/ws?token=${session.access_token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay.current = 1000; // reset backoff on successful connect
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'NEW_EXPENSE' && onNewExpense) {
            onNewExpense(msg.data);
          }
          if (msg.type === 'new_imprest' && onNewImprest) {
            onNewImprest(msg.data);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      mounted = false;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [onNewExpense, onNewImprest]);
}
