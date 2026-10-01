import { randomUUID } from 'node:crypto';
import type { Db } from '../../../db/connection.js';
import type { Clock } from '../../../shared/clock.js';
import type { AuthResult } from '../../../shared/dto.js';
import { AppError } from '../../../shared/errors.js';
import { checkPassword, normalizeEmail, normalizeName } from '../../../shared/validation.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../password.js';
import { createSession, revokeSession } from '../session-repository.js';

export interface CommandDeps {
  db: Db;
  clock: Clock;
  /** Injetável para testes de atomicidade e determinismo. */
  uuid?: () => string;
  createSessionFn?: typeof createSession;
}

export interface SessionInfo {
  token: string;
  expiresAt: string;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ((err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      /UNIQUE constraint failed/i.test((err as { message?: string }).message ?? ''))
  );
}

function toAuthResult(
  user: { id: string; name: string; email: string; createdAt: string },
  account: { id: string; balanceCents: number },
): AuthResult {
  return {
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
    account: { id: account.id, currency: 'BRL', balanceCents: account.balanceCents },
  };
}

/** Signup: user + conta zerada + sessão em uma transação. */
export async function signup(
  deps: CommandDeps,
  input: { name: unknown; email: unknown; password: unknown },
): Promise<{ authResult: AuthResult; session: SessionInfo }> {
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const password = checkPassword(input.password);
  const uuid = deps.uuid ?? randomUUID;
  const createFn = deps.createSessionFn ?? createSession;

  const passwordHash = await hashPassword(password);
  const userId = uuid();
  const accountId = uuid();
  const now = deps.clock.now().toISOString();

  const tx = deps.db.transaction(() => {
    deps.db
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, name, email, passwordHash, now, now);
    deps.db
      .prepare(
        `INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at)
         VALUES (?, ?, 'BRL', 0, ?)`,
      )
      .run(accountId, userId, now);
    return createFn(deps.db, userId, deps.clock);
  });

  let session: SessionInfo;
  try {
    session = tx.immediate() as SessionInfo;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('EMAIL_ALREADY_EXISTS', 409, 'E-mail já cadastrado');
    }
    throw err;
  }
  return {
    authResult: toAuthResult(
      { id: userId, name, email, createdAt: now },
      { id: accountId, balanceCents: 0 },
    ),
    session,
  };
}

interface UserAccountRow {
  userId: string;
  userName: string;
  userEmail: string;
  userCreatedAt: string;
  passwordHash: string;
  accountId: string;
  balanceCents: number;
}

/** Signin: verifica hash e cria sessão. E-mail inexistente e senha errada → mesmo 401. */
export async function signin(
  deps: CommandDeps,
  input: { email: unknown; password: unknown },
): Promise<{ authResult: AuthResult; session: SessionInfo }> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';
  if (typeof input.password !== 'string') {
    // Mensagem idêntica à de credencial inválida para não vazar formato.
    throw new AppError('INVALID_CREDENTIALS', 401, 'E-mail ou senha inválidos');
  }

  const row = deps.db
    .prepare(
      `SELECT u.id AS userId, u.name AS userName, u.email AS userEmail,
              u.created_at AS userCreatedAt, u.password_hash AS passwordHash,
              a.id AS accountId, a.balance_cents AS balanceCents
       FROM users u JOIN accounts a ON a.user_id = u.id
       WHERE u.email = ?`,
    )
    .get(email) as UserAccountRow | undefined;

  const stored = row?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const ok = await verifyPassword(password, stored);
  if (row === undefined || !ok) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'E-mail ou senha inválidos');
  }

  const createFn = deps.createSessionFn ?? createSession;
  const session = createFn(deps.db, row.userId, deps.clock);
  return {
    authResult: toAuthResult(
      { id: row.userId, name: row.userName, email: row.userEmail, createdAt: row.userCreatedAt },
      { id: row.accountId, balanceCents: row.balanceCents },
    ),
    session,
  };
}

/** Signout idempotente: nunca lança. */
export function signout(deps: CommandDeps, token: string | undefined): void {
  if (typeof token === 'string' && token !== '') {
    revokeSession(deps.db, token, deps.clock);
  }
}
