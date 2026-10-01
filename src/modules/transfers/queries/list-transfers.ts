import type { Db } from '../../../db/connection.js';
import type { TransferPage } from '../../../shared/dto.js';
import { parseLimit } from '../../../shared/validation.js';
import { decodeCursor, encodeCursor } from '../cursor.js';
import { mapTransferRow, type TransferRowFull } from './map.js';

/** Query ListTransfers: paginação por cursor opaco, só enviadas. */
export function listTransfers(
  readDb: Db,
  args: { sourceAccountId: string; limit?: unknown; cursor?: unknown },
): TransferPage {
  const limit = parseLimit(args.limit);
  const cursor = args.cursor === undefined || args.cursor === '' ? null : decodeCursor(args.cursor);

  const rows = (
    cursor === null
      ? readDb
          .prepare(
            `SELECT id, source_account_id, recipient_account_id, amount_cents, note,
                    status, failure_code, created_at, updated_at
             FROM transfers
             WHERE source_account_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?`,
          )
          .all(args.sourceAccountId, limit + 1)
      : readDb
          .prepare(
            `SELECT id, source_account_id, recipient_account_id, amount_cents, note,
                    status, failure_code, created_at, updated_at
             FROM transfers
             WHERE source_account_id = ?
               AND (created_at, id) < (?, ?)
             ORDER BY created_at DESC, id DESC
             LIMIT ?`,
          )
          .all(args.sourceAccountId, cursor.createdAt, cursor.id, limit + 1)
  ) as TransferRowFull[];

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  return {
    items: page.map((r) => mapTransferRow(readDb, r)),
    nextCursor: hasMore && last !== undefined ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}
