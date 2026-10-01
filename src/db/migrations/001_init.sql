-- Migração 001 — schema completo do Banco Demo v1 (PRD §6, doc-1 §4)
-- Datas: TEXT ISO 8601 UTC com milissegundos, geradas pela aplicação.
-- STRICT impede tipos errados (ex.: REAL em coluna de dinheiro).

CREATE TABLE users (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE accounts (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  id TEXT NOT NULL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE contacts (
  id TEXT NOT NULL PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_account_id TEXT NOT NULL REFERENCES accounts(id),
  nickname TEXT NOT NULL CHECK (length(nickname) >= 1),
  created_at TEXT NOT NULL,
  UNIQUE (owner_user_id, recipient_account_id)
) STRICT;

CREATE TABLE transfers (
  id TEXT NOT NULL PRIMARY KEY,
  source_account_id TEXT NOT NULL REFERENCES accounts(id),
  recipient_account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  failure_code TEXT CHECK (failure_code IN ('INSUFFICIENT_FUNDS','CREDIT_FAILED')),
  saga_step TEXT NOT NULL CHECK (saga_step IN ('CREATED','DEBITED','COMPENSATING','COMPLETED','FAILED')),
  in_transit_cents INTEGER NOT NULL DEFAULT 0 CHECK (in_transit_cents >= 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_account_id, idempotency_key),
  CHECK (source_account_id <> recipient_account_id),
  CHECK ((status = 'FAILED' AND failure_code IS NOT NULL) OR (status <> 'FAILED' AND failure_code IS NULL))
) STRICT;

CREATE TABLE ledger_entries (
  id TEXT NOT NULL PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfers(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL CHECK (type IN ('DEBIT','CREDIT','COMPENSATION')),
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (transfer_id, type),
  CHECK ((type = 'DEBIT' AND amount_cents < 0) OR (type <> 'DEBIT' AND amount_cents > 0))
) STRICT;

-- Invariantes entre linhas do ledger (PRD §5): exclusividade CREDIT ×
-- COMPENSATION e existência de DEBIT prévio.
CREATE TRIGGER ledger_credit_compensation_exclusive
BEFORE INSERT ON ledger_entries
WHEN NEW.type IN ('CREDIT','COMPENSATION')
 AND EXISTS (
   SELECT 1 FROM ledger_entries
   WHERE transfer_id = NEW.transfer_id
     AND type = (CASE WHEN NEW.type = 'CREDIT' THEN 'COMPENSATION' ELSE 'CREDIT' END)
 )
BEGIN
  SELECT RAISE(ABORT, 'ledger: CREDIT e COMPENSATION sao mutuamente exclusivos');
END;

CREATE TRIGGER ledger_credit_requires_debit
BEFORE INSERT ON ledger_entries
WHEN NEW.type IN ('CREDIT','COMPENSATION')
 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transfer_id = NEW.transfer_id AND type = 'DEBIT')
BEGIN
  SELECT RAISE(ABORT, 'ledger: CREDIT/COMPENSATION exige DEBIT previo');
END;

-- Ledger é auditável e imutável; o reset de teste recria o schema
-- (DROP TABLE + migrate), nunca DELETE/UPDATE em lançamentos.
CREATE TRIGGER ledger_immutable_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger: lancamentos sao imutaveis');
END;

CREATE TRIGGER ledger_immutable_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger: lancamentos sao imutaveis');
END;

CREATE TABLE jobs (
  id TEXT NOT NULL PRIMARY KEY,
  transfer_id TEXT NOT NULL UNIQUE REFERENCES transfers(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING','DONE')),
  run_after TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_jobs_pending ON jobs (status, run_after);

CREATE TABLE test_faults (
  id TEXT NOT NULL PRIMARY KEY,
  source_account_id TEXT NOT NULL REFERENCES accounts(id),
  idempotency_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('FAIL_CREDIT_ONCE','PAUSE_AFTER_DEBIT')),
  armed_at TEXT NOT NULL,
  consumed_at TEXT,
  transfer_id TEXT,
  UNIQUE (source_account_id, idempotency_key)
) STRICT;

CREATE INDEX idx_transfers_history ON transfers (source_account_id, created_at DESC, id DESC);
CREATE INDEX idx_contacts_owner ON contacts (owner_user_id, nickname, id);
