-- 039_ai_audit.sql
-- AI Expense Auditor — replaces the manual expense checker.
--
-- Adds the AI verdict columns to finance.expenses, a partial index that drives
-- the sweeper queue, and the system employee row used as approved_by when the
-- AI auto-approves (keeps the existing approved_by FK and every dashboard join
-- working unchanged; ai_auto_approved distinguishes it from a human approval).
--
-- The expenses.status enum is deliberately NOT changed:
--   AI approve      -> 'approved'
--   AI reject       -> 'manual_review'  (never auto-rejected)
--   AI needs_human  -> 'manual_review'
--
-- Safe to re-run.

ALTER TABLE finance.expenses
  ADD COLUMN IF NOT EXISTS ai_verdict text
    CHECK (ai_verdict IN ('approve', 'reject', 'needs_human', 'error')),
  ADD COLUMN IF NOT EXISTS ai_confidence numeric,
  ADD COLUMN IF NOT EXISTS ai_audit jsonb,
  ADD COLUMN IF NOT EXISTS ai_audited_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_auto_approved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN finance.expenses.ai_verdict IS
  'AI auditor verdict: approve | reject | needs_human | error. reject is a RECOMMENDATION only — the AI never sets status=rejected.';
COMMENT ON COLUMN finance.expenses.ai_audit IS
  'Full structured audit result: reasoning, fraud_signals[], category/purpose/attachment match, suggested_adjusted_amount, rejection_reason_draft, reconciliation_note.';
COMMENT ON COLUMN finance.expenses.ai_auto_approved IS
  'true when the AI auditor (not a human) moved this expense to approved.';

-- Sweeper queue: un-audited rows that are still actionable.
CREATE INDEX IF NOT EXISTS idx_expenses_ai_pending
  ON finance.expenses (submitted_at)
  WHERE ai_verdict IS NULL AND status IN ('pending', 'verified', 'manual_review');

-- Filter/badge lookups from the dashboard queue.
CREATE INDEX IF NOT EXISTS idx_expenses_ai_verdict
  ON finance.expenses (ai_verdict)
  WHERE ai_verdict IS NOT NULL;

-- System actor for AI auto-approvals.
-- auth_id stays NULL and status='inactive' so it can never log in.
INSERT INTO finance.employees (id, email, name, site, role, status)
VALUES (
  '00000000-0000-4000-a000-000000000a1a',
  'ai-auditor@system.local',
  'AI Auditor',
  'Head Office',
  'finance',
  'inactive'
)
ON CONFLICT (id) DO NOTHING;
