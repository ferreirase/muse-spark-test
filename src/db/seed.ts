import type { SqliteDb } from "./connection.js";
import { hashPassword } from "../modules/auth/password.js";
import { systemClock, type Clock } from "../shared/clock.js";

export const DEMO_PASSWORD = "Demo123!";

export interface SeedUser {
  userId: string;
  accountId: string;
  name: string;
  email: string;
  balanceCents: number;
}

export const SEED_USERS: readonly SeedUser[] = [
  {
    userId: "user-alice",
    accountId: "acc-alice",
    name: "Alice Demo",
    email: "alice@demo.local",
    balanceCents: 100000,
  },
  {
    userId: "user-bruno",
    accountId: "acc-bruno",
    name: "Bruno Demo",
    email: "bruno@demo.local",
    balanceCents: 25000,
  },
  {
    userId: "user-carla",
    accountId: "acc-carla",
    name: "Carla Demo",
    email: "carla@demo.local",
    balanceCents: 0,
  },
];

export const SEED_TOTAL_CENTS = SEED_USERS.reduce(
  (sum, user) => sum + user.balanceCents,
  0,
);

export const SEED_CONTACTS = [
  {
    id: "contact-bruno",
    ownerUserId: "user-alice",
    recipientAccountId: "acc-bruno",
    nickname: "Bruno",
  },
] as const;

export interface SeedDeps {
  clock?: Clock;
  hash?: (password: string) => Promise<string>;
}

export interface SeedResult {
  inserted: number;
}

export async function seed(db: SqliteDb, deps: SeedDeps = {}): Promise<SeedResult> {
  const clock = deps.clock ?? systemClock;
  const hash = deps.hash ?? hashPassword;
  const now = clock.now().toISOString();

  const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?");
  const missing = SEED_USERS.filter((user) => !userExists.get(user.userId));
  if (missing.length === 0) {
    return { inserted: 0 };
  }

  const hashes = new Map<string, string>();
  for (const user of SEED_USERS) {
    hashes.set(user.userId, await hash(DEMO_PASSWORD));
  }

  const run = db.transaction(() => {
    for (const user of SEED_USERS) {
      const already = userExists.get(user.userId);
      if (already) continue;
      db.prepare(
        `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        user.userId,
        user.name,
        user.email,
        hashes.get(user.userId)!,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at)
         VALUES (?, ?, 'BRL', ?, ?)`,
      ).run(user.accountId, user.userId, user.balanceCents, now);
    }
    for (const contact of SEED_CONTACTS) {
      const exists = db
        .prepare("SELECT 1 FROM contacts WHERE id = ?")
        .get(contact.id);
      if (exists) continue;
      db.prepare(
        `INSERT INTO contacts (id, owner_user_id, recipient_account_id, nickname, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        contact.id,
        contact.ownerUserId,
        contact.recipientAccountId,
        contact.nickname,
        now,
      );
    }
  });
  run.immediate();

  return { inserted: missing.length };
}
