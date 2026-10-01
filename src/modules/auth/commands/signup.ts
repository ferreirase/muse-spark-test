import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthResult } from '../../../shared/dto.js';
import { errors } from '../../../shared/errors.js';
import { checkPassword, normalizeEmail, normalizeName } from '../../../shared/validation.js';
import { hashPassword } from '../password.js';
import { createSession } from '../session-repository.js';

export interface SignupDeps {
  db: Database.Database;
  now: Date;
  uuid?: () => string;
  createSession?: typeof createSession;
}

export interface SignupInput {
  name: unknown;
  email: unknown;
  password: unknown;
}

/**
 * Comando Signup (B01): user + conta saldo 0 + sessão em UMA transação
 * immediate. Hash calculado fora da tx (scrypt é CPU-bound).
 */
export async function signup(
  deps: SignupDeps,
  input: SignupInput,
): Promise<{ authResult: AuthResult; session: { token: string; expiresAt: string } }> {
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const password = checkPassword(input.password);

  const passwordHash = await hashPassword(password);
  const uuid = deps.uuid ?? randomUUID;
  const doCreateSession = deps.createSession ?? createSession;
  const now = deps.now;
  const nowIso = now.toISOString();

  const userId = uuid();
  const accountId = uuid();

  const run = deps.db.transaction((): { token: string; expiresAt: string } => {
    const exists = deps.db.prepare('SELECT 1 FROM users WHERE email=?').get(email);
    if (exists) throw errors.emailExists();
    deps.db.prepare('INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(userId, name, email, passwordHash, nowIso, nowIso);
    deps.db.prepare('INSERT INTO accounts (id,user_id,currency,balance_cents,updated_at) VALUES (?,?,?,0,?)')
      .run(accountId, userId, 'BRL', nowIso);
    const session = doCreateSession(deps.db, userId, now, uuid);
    return { token: session.token, expiresAt: session.expiresAt };
  });
  const session = run.immediate();

  return {
    authResult: {
      user: { id: userId, name, email, createdAt: nowIso },
      account: { id: accountId, currency: 'BRL', balanceCents: 0 },
    },
    session,
  };
}
