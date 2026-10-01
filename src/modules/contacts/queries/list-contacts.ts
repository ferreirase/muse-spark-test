import type { Db } from '../../../db/connection.js';
import type { Contact } from '../../../shared/dto.js';

/**
 * Query ListContacts: só SELECT. Ordem por nickname (collation BINARY determinística)
 * e, em empate, por id — mesma ordem do índice idx_contacts_owner.
 */
export function listContacts(readDb: Db, ownerUserId: string): Contact[] {
  const rows = readDb
    .prepare(
      `SELECT c.id AS id, c.nickname AS nickname,
              c.recipient_account_id AS recipientAccountId,
              u.name AS recipientName, c.created_at AS createdAt
       FROM contacts c
       JOIN accounts a ON a.id = c.recipient_account_id
       JOIN users u ON u.id = a.user_id
       WHERE c.owner_user_id = ?
       ORDER BY c.nickname COLLATE BINARY, c.id`,
    )
    .all(ownerUserId) as Contact[];
  return rows;
}
