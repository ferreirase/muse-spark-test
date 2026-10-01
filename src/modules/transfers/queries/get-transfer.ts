import type Database from 'better-sqlite3';
import type { Transfer } from '../../../shared/dto.js';
import { errors } from '../../../shared/errors.js';
import { mapTransferRow, type TransferRow } from '../map-transfer.js';
import { findRecipient } from '../../contacts/queries/get-recipient.js';

/**
 * Query GetTransfer: detalhe restrito às transferências ENVIADAS pelo
 * usuário; ID de outro usuário (mesmo destinatário) → 404.
 */
export function getTransfer(
  readDb: Database.Database,
  input: { sourceAccountId: string; transferId: string },
): Transfer {
  const row = readDb
    .prepare('SELECT * FROM transfers WHERE id=? AND source_account_id=?')
    .get(input.transferId, input.sourceAccountId) as TransferRow | undefined;
  if (!row) throw errors.transferNotFound();
  const recipient = findRecipient(readDb, row.recipient_account_id);
  return mapTransferRow(row, recipient?.name ?? '');
}
