export const SITES = [
  'Head Office',
  'Andritz',
  'Theon Lifescience',
  'Consern Pharma',
  'Bhuj',
  'Kotputli Project',
  'Bansal Tower Gurugram',
  'VinFast',
  'Minebea Mitsumi',
  'Chattargarh',
  'Valorium',
  'Jasrasar',
  'Hanumangarh',
  'Himalaya',
  'Microsave',
  'Bangalore Branch Office',
  'Vinfast-Ghaziabad',
  'AU Space Office Ludhiana',
  'Vinfast - Patparganj',
  'Vinfast Jaipur',
  'Auma India Bengaluru',
  'Vaneet Infra',
  'MAX Hospital, Saket Delhi',
  'Dee Foundation Omaxe, Faridabad',
  'Hero Homes Ludhiana',
  'Delhi NCR',
  'M3M',
  'Vinfast Jikarpur',
];

export const CATEGORIES = [
  'Food Expense',
  'Site Room',
  'Travelling',
  'Software',
  'Labour Expense',
  'Site Expense',
  'Office Expense',
  'Employee Welfare',
  'DA- Expense',
  'BT- Expense',
  'Porter Expenses',
];

export const ROLES = ['employee', 'finance', 'manager', 'admin', 'approver_s1', 'approver_s2', 'procurement_finance', 'head', 'founder'];

export const FINANCE_ROLES = ['finance', 'manager', 'admin'];

// Multi-stage approval roles
export const S1_ROLES = ['approver_s1', 'admin'];
export const S2_ROLES = ['approver_s2', 'admin'];
export const S3_ROLES = ['finance', 'manager', 'admin'];
export const FOUNDER_ROLES = ['founder', 'admin'];
export const ALL_DASHBOARD_ROLES = ['approver_s1', 'approver_s2', 'finance', 'manager', 'admin', 'head'];

// Head role — read-only across all modules
export const HEAD_ROLES = ['head', 'admin'];

// Finance roles + head (for read-only GET routes that finance views)
export const FINANCE_HEAD_ROLES = ['finance', 'manager', 'admin', 'head'];

// ── Payment Requests (PRQ) — the compliance-gated queue from CPS ──────────────
// These are deliberately built from roles that EXIST in finance.employees.
// The wider lists above still name manager/admin/head/procurement_finance, none
// of which any live employee holds — guarding PRQ with those made the feature
// reachable by exactly one person.
//
// SINGLE SOURCE OF TRUTH. The API guards in routes/prqPayments.js and the
// dashboard sidebar both derive from these two arrays — the sidebar via the
// `permissions` object below, handed to the client by /api/auth/me and
// /api/auth/login. Do not restate these role names anywhere else; a second
// hand-maintained list is what let the nav offer a link the API then refused.
export const PRQ_VIEWER_ROLES = ['finance', 'founder', 'approver_s1', 'approver_s2'];
export const PRQ_FINANCE_ROLES = ['finance', 'founder'];

/**
 * Capability flags for a role, derived from the role arrays above.
 * Sent to the client so the UI never hard-codes a role list of its own.
 */
export function permissionsForRole(role) {
  return {
    canViewPaymentRequests: PRQ_VIEWER_ROLES.includes(role),
    canActionPaymentRequests: PRQ_FINANCE_ROLES.includes(role),
  };
}

// Sites that always go through Ritu (not Bhaskar) regardless of amount
export const RITU_ALWAYS_SITES = ['Head Office', 'Bangalore Office'];

// Amount threshold for director approval
export const DIRECTOR_APPROVAL_THRESHOLD = 9999;

// A site may raise only one imprest above this amount per calendar week
// (Head Office is exempt). Finance can grant a one-week override per site.
export const WEEKLY_EMERGENCY_THRESHOLD = 20000;

export const EXPENSE_STATUSES = [
  'pending',
  'verified',
  'manual_review',
  'approved',
  'rejected',
  'blocked',
];

export const IMPREST_SITES = [
  'MAX Hospital, Saket Delhi',
  'DEE Development Engineer - Canteen',
  'DEE Development Engineer - Admin',
  'Vaneet Infra',
  'Dee Foundation Omaxe, Faridabad',
  'Auma India Bengaluru',
  'Minebea Mitsumi',
  'Hero Homes Ludhiana',
  'Hero Homes Greater Noida',
  'Bansal Tower',
  'KOKO Town, Chandigarh',
  'Vinfast Jaipur',
  'M3M',
  'Vinfast Jikarpur',
  'Head Office',
  'Bangalore Office',
  'Others',
];

export const IMPREST_CATEGORIES = [
  'Food Expense',
  'Site Room Rent',
  'Travelling',
  'Conveyance',
  'Labour Expense',
  'Porter',
  'Hotel Expense',
  'Site Expense',
  'Other',
];

export const STORAGE_BUCKET = 'expense-screenshots';

export const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

// ── Deterministic verification thresholds ─────────────────────────────────────
// Single source of truth. These were previously re-read from process.env in
// verificationService.js and again in routes/expenses.js, and hardcoded a third
// time in the dashboard — three copies that could drift apart.
export const CONFIDENCE_AUTO_APPROVE = parseFloat(process.env.CONFIDENCE_AUTO_APPROVE || '94');
export const CONFIDENCE_MANUAL_REVIEW = parseFloat(process.env.CONFIDENCE_MANUAL_REVIEW || '70');
export const AMOUNT_TOLERANCE_INR = parseFloat(process.env.AMOUNT_TOLERANCE_INR || '10');
export const DATE_TOLERANCE_DAYS = parseInt(process.env.DATE_TOLERANCE_DAYS || '2');

// ── Receipt date window ───────────────────────────────────────────────────────
// The old rule ("receipt within 2 days of submission") contradicted the 7-day
// expense deadline and failed 134 of 141 backlog expenses — employees batching a
// week of receipts, exactly as the deadline invites. The rule is now anchored to
// the imprest period instead of the submission date.
//
// Company policy (confirmed): an employee may spend out of pocket and claim it
// against the advance once paid, so receipts predating the payout are valid.
export const RECEIPT_PREDATE_GRACE_DAYS = parseInt(process.env.RECEIPT_PREDATE_GRACE_DAYS || '45');
// A receipt dated after submission is a clock error at best.
export const RECEIPT_FUTURE_GRACE_DAYS = parseInt(process.env.RECEIPT_FUTURE_GRACE_DAYS || '1');
// Legacy rows with no linked imprest: how old a receipt may be vs submission.
export const RECEIPT_ORPHAN_MAX_AGE_DAYS = parseInt(process.env.RECEIPT_ORPHAN_MAX_AGE_DAYS || '45');

// ── LLM provider ──────────────────────────────────────────────────────────────
// Every model call goes through services/llmClient.js so the system is not tied
// to one vendor. When billing failed on one provider, receipt OCR, travel
// estimates and the expense auditor all stopped together — switching is now a
// single environment variable.
export const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();

// Cheap, fast, vision-capable — receipt OCR, ride fares, travel estimates.
export const OPENAI_OCR_MODEL = process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini';
// The expense auditor: reads receipts and decides whether money is released.
export const OPENAI_AUDIT_MODEL = process.env.OPENAI_AUDIT_MODEL || 'gpt-4o';
export const ANTHROPIC_OCR_MODEL = process.env.ANTHROPIC_OCR_MODEL || 'claude-haiku-4-5-20251001';

/** The model to use for a given job on a given provider. */
export function modelFor(purpose, provider = LLM_PROVIDER) {
  if (provider === 'openai') {
    return purpose === 'audit' ? OPENAI_AUDIT_MODEL : OPENAI_OCR_MODEL;
  }
  return purpose === 'audit' ? AI_AUDIT_MODEL : ANTHROPIC_OCR_MODEL;
}

// ── AI Expense Auditor ────────────────────────────────────────────────────────
// Replaces the manual expense checker. See database/039_ai_audit.sql.
//
// AI_AUDIT_MODE is the kill switch — no redeploy needed to change it:
//   'auto'      — clean expenses are auto-approved (all rails must pass)
//   'recommend' — the AI only records a verdict; a human confirms everything
//   'off'       — no auditing at all
// The AI NEVER auto-rejects in any mode; a reject verdict routes to a human.
export const AI_AUDIT_MODE = process.env.AI_AUDIT_MODE || 'recommend';
export const AI_AUDIT_MODEL = process.env.AI_AUDIT_MODEL || 'claude-opus-5';
export const AI_AUDIT_EFFORT = process.env.AI_AUDIT_EFFORT || 'high';
export const AI_AUDIT_MAX_TOKENS = parseInt(process.env.AI_AUDIT_MAX_TOKENS || '16000');

// Fixed system employee inserted by migration 039 — used as approved_by so the
// existing FK and every "approved by" join keeps working.
export const AI_AUDITOR_EMPLOYEE_ID = '00000000-0000-4000-a000-000000000a1a';

// Auto-approve safety rails. AI_AUTO_APPROVE_MAX_INR is uncapped by default;
// set it to impose a rupee ceiling without a code change.
export const AI_AUTO_APPROVE_MAX_INR = parseFloat(process.env.AI_AUTO_APPROVE_MAX_INR || 'Infinity');
// 85 was an arbitrary starting guess and it blocked sound approvals: in testing
// it held back two audits at 80% whose reasoning was clean (a matched ₹144 UPI
// receipt and a matched ₹4,500 food payment). The AI's confidence on this task
// clusters between 62 and 86, so 85 sat above almost everything it produces.
// Revisit against backtest evidence rather than by feel.
export const AI_AUTO_APPROVE_MIN_CONFIDENCE = parseFloat(process.env.AI_AUTO_APPROVE_MIN_CONFIDENCE || '80');

// Reconciliation tolerance when an expense settles an imprest (₹).
export const AI_RECONCILE_TOLERANCE_INR = parseFloat(process.env.AI_RECONCILE_TOLERANCE_INR || '50');

// Background sweeper — retries anything the inline audit missed.
export const AI_AUDIT_SWEEP_INTERVAL_MS = parseInt(process.env.AI_AUDIT_SWEEP_INTERVAL_MS || String(10 * 60 * 1000));
export const AI_AUDIT_SWEEP_BATCH = parseInt(process.env.AI_AUDIT_SWEEP_BATCH || '5');
// Generous window: the existing backlog reaches back to April.
export const AI_AUDIT_MAX_AGE_DAYS = parseInt(process.env.AI_AUDIT_MAX_AGE_DAYS || '180');

// ── Fix-in-place ──────────────────────────────────────────────────────────────
// When the AI finds a defect the employee can correct, the expense goes to
// THEIR stage — out of the finance queue — and they replace the receipt on the
// same row. One attempt only; a second failure belongs to finance.
// Master switch for employee-facing expense messages (fix requests and
// rejection notices). Set to 'false' to audit silently.
//
// When off, the auditor must NOT park expenses with employees either: an
// expense sent to someone who is never told sits there until its window
// closes and is then auto-rejected for "not corrected" — which is exactly how
// a legitimate 18,900 claim was rejected without its owner ever hearing about
// it. Silent means those cases go to finance instead.
export const EXPENSE_NOTIFY_ENABLED = (process.env.EXPENSE_NOTIFY_ENABLED || 'true').toLowerCase() !== 'false';

export const FIX_WINDOW_DAYS = parseInt(process.env.FIX_WINDOW_DAYS || '7');
// Hard ceiling on fix attempts. Also caps re-audit spend per expense.
export const MAX_FIX_ATTEMPTS = parseInt(process.env.MAX_FIX_ATTEMPTS || '1');
// Circuit breakers so a bug can never turn into a message flood and a banned
// WhatsApp number. Real volume is ~20-35 fix requests a month (about one a day).
export const FIX_NOTIFY_MAX_PER_EMPLOYEE_DAY = parseInt(process.env.FIX_NOTIFY_MAX_PER_EMPLOYEE_DAY || '3');
export const FIX_NOTIFY_MAX_PER_DAY = parseInt(process.env.FIX_NOTIFY_MAX_PER_DAY || '60');

// Statuses the AI is allowed to touch. A human decision (approved/rejected) is
// never overwritten; 'blocked' is audited for reasoning but never re-statused.
export const AI_AUDITABLE_STATUSES = ['pending', 'verified', 'manual_review'];
