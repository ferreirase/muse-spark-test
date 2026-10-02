import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../../db/connection.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuthResultDto } from "../../../shared/dto.js";
import { emailAlreadyExists } from "../../../shared/errors.js";
import {
  normalizeEmail,
  normalizeName,
  validatePassword,
} from "../../../shared/validation.js";
import { hashPassword } from "../password.js";
import {
  emailExists,
  insertAccount,
  insertUser,
  type AccountRow,
  type UserRow,
} from "../repositories.js";
import { toAccountDto, toUserDto } from "../mappers.js";
import { createSession } from "./session.js";

export interface SignupInput {
  name: unknown;
  email: unknown;
  password: unknown;
}

export interface SignupDeps {
  db: SqliteDb;
  clock: Clock;
  hash?: (password: string) => Promise<string>;
  generateId?: () => string;
}

export interface SignupResult {
  auth: AuthResultDto;
  token: string;
  sessionId: string;
  expiresAt: string;
}

export async function signup(
  deps: SignupDeps,
  input: SignupInput,
): Promise<SignupResult> {
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const generateId = deps.generateId ?? randomUUID;
  const passwordHash = await (deps.hash ?? hashPassword)(password);
  const now = deps.clock.now();
  const nowIso = now.toISOString();

  const userId = generateId();
  const accountId = generateId();

  const run = deps.db.transaction(() => {
    if (emailExists(deps.db, email)) {
      throw emailAlreadyExists();
    }
    const user: UserRow = {
      id: userId,
      name,
      email,
      password_hash: passwordHash,
      created_at: nowIso,
      updated_at: nowIso,
    };
    insertUser(deps.db, user);
    const account: AccountRow = {
      id: accountId,
      user_id: userId,
      currency: "BRL",
      balance_cents: 0,
      updated_at: nowIso,
    };
    insertAccount(deps.db, account);
    const session = createSession(deps.db, {
      userId,
      now,
      ...(deps.generateId ? { generateId: deps.generateId } : {}),
    });
    return { user, account, session };
  });

  const created = run.immediate();

  return {
    auth: {
      user: toUserDto(created.user),
      account: toAccountDto(created.account),
    },
    token: created.session.token,
    sessionId: created.session.row.id,
    expiresAt: created.session.row.expires_at,
  };
}
