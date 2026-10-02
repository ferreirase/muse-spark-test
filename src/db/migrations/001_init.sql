-- 001_init.sql — schema completo do Banco Demo
-- Dinheiro sempre em centavos inteiros. Datas ISO 8601 UTC em TEXT.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE REFERENCES users(id),
  currency      TEXT NOT NULL CHECK (currency = 'BRL'),
  balance_cents INTEGER NOT NULL
                CHECK (typeof(balance_cents) = 'integer' AND balance_cents >= 0),
  updated_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL
);

CREATE TABLE contacts (
  id                   TEXT PRIMARY KEY,
  owner_user_id        TEXT NOT NULL REFERENCES users(id),
  recipient_account_id TEXT NOT NULL REFERENCES accounts(id),
  nickname             TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  UNIQUE (owner_user_id, recipient_account_id)
);

CREATE TABLE transfers (
  id                   TEXT PRIMARY KEY,
  source_account_id    TEXT NOT NULL REFERENCES accounts(id),
  recipient_account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_cents         INTEGER NOT NULL
                       CHECK (typeof(amount_cents) = 'integer'
                              AND amount_cents BETWEEN 1 AND 100000000),
  note                 TEXT NULL,
  status               TEXT NOT NULL
                       CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  failure_code         TEXT NULL
                       CHECK (failure_code IS NULL
                              OR failure_code IN ('INSUFFICIENT_FUNDS','CREDIT_FAILED')),
  saga_step            TEXT NOT NULL
                       CHECK (saga_step IN ('CREATED','DEBITED','COMPENSATING','COMPLETED','FAILED')),
  in_transit_cents     INTEGER NOT NULL DEFAULT 0
                       CHECK (typeof(in_transit_cents) = 'integer' AND in_transit_cents >= 0),
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT NULL,
  idempotency_key      TEXT NOT NULL,
  payload_fingerprint  TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (source_account_id, idempotency_key),
  CHECK (source_account_id <> recipient_account_id),
  CHECK (in_transit_cents <= amount_cents)
);

CREATE TABLE ledger_entries (
  id           TEXT PRIMARY KEY,
  transfer_id  TEXT NOT NULL REFERENCES transfers(id),
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  type         TEXT NOT NULL CHECK (type IN ('DEBIT','CREDIT','COMPENSATION')),
  amount_cents INTEGER NOT NULL
               CHECK (
                 (type = 'DEBIT' AND amount_cents < 0)
                 OR (type IN ('CREDIT','COMPENSATION') AND amount_cents > 0)
               ),
  created_at   TEXT NOT NULL,
  UNIQUE (transfer_id, type)
);

CREATE TRIGGER ledger_no_credit_after_compensation
BEFORE INSERT ON ledger_entries
WHEN NEW.type = 'CREDIT'
     AND EXISTS (
       SELECT 1 FROM ledger_entries
       WHERE transfer_id = NEW.transfer_id AND type = 'COMPENSATION'
     )
BEGIN
  SELECT RAISE(ABORT, 'CREDIT cannot follow COMPENSATION for the same transfer');
END;

CREATE TRIGGER ledger_no_compensation_after_credit
BEFORE INSERT ON ledger_entries
WHEN NEW.type = 'COMPENSATION'
     AND EXISTS (
       SELECT 1 FROM ledger_entries
       WHERE transfer_id = NEW.transfer_id AND type = 'CREDIT'
     )
BEGIN
  SELECT RAISE(ABORT, 'COMPENSATION cannot follow CREDIT for the same transfer');
END;

CREATE TRIGGER ledger_credit_requires_debit
BEFORE INSERT ON ledger_entries
WHEN NEW.type IN ('CREDIT','COMPENSATION')
     AND NOT EXISTS (
       SELECT 1 FROM ledger_entries
       WHERE transfer_id = NEW.transfer_id AND type = 'DEBIT'
     )
BEGIN
  SELECT RAISE(ABORT, 'CREDIT/COMPENSATION requires a prior DEBIT for the transfer');
END;

-- ledger_entries é append-only. O reset de teste insere uma linha em
-- ledger_reset_guard dentro da mesma transação para poder limpar a tabela.
CREATE TABLE ledger_reset_guard (
  id INTEGER PRIMARY KEY
);

CREATE TRIGGER ledger_no_update
BEFORE UPDATE ON ledger_entries
WHEN NOT EXISTS (SELECT 1 FROM ledger_reset_guard)
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries is append-only (UPDATE forbidden)');
END;

CREATE TRIGGER ledger_no_delete
BEFORE DELETE ON ledger_entries
WHEN NOT EXISTS (SELECT 1 FROM ledger_reset_guard)
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries is append-only (DELETE forbidden)');
END;

CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL UNIQUE REFERENCES transfers(id),
  status      TEXT NOT NULL CHECK (status IN ('PENDING','DONE')),
  run_after   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  locked_by   TEXT NULL,
  locked_until TEXT NULL,
  last_error  TEXT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE test_faults (
  id                TEXT PRIMARY KEY,
  source_account_id TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  mode              TEXT NOT NULL
                    CHECK (mode IN ('FAIL_CREDIT_ONCE','PAUSE_AFTER_DEBIT')),
  armed_at          TEXT NOT NULL,
  consumed_at       TEXT NULL,
  transfer_id       TEXT NULL,
  UNIQUE (source_account_id, idempotency_key)
);

CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_contacts_owner ON contacts(owner_user_id, nickname, id);
CREATE INDEX idx_transfers_source_created
  ON transfers(source_account_id, created_at DESC, id DESC);
CREATE INDEX idx_transfers_recipient ON transfers(recipient_account_id);
CREATE INDEX idx_ledger_transfer ON ledger_entries(transfer_id);
CREATE INDEX idx_jobs_pending ON jobs(status, run_after);
