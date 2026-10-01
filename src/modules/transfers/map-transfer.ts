import type { Transfer, TransferStatus, TransferFailureCode } from '../../shared/dto.js';

export interface TransferRow {
  id: string;
  source_account_id: string;
  recipient_account_id: string;
  amount_cents: number;
  note: string | null;
  status: string;
  failure_code: string | null;
  idempotency_key: string;
  payload_fingerprint: string;
  created_at: string;
  updated_at: string;
}

/** Mapeamento único da linha SQL para o DTO Transfer do contrato. */
export function mapTransferRow(row: TransferRow, recipientName: string): Transfer {
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    recipientAccountId: row.recipient_account_id,
    recipientName,
    amountCents: row.amount_cents,
    currency: 'BRL',
    note: row.note,
    status: row.status as TransferStatus,
    failureCode: (row.failure_code as TransferFailureCode) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
