import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateSessionToken, hashSessionToken } from './session-token.js';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h fixas (contrato §4)

export interface AuthContext {
  sessionId: string;
  userId: string;
  accountId: string;
}

interface SessionRow {
  id: string;
  user_id: string;
}

/**
 * Cria sessão persistida (hash do token). Síncrona e sem transação própria:
 * pode ser chamada dentro da transação do signup (atomicidade B01).
 * O token em claro só existe no retorno, para setar o cookie.
 */
export function createSession(
  db: Database.Database,
  userId: string,
  now: Date,
  uuid: () => string = randomUUID,
): { token: string; sessionId: string; expiresAt: string } {
  const token = generateSessionToken();
  const sessionId = uuid();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?,?)',
  ).run(sessionId, hashSessionToken(token), userId, createdAt, expiresAt);
  return { token, sessionId, expiresAt };
}

/** Resolve sessão válida (ativa e não expirada) → contexto de autenticação. */
export function resolveSession(db: Database.Database, token: string, now: Date): AuthContext | null {
  const row = db
    .prepare(
      `SELECT s.id, s.user_id, a.id AS account_id
       FROM sessions s
       JOIN accounts a ON a.user_id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?`,
    )
    .get(hashSessionToken(token), now.toISOString()) as (SessionRow & { account_id: string }) | undefined;
  if (!row) return null;
  return { sessionId: row.id, userId: row.user_id, accountId: row.account_id };
}

/** Revoga sessão; idempotente (signout sem sessão válida não lança). */
export function revokeSession(db: Database.Database, token: string, now: Date): void {
  db.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
  ).run(now.toISOString(), hashSessionToken(token));
}

/** Função pura usada pelo preHandler requireAuth (testável sem HTTP). */
export function authenticate(db: Database.Database, token: string | undefined, now: Date): AuthContext | null {
  if (!token) return null;
  return resolveSession(db, token, now);
}
