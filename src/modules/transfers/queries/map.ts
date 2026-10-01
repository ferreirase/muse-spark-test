import type { Db } from '../../../db/connection.js';
import type { Transfer } from '../../../shared/dto.js';

export interface TransferRowFull {
  id: string;
  source_account_id: string;
  recipient_account_id: string;
  amount_cents: number;
  note: string | null;
  status: Transfer['status'];
  failure_code: Transfer['failureCode'];
  created_at: string;
  updated_at: string;
}

/** Mapeamento único linha → DTO (nunca expõe saga_step, in_transit, chaves, fingerprint). */
export function mapTransferRow(db: Db, row: TransferRowFull): Transfer {
  const nameRow = db
    .prepare(`SELECT u.name AS name FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id = ?`)
    .get(row.recipient_account_id) as { name: string } | undefined;
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    recipientAccountId: row.recipient_account_id,
    recipientName: nameRow?.name ?? '',
    amountCents: row.amount_cents,
    currency: 'BRL',
    note: row.note,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
