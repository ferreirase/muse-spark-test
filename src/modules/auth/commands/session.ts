import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../../db/connection.js";
import { SESSION_TTL_MS } from "../../../http/plugins/auth.js";
import {
  hashSessionToken,
  generateSessionToken,
} from "../session-token.js";
import { insertSession, type SessionRow } from "../repositories.js";

export interface CreateSessionInput {
  userId: string;
  now: Date;
  generateId?: () => string;
  generateToken?: () => string;
}

export interface CreatedSession {
  row: SessionRow;
  token: string;
}

export function createSession(
  db: SqliteDb,
  input: CreateSessionInput,
): CreatedSession {
  const generateId = input.generateId ?? randomUUID;
  const generateToken = input.generateToken ?? generateSessionToken;
  const token = generateToken();
  const nowIso = input.now.toISOString();
  const row: SessionRow = {
    id: generateId(),
    token_hash: hashSessionToken(token),
    user_id: input.userId,
    created_at: nowIso,
    expires_at: new Date(input.now.getTime() + SESSION_TTL_MS).toISOString(),
    revoked_at: null,
  };
  insertSession(db, row);
  return { row, token };
}
