-- HagerStone Expense Tracker - Database Schema
-- Run in Supabase SQL Editor: Project → SQL Editor → New Query → Paste & Run

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- EMPLOYEES
-- Stores both field employees and finance/admin users.
-- Auth is handled by Supabase Auth; this table holds app profile.
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id     UUID UNIQUE,                        -- links to auth.users.id
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT,
  site        TEXT NOT NULL CHECK (site IN ('Mumbai','Delhi','Bangalore','Pune','Hyderabad')),
  role        TEXT NOT NULL DEFAULT 'employee'
                CHECK (role IN ('employee','finance','manager','admin')),
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive','suspended')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- EXPENSES
-- Core expense submission table.
-- screenshot_metadata JSONB structure:
-- { transactionId, extractedAmount, date, paymentStatus, confidence, rawText }
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref_id               TEXT UNIQUE NOT NULL,            -- HSE-YYYYMMDD-XXXX
  employee_id          UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  site                 TEXT NOT NULL CHECK (site IN ('Mumbai','Delhi','Bangalore','Pune','Hyderabad')),
  amount               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category             TEXT NOT NULL CHECK (category IN ('Vendor','Labour','Material','Transport','Other')),
  description          TEXT,
  screenshot_url       TEXT,                            -- Supabase Storage path
  screenshot_metadata  JSONB NOT NULL DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','verified','manual_review','approved','rejected','blocked')),
  duplicate_flag       BOOLEAN NOT NULL DEFAULT false,
  duplicate_ref        TEXT,                            -- ref_id of conflicting expense
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at          TIMESTAMPTZ,
  approved_at          TIMESTAMPTZ,
  verified_by          UUID REFERENCES employees(id),
  approved_by          UUID REFERENCES employees(id),
  rejection_reason     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- VERIFICATION LOGS
-- One row per verification check per expense.
-- step values: 'ocr', 'amount_check', 'date_check', 'status_check',
--              'txn_id_check', 'duplicate_check'
-- result values: 'pass', 'fail', 'warn', 'block'
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  step        TEXT NOT NULL,
  result      TEXT NOT NULL CHECK (result IN ('pass','fail','warn','block')),
  confidence  NUMERIC(5,2) CHECK (confidence >= 0 AND confidence <= 100),
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AUDIT TRAIL
-- Immutable log of all user actions for compliance.
-- action values: 'register', 'login', 'submit_expense', 'approve',
--                'reject', 'bulk_approve', 'update_status'
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_trail (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES employees(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('expense','employee')),
  entity_id    UUID,
  old_value    JSONB,
  new_value    JSONB,
  ip_address   TEXT,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on employees and expenses
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
