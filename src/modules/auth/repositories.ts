import type { SqliteDb } from "../../db/connection.js";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  user_id: string;
  currency: string;
  balance_cents: number;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export function findUserByEmail(
  db: SqliteDb,
  email: string,
): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | UserRow
    | undefined;
}

export function findUserById(db: SqliteDb, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

export function findAccountByUserId(
  db: SqliteDb,
  userId: string,
): AccountRow | undefined {
  return db.prepare("SELECT * FROM accounts WHERE user_id = ?").get(userId) as
    | AccountRow
    | undefined;
}

export function findAccountById(
  db: SqliteDb,
  accountId: string,
): AccountRow | undefined {
  return db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as
    | AccountRow
    | undefined;
}

export function insertUser(db: SqliteDb, row: UserRow): void {
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
     VALUES (@id, @name, @email, @password_hash, @created_at, @updated_at)`,
  ).run(row);
}

export function insertAccount(db: SqliteDb, row: AccountRow): void {
  db.prepare(
    `INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at)
     VALUES (@id, @user_id, @currency, @balance_cents, @updated_at)`,
  ).run(row);
}

export function insertSession(db: SqliteDb, row: SessionRow): void {
  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, revoked_at)
     VALUES (@id, @token_hash, @user_id, @created_at, @expires_at, @revoked_at)`,
  ).run(row);
}

export function findSessionByTokenHash(
  db: SqliteDb,
  tokenHash: string,
): SessionRow | undefined {
  return db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as
    | SessionRow
    | undefined;
}

export function revokeSession(
  db: SqliteDb,
  sessionId: string,
  revokedAt: string,
): void {
  db.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  ).run(revokedAt, sessionId);
}

export function emailExists(db: SqliteDb, email: string): boolean {
  return db.prepare("SELECT 1 FROM users WHERE email = ?").get(email) !== undefined;
}
