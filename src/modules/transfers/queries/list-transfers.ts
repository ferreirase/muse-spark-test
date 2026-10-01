import type Database from 'better-sqlite3';
import type { Transfer, TransferPage } from '../../../shared/dto.js';
import { mapTransferRow, type TransferRow } from '../map-transfer.js';
import { decodeCursor, encodeCursor } from '../cursor.js';
import { findRecipient } from '../../contacts/queries/get-recipient.js';

/**
 * Query ListTransfers: histórico paginado do remetente, ordem decrescente
 * por createdAt e id, cursor opaco (keyset pagination).
 */
export function listTransfers(
  readDb: Database.Database,
  input: { sourceAccountId: string; limit: number; cursor: string | null },
): TransferPage {
  const recipientNames = new Map<string, string>();
  const nameOf = (accountId: string): string => {
    let n = recipientNames.get(accountId);
    if (n === undefined) {
      n = findRecipient(readDb, accountId)?.name ?? '';
      recipientNames.set(accountId, n);
    }
    return n;
  };

  const base = `SELECT * FROM transfers WHERE source_account_id = ?`;
  const order = ` ORDER BY created_at DESC, id DESC`;

  let rows: TransferRow[];
  let hasMore = false;
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
    rows = readDb
      .prepare(`${base} AND (created_at, id) < (?, ?)${order} LIMIT ?`)
      .all(input.sourceAccountId, c.createdAt, c.id, input.limit + 1) as TransferRow[];
  } else {
    rows = readDb
      .prepare(`${base}${order} LIMIT ?`)
      .all(input.sourceAccountId, input.limit + 1) as TransferRow[];
  }
  if (rows.length > input.limit) {
    hasMore = true;
    rows = rows.slice(0, input.limit);
  }

  const items: Transfer[] = rows.map((r) => mapTransferRow(r, nameOf(r.recipient_account_id)));
  const last = rows[input.limit - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}
