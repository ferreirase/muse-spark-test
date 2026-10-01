import type Database from 'better-sqlite3';
import type { Contact } from '../../../shared/dto.js';

/**
 * Query ListContacts: contatos do dono ordenados por nickname e, em empate,
 * por id (collation BINARY — determinístico, igual ao mock do frontend).
 */
export function listContacts(readDb: Database.Database, ownerUserId: string): Contact[] {
  const rows = readDb
    .prepare(
      `SELECT c.id, c.nickname, c.recipient_account_id, c.created_at, u.name AS recipient_name
       FROM contacts c
       JOIN accounts a ON a.id = c.recipient_account_id
       JOIN users u ON u.id = a.user_id
       WHERE c.owner_user_id = ?
       ORDER BY c.nickname, c.id`,
    )
    .all(ownerUserId) as {
    id: string; nickname: string; recipient_account_id: string; created_at: string; recipient_name: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    recipientAccountId: r.recipient_account_id,
    recipientName: r.recipient_name,
    createdAt: r.created_at,
  }));
}
