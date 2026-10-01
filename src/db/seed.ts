import type Database from 'better-sqlite3';
import { hashPassword } from '../modules/auth/password.js';
import { migrate } from './migrate.js';

export const SEED_CREATED_AT = '2026-10-01T00:00:00.000Z';
export const INITIAL_TOTAL_CENTS = 125000;
export const DEMO_PASSWORD = 'Demo123!';

export const SEED_BALANCES: Record<string, number> = {
  'acc-alice': 100000,
  'acc-bruno': 25000,
  'acc-carla': 0,
};

interface SeedUser {
  id: string;
  name: string;
  email: string;
  accountId: string;
}

const SEED_USERS: SeedUser[] = [
  { id: 'user-alice', name: 'Alice Demo', email: 'alice@demo.local', accountId: 'acc-alice' },
  { id: 'user-bruno', name: 'Bruno Demo', email: 'bruno@demo.local', accountId: 'acc-bruno' },
  { id: 'user-carla', name: 'Carla Demo', email: 'carla@demo.local', accountId: 'acc-carla' },
];

const SEED_CONTACTS = [{ id: 'contact-bruno', ownerUserId: 'user-alice', recipientAccountId: 'acc-bruno', nickname: 'Bruno' }];

/**
 * Seed reproduzível do contrato §3. Idempotente: nunca altera saldo nem apaga
 * operações existentes (ON CONFLICT DO NOTHING). O hash é calculado fora da
 * transação (scrypt é async/CPU-bound).
 */
export async function seed(db: Database.Database): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const run = db.transaction(() => {
    const upUser = db.prepare(
      'INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    );
    const upAccount = db.prepare(
      'INSERT INTO accounts (id,user_id,currency,balance_cents,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    );
    for (const u of SEED_USERS) {
      upUser.run(u.id, u.name, u.email, passwordHash, SEED_CREATED_AT, SEED_CREATED_AT);
      upAccount.run(u.accountId, u.id, 'BRL', SEED_BALANCES[u.accountId]!, SEED_CREATED_AT);
    }
    const upContact = db.prepare(
      'INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    );
    for (const c of SEED_CONTACTS) upContact.run(c.id, c.ownerUserId, c.recipientAccountId, c.nickname, SEED_CREATED_AT);
  });
  run.immediate();
}

/**
 * Reset explícito: restaura a fotografia inicial. O ledger é imutável por
 * trigger — o reset recria o schema inteiro (DROP + migrate) em vez de
 * DELETE. FK é desligado apenas durante os DROPs (PRAGMA é no-op dentro
 * de transação).
 */
export async function resetDatabase(db: Database.Database): Promise<void> {
  db.pragma('foreign_keys = OFF');
  const dropAll = db.transaction(() => {
    const tables = [
      'test_faults', 'jobs', 'ledger_entries', 'transfers', 'contacts',
      'sessions', 'accounts', 'users', 'schema_migrations',
    ];
    for (const t of tables) db.exec(`DROP TABLE IF EXISTS ${t}`);
  });
  try {
    dropAll.immediate();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  migrate(db);
  await seed(db);
}
