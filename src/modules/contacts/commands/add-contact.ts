import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Contact } from '../../../shared/dto.js';
import { errors } from '../../../shared/errors.js';
import { normalizeNickname } from '../../../shared/validation.js';
import { findRecipient } from '../queries/get-recipient.js';

export interface AddContactDeps {
  db: Database.Database;
  now: Date;
  uuid?: () => string;
}

export interface AddContactInput {
  ownerUserId: string;
  ownerAccountId: string;
  nickname: unknown;
  recipientAccountId: string;
}

/** Comando AddContact (B04): validação de domínio + insert persistido. */
export function addContact(deps: AddContactDeps, input: AddContactInput): Contact {
  const nickname = normalizeNickname(input.nickname);

  if (input.recipientAccountId === input.ownerAccountId) throw errors.selfRecipient();
  const recipient = findRecipient(deps.db, input.recipientAccountId);
  if (!recipient) throw errors.recipientNotFound();

  const id = (deps.uuid ?? randomUUID)();
  const createdAt = deps.now.toISOString();

  try {
    deps.db
      .prepare('INSERT INTO contacts (id, owner_user_id, recipient_account_id, nickname, created_at) VALUES (?,?,?,?,?)')
      .run(id, input.ownerUserId, input.recipientAccountId, nickname, createdAt);
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw errors.contactExists();
    }
    throw err;
  }

  return {
    id,
    nickname,
    recipientAccountId: input.recipientAccountId,
    recipientName: recipient.name,
    createdAt,
  };
}
