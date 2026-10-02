import type { SqliteDb } from "../../../db/connection.js";
import type { ContactDto } from "../../../shared/dto.js";

interface ContactRow {
  id: string;
  nickname: string;
  recipient_account_id: string;
  recipient_name: string;
  created_at: string;
}

export function listContacts(
  db: SqliteDb,
  ownerUserId: string,
): ContactDto[] {
  const rows = db
    .prepare(
      `SELECT c.id             AS id,
              c.nickname       AS nickname,
              c.recipient_account_id AS recipient_account_id,
              u.name           AS recipient_name,
              c.created_at     AS created_at
         FROM contacts c
         JOIN accounts a ON a.id = c.recipient_account_id
         JOIN users u ON u.id = a.user_id
        WHERE c.owner_user_id = ?
        ORDER BY c.nickname ASC, c.id ASC`,
    )
    .all(ownerUserId) as ContactRow[];

  return rows.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    recipientAccountId: row.recipient_account_id,
    recipientName: row.recipient_name,
    createdAt: row.created_at,
  }));
}
