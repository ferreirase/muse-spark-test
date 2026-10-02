import type { SqliteDb } from "../../../db/connection.js";
import type { TransferDto, TransferPageDto } from "../../../shared/dto.js";
import { toTransferDto, type TransferWithRecipient } from "../repositories.js";
import {
  decodeTransferCursor,
  encodeTransferCursor,
} from "./cursor.js";

export interface ListTransfersOptions {
  limit: number;
  cursor?: string | undefined;
}

export function listTransfers(
  db: SqliteDb,
  sourceAccountId: string,
  options: ListTransfersOptions,
): TransferPageDto {
  const limit = options.limit;
  const params: unknown[] = [sourceAccountId];
  let keyset = "";

  if (options.cursor !== undefined && options.cursor !== "") {
    const cursor = decodeTransferCursor(options.cursor);
    keyset = " AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))";
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  params.push(limit + 1);

  const rows = db
    .prepare(
      `SELECT t.*, u.name AS recipient_name
         FROM transfers t
         JOIN accounts a ON a.id = t.recipient_account_id
         JOIN users u ON u.id = a.user_id
        WHERE t.source_account_id = ?${keyset}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ?`,
    )
    .all(...params) as TransferWithRecipient[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items: TransferDto[] = page.map(toTransferDto);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeTransferCursor(last.created_at, last.id) : null;

  return { items, nextCursor };
}
