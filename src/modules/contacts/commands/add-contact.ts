import { randomUUID } from 'node:crypto';
import type { Db } from '../../../db/connection.js';
import type { Clock } from '../../../shared/clock.js';
import type { Contact } from '../../../shared/dto.js';
import { AppError } from '../../../shared/errors.js';
import { normalizeNickname } from '../../../shared/validation.js';
import { findRecipient } from '../queries/get-recipient.js';

export interface AddContactDeps {
  db: Db;
  clock: Clock;
  uuid?: () => string;
}

/** Comando AddContact (escrita). Reutiliza findRecipient para validar existência. */
export function addContact(
  deps: AddContactDeps,
  args: { ownerUserId: string; ownerAccountId: string; nickname: unknown; recipientAccountId: unknown },
): Contact {
  const nickname = normalizeNickname(args.nickname);
  const recipientAccountId = typeof args.recipientAccountId === 'string' ? args.recipientAccountId : '';
  if (recipientAccountId === '') {
    throw new AppError('RECIPIENT_NOT_FOUND', 404, 'Destinatário não encontrado');
  }
  if (recipientAccountId === args.ownerAccountId) {
    throw new AppError('SELF_RECIPIENT', 422, 'Não é possível cadastrar a própria conta');
  }
  const found = findRecipient(deps.db, recipientAccountId);
  if (found === null) {
    throw new AppError('RECIPIENT_NOT_FOUND', 404, 'Destinatário não encontrado');
  }
  const uuid = deps.uuid ?? randomUUID;
  const id = uuid();
  const now = deps.clock.now().toISOString();
  try {
    deps.db
      .prepare(
        `INSERT INTO contacts (id, owner_user_id, recipient_account_id, nickname, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, args.ownerUserId, recipientAccountId, nickname, now);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test((err as Error).message)) {
      throw new AppError('CONTACT_ALREADY_EXISTS', 409, 'Contato já cadastrado');
    }
    throw err;
  }
  return { id, nickname, recipientAccountId, recipientName: found.name, createdAt: now };
}
