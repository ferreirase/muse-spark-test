import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/connection.js';
import type { Clock } from '../../shared/clock.js';
import { generateSessionToken, hashSessionToken } from './session-token.js';

/** Validade fixa de 24 h (constante, não configurável — contrato §4). */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = 'bank_session';

export interface SessionAuth {
  sessionId: string;
  userId: string;
  accountId: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Cria sessão persistida. Síncrona para caber em transação externa
 * (signup cria user+conta+sessão atomicamente). Retorna o token em claro
 * apenas para setar o cookie — o banco guarda só o hash.
 */
export function createSession(
  db: Db,
  userId: string,
  clock: Clock,
  token: string = generateSessionToken(),
): { token: string; sessionId: string; expiresAt: string } {
  const nowMs = clock.now().getTime();
  const sessionId = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(sessionId, hashSessionToken(token), userId, iso(nowMs), iso(nowMs + SESSION_TTL_MS));
  return { token, sessionId, expiresAt: iso(nowMs + SESSION_TTL_MS) };
}

/** Resolve token → auth ou null (ausente, expirado ou revogado). Função pura de I/O. */
export function resolveSession(db: Db, token: string, clock: Clock): SessionAuth | null {
  const row = db
    .prepare(
      `SELECT s.id AS sessionId, s.user_id AS userId, a.id AS accountId
       FROM sessions s
       JOIN accounts a ON a.user_id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(hashSessionToken(token), clock.now().toISOString()) as SessionAuth | undefined;
  return row ?? null;
}

/** Revoga sessão. Idempotente: token inexistente não lança. */
export function revokeSession(db: Db, token: string, clock: Clock): void {
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`).run(
    clock.now().toISOString(),
    hashSessionToken(token),
  );
}
