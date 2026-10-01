import type { Db } from '../../../db/connection.js';
import type { Recipient } from '../../../shared/dto.js';
import { AppError } from '../../../shared/errors.js';

/** Busca destinatário por ID exato (sem normalização). Só id + nome. */
export function findRecipient(readDb: Db, accountId: string): Recipient | null {
  const row = readDb
    .prepare(
      `SELECT a.id AS accountId, u.name AS name
       FROM accounts a JOIN users u ON u.id = a.user_id
       WHERE a.id = ?`,
    )
    .get(accountId) as Recipient | undefined;
  return row ?? null;
}

/** Regras: self → 422; inexistente → 404. Reutilizada por contatos e transferências. */
export function getRecipient(
  readDb: Db,
  args: { requesterAccountId: string; accountId: string },
): Recipient {
  if (args.accountId === args.requesterAccountId) {
    throw new AppError('SELF_RECIPIENT', 422, 'Não é possível usar a própria conta');
  }
  const found = findRecipient(readDb, args.accountId);
  if (found === null) {
    throw new AppError('RECIPIENT_NOT_FOUND', 404, 'Destinatário não encontrado');
  }
  return found;
}
