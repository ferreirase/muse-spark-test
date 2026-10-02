import type { SqliteDb } from "../../../db/connection.js";
import type { RecipientDto } from "../../../shared/dto.js";
import { recipientNotFound, selfRecipient } from "../../../shared/errors.js";

interface RecipientRow {
  account_id: string;
  name: string;
}

export function getRecipient(
  db: SqliteDb,
  requesterAccountId: string,
  accountId: string,
): RecipientDto {
  const row = db
    .prepare(
      `SELECT a.id AS account_id, u.name AS name
         FROM accounts a
         JOIN users u ON u.id = a.user_id
        WHERE a.id = ?`,
    )
    .get(accountId) as RecipientRow | undefined;

  if (!row) throw recipientNotFound();
  if (row.account_id === requesterAccountId) throw selfRecipient();

  return { accountId: row.account_id, name: row.name };
}
