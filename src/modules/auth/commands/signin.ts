import type Database from 'better-sqlite3';
import type { AuthResult } from '../../../shared/dto.js';
import { errors } from '../../../shared/errors.js';
import { normalizeEmail } from '../../../shared/validation.js';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../password.js';
import { createSession } from '../session-repository.js';

export interface SigninDeps {
  db: Database.Database;
  now: Date;
}

export interface SigninInput {
  email: unknown;
  password: unknown;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
}

/** Comando Signin: credenciais → sessão. 401 uniforme para e-mail/senha. */
export async function signin(
  deps: SigninDeps,
  input: SigninInput,
): Promise<{ authResult: AuthResult; session: { token: string; expiresAt: string } }> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';

  const user = deps.db.prepare('SELECT * FROM users WHERE email=?').get(email) as UserRow | undefined;
  if (!user) {
    // equaliza tempo de resposta contra o caso de senha errada
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw errors.invalidCredentials();
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw errors.invalidCredentials();

  const account = deps.db
    .prepare('SELECT id, balance_cents FROM accounts WHERE user_id=?')
    .get(user.id) as { id: string; balance_cents: number };
  const session = createSession(deps.db, user.id, deps.now);

  return {
    authResult: {
      user: { id: user.id, name: user.name, email: user.email, createdAt: user.created_at },
      account: { id: account.id, currency: 'BRL', balanceCents: account.balance_cents },
    },
    session,
  };
}
