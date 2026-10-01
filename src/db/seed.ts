import type { Db } from './connection.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../modules/auth/password.js';

export const SEED_CREATED_AT = '2026-10-01T00:00:00.000Z';
export const SEED_PASSWORD = 'Demo123!';

export const SEED_USERS = [
  { id: 'user-alice', name: 'Alice Demo', email: 'alice@demo.local', accountId: 'acc-alice', balanceCents: 100000 },
  { id: 'user-bruno', name: 'Bruno Demo', email: 'bruno@demo.local', accountId: 'acc-bruno', balanceCents: 25000 },
  { id: 'user-carla', name: 'Carla Demo', email: 'carla@demo.local', accountId: 'acc-carla', balanceCents: 0 },
] as const;

export const SEED_CONTACT = {
  id: 'contact-bruno',
  ownerUserId: 'user-alice',
  recipientAccountId: 'acc-bruno',
  nickname: 'Bruno',
} as const;

export const INITIAL_TOTAL_CENTS = 125000;

export const SEED_BALANCES: Record<string, number> = {
  'acc-alice': 100000,
  'acc-bruno': 25000,
  'acc-carla': 0,
};

function insertSeedRows(db: Db, passwordHash: string): void {
  const insUser = db.prepare(
    `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const insAcc = db.prepare(
    `INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at)
     VALUES (?, ?, 'BRL', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const u of SEED_USERS) {
    insUser.run(u.id, u.name, u.email, passwordHash, SEED_CREATED_AT, SEED_CREATED_AT);
    insAcc.run(u.accountId, u.id, u.balanceCents, SEED_CREATED_AT);
  }
  db.prepare(
    `INSERT INTO contacts (id, owner_user_id, recipient_account_id, nickname, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(SEED_CONTACT.id, SEED_CONTACT.ownerUserId, SEED_CONTACT.recipientAccountId, SEED_CONTACT.nickname, SEED_CREATED_AT);
}

/**
 * Seed idempotente: insere o que falta, nunca altera saldo nem apaga operações.
 * O hash da senha é calculado antes da transação.
 */
export async function seed(db: Db): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const tx = db.transaction(() => {
    insertSeedRows(db, passwordHash);
  });
  tx.immediate();
}

const DELETE_ORDER = [
  'test_faults',
  'jobs',
  'ledger_entries',
  'transfers',
  'contacts',
  'sessions',
  'accounts',
  'users',
] as const;

/**
 * Reset explícito: apaga tudo (ordem por FK) e restaura a fotografia inicial.
 * Ledger imutável por trigger: usa DROP TABLE (não bloqueado pelos triggers
 * de UPDATE/DELETE) e recria o schema via migrate dentro da mesma operação.
 */
export async function resetDatabase(db: Db): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  // DROP fora de transação explícita do better-sqlite3 (DDL é transacional no SQLite,
  // mas DROP TRIGGER-less tables + migrate já garante atomicidade por etapa).
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const t of DELETE_ORDER) {
      db.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    db.exec('DROP TABLE IF EXISTS schema_migrations');
    migrate(db);
    const tx = db.transaction(() => {
      insertSeedRows(db, passwordHash);
    });
    tx.immediate();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function totalBalances(db: Db): number {
  const row = db.prepare('SELECT COALESCE(SUM(balance_cents),0) AS total FROM accounts').get() as {
    total: number;
  };
  return row.total;
}
