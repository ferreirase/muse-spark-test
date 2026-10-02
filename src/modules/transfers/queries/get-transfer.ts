import type { SqliteDb } from "../../../db/connection.js";
import type { TransferDto } from "../../../shared/dto.js";
import { transferNotFound } from "../../../shared/errors.js";
import { findTransferWithRecipient, toTransferDto } from "../repositories.js";

export function getTransfer(
  db: SqliteDb,
  sourceAccountId: string,
  transferId: string,
): TransferDto {
  const row = findTransferWithRecipient(db, transferId);
  if (!row || row.source_account_id !== sourceAccountId) {
    throw transferNotFound();
  }
  return toTransferDto(row);
}
