import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../../db/connection.js";
import type { Clock } from "../../../shared/clock.js";
import type { ContactDto } from "../../../shared/dto.js";
import { contactAlreadyExists } from "../../../shared/errors.js";
import {
  normalizeNickname,
  validateAccountId,
} from "../../../shared/validation.js";
import { getRecipient } from "../queries/get-recipient.js";
import { isUniqueConstraint } from "../../../shared/sqlite-errors.js";

export interface AddContactInput {
  nickname: unknown;
  recipientAccountId: unknown;
}

export interface AddContactDeps {
  db: SqliteDb;
  clock: Clock;
  generateId?: () => string;
}

export function addContact(
  deps: AddContactDeps,
  ownerUserId: string,
  ownerAccountId: string,
  input: AddContactInput,
): ContactDto {
  const nickname = normalizeNickname(input.nickname);
  const recipientAccountId = validateAccountId(input.recipientAccountId);

  const recipient = getRecipient(deps.db, ownerAccountId, recipientAccountId);

  const existing = deps.db
    .prepare(
      "SELECT 1 FROM contacts WHERE owner_user_id = ? AND recipient_account_id = ?",
    )
    .get(ownerUserId, recipientAccountId);
  if (existing) throw contactAlreadyExists();

  const generateId = deps.generateId ?? randomUUID;
  const nowIso = deps.clock.now().toISOString();
  const id = generateId();

  try {
    deps.db
      .prepare(
        `INSERT INTO contacts
           (id, owner_user_id, recipient_account_id, nickname, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, ownerUserId, recipientAccountId, nickname, nowIso);
  } catch (error) {
    if (isUniqueConstraint(error)) throw contactAlreadyExists();
    throw error;
  }

  return {
    id,
    nickname,
    recipientAccountId,
    recipientName: recipient.name,
    createdAt: nowIso,
  };
}
