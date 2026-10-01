-- 001_init: schema completo do Banco Demo (doc-1 §4).
-- Datas: TEXT ISO 8601 UTC com millissegundos, geradas pela aplicação.
-- Tabelas STRICT: tipos errados em colunas de dinheiro falham no INSERT.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users (id),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users (id),
  recipient_account_id TEXT NOT NULL REFERENCES accounts (id),
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_user_id, recipient_account_id)
) STRICT;

CREATE INDEX idx_contacts_owner ON contacts (owner_user_id, nickname, id);

CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  source_account_id TEXT NOT NULL REFERENCES accounts (id),
  recipient_account_id TEXT NOT NULL REFERENCES accounts (id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 1 AND amount_cents <= 100000000),
  note TEXT CHECK (note IS NULL OR length(note) <= 140),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  failure_code TEXT CHECK (failure_code IN ('INSUFFICIENT_FUNDS', 'CREDIT_FAILED')),
  saga_step TEXT NOT NULL CHECK (saga_step IN ('CREATED', 'DEBITED', 'COMPENSATING', 'COMPLETED', 'FAILED')),
  in_transit_cents INTEGER NOT NULL DEFAULT 0 CHECK (in_transit_cents >= 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_account_id, idempotency_key),
  CHECK (source_account_id <> recipient_account_id),
  CHECK ((status = 'FAILED') = (failure_code IS NOT NULL))
) STRICT;

CREATE INDEX idx_transfers_source_history ON transfers (source_account_id, created_at DESC, id DESC);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfers (id),
  account_id TEXT NOT NULL REFERENCES accounts (id),
  type TEXT NOT NULL CHECK (type IN ('DEBIT', 'CREDIT', 'COMPENSATION')),
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (transfer_id, type),
  CHECK (
    (type = 'DEBIT' AND amount_cents < 0)
    OR (type = 'CREDIT' AND amount_cents > 0)
    OR (type = 'COMPENSATION' AND amount_cents > 0)
  )
) STRICT;

-- Regras de sequência da Saga: crédito/compensação exigem débito prévio;
-- crédito e compensação são mutuamente exclusivos.
CREATE TRIGGER trg_ledger_credit_requires_debit
BEFORE INSERT ON ledger_entries
WHEN NEW.type = 'CREDIT' AND NOT EXISTS (
  SELECT 1 FROM ledger_entries WHERE transfer_id = NEW.transfer_id AND type = 'DEBIT'
)
BEGIN
  SELECT RAISE(ABORT, 'CREDIT requires prior DEBIT');
END;

CREATE TRIGGER trg_ledger_compensation_requires_debit
BEFORE INSERT ON ledger_entries
WHEN NEW.type = 'COMPENSATION' AND NOT EXISTS (
  SELECT 1 FROM ledger_entries WHERE transfer_id = NEW.transfer_id AND type = 'DEBIT'
)
BEGIN
  SELECT RAISE(ABORT, 'COMPENSATION requires prior DEBIT');
END;

CREATE TRIGGER trg_ledger_no_credit_after_compensation
BEFORE INSERT ON ledger_entries
WHEN NEW.type = 'CREDIT' AND EXISTS (
  SELECT 1 FROM ledger_entries WHERE transfer_id = NEW.transfer_id AND type = 'COMPENSATION'
)
BEGIN
  SELECT RAISE(ABORT, 'CREDIT and COMPENSATION are mutually exclusive');
END;

CREATE TRIGGER trg_ledger_no_compensation_after_credit
BEFORE INSERT ON ledger_entries
WHEN NEW.type = 'COMPENSATION' AND EXISTS (
  SELECT 1 FROM ledger_entries WHERE transfer_id = NEW.transfer_id AND type = 'CREDIT'
)
BEGIN
  SELECT RAISE(ABORT, 'CREDIT and COMPENSATION are mutually exclusive');
END;

-- Ledger auditável e imutável: nenhum UPDATE nem DELETE.
CREATE TRIGGER trg_ledger_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries is immutable');
END;

CREATE TRIGGER trg_ledger_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries is immutable');
END;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL UNIQUE REFERENCES transfers (id),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'DONE')),
  run_after TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_jobs_claim ON jobs (status, run_after);

CREATE TABLE test_faults (
  id TEXT PRIMARY KEY,
  source_account_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('FAIL_CREDIT_ONCE', 'PAUSE_AFTER_DEBIT')),
  armed_at TEXT NOT NULL,
  consumed_at TEXT,
  transfer_id TEXT,
  UNIQUE (source_account_id, idempotency_key)
) STRICT;
