import type Database from 'better-sqlite3';
import { errors } from '../../../shared/errors.js';
import type { Recipient } from '../../../shared/dto.js';

/** Leitura crua de destinatário por ID exato (reutilizada por comandos). */
export function findRecipient(readDb: Database.Database, accountId: string): Recipient | null {
  const row = readDb
    .prepare(
      'SELECT a.id, u.name FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id = ?',
    )
    .get(accountId) as { id: string; name: string } | undefined;
  if (!row) return null;
  return { accountId: row.id, name: row.name };
}

/**
 * Query GetRecipient: valida auto-referência (422) e existência (404);
 * expõe apenas nome e ID — nunca e-mail, saldo ou outros dados.
 */
export function getRecipient(
  readDb: Database.Database,
  input: { requesterAccountId: string; accountId: string },
): Recipient {
  if (input.accountId === input.requesterAccountId) throw errors.selfRecipient();
  const recipient = findRecipient(readDb, input.accountId);
  if (!recipient) throw errors.recipientNotFound();
  return recipient;
}
