import type { Db } from '../../../db/connection.js';
import type { Transfer } from '../../../shared/dto.js';
import { AppError } from '../../../shared/errors.js';
import { mapTransferRow, type TransferRowFull } from './map.js';

/** Query GetTransfer: só enviadas pelo usuário; resto → 404. */
export function getTransfer(
  readDb: Db,
  args: { sourceAccountId: string; transferId: string },
): Transfer {
  const row = readDb
    .prepare(
      `SELECT id, source_account_id, recipient_account_id, amount_cents, note,
              status, failure_code, created_at, updated_at
       FROM transfers WHERE id = ? AND source_account_id = ?`,
    )
    .get(args.transferId, args.sourceAccountId) as TransferRowFull | undefined;
  if (row === undefined) {
    throw new AppError('TRANSFER_NOT_FOUND', 404, 'Transferência não encontrada');
  }
  return mapTransferRow(readDb, row);
}
