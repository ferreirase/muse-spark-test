import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../../db/connection.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuthResultDto } from "../../../shared/dto.js";
import { invalidCredentials } from "../../../shared/errors.js";
import { normalizeEmail, validatePassword } from "../../../shared/validation.js";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../password.js";
import {
  findAccountByUserId,
  findUserByEmail,
} from "../repositories.js";
import { toAccountDto, toUserDto } from "../mappers.js";
import { createSession } from "./session.js";

export interface SigninInput {
  email: unknown;
  password: unknown;
}

export interface SigninDeps {
  db: SqliteDb;
  clock: Clock;
  verify?: (password: string, stored: string) => Promise<boolean>;
  generateId?: () => string;
}

export interface SigninResult {
  auth: AuthResultDto;
  token: string;
  sessionId: string;
  expiresAt: string;
}

export async function signin(
  deps: SigninDeps,
  input: SigninInput,
): Promise<SigninResult> {
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);

  const verify = deps.verify ?? verifyPassword;
  const user = findUserByEmail(deps.db, email);
  if (!user) {
    await verify(password, DUMMY_PASSWORD_HASH);
    throw invalidCredentials();
  }

  const valid = await verify(password, user.password_hash);
  if (!valid) throw invalidCredentials();

  const account = findAccountByUserId(deps.db, user.id);
  if (!account) throw invalidCredentials();

  const now = deps.clock.now();
  const session = createSession(deps.db, {
    userId: user.id,
    now,
    ...(deps.generateId ? { generateId: deps.generateId } : {}),
  });

  return {
    auth: {
      user: toUserDto(user),
      account: toAccountDto(account),
    },
    token: session.token,
    sessionId: session.row.id,
    expiresAt: session.row.expires_at,
  };
}
