import type { SqliteDb } from "../../db/connection.js";
import type {
  FailureCode,
  TransferDto,
  TransferStatus,
} from "../../shared/dto.js";

export type SagaStep =
  | "CREATED"
  | "DEBITED"
  | "COMPENSATING"
  | "COMPLETED"
  | "FAILED";

export interface TransferRow {
  id: string;
  source_account_id: string;
  recipient_account_id: string;
  amount_cents: number;
  note: string | null;
  status: TransferStatus;
  failure_code: FailureCode | null;
  saga_step: SagaStep;
  in_transit_cents: number;
  attempts: number;
  last_error: string | null;
  idempotency_key: string;
  payload_fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface TransferWithRecipient extends TransferRow {
  recipient_name: string;
}

export function findTransferById(
  db: SqliteDb,
  id: string,
): TransferRow | undefined {
  return db.prepare("SELECT * FROM transfers WHERE id = ?").get(id) as
    | TransferRow
    | undefined;
}

export function findTransferByIdempotency(
  db: SqliteDb,
  sourceAccountId: string,
  idempotencyKey: string,
): TransferRow | undefined {
  return db
    .prepare(
      "SELECT * FROM transfers WHERE source_account_id = ? AND idempotency_key = ?",
    )
    .get(sourceAccountId, idempotencyKey) as TransferRow | undefined;
}

export function findTransferWithRecipient(
  db: SqliteDb,
  transferId: string,
): TransferWithRecipient | undefined {
  return db
    .prepare(
      `SELECT t.*, u.name AS recipient_name
         FROM transfers t
         JOIN accounts a ON a.id = t.recipient_account_id
         JOIN users u ON u.id = a.user_id
        WHERE t.id = ?`,
    )
    .get(transferId) as TransferWithRecipient | undefined;
}

export function toTransferDto(row: TransferWithRecipient): TransferDto {
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    recipientAccountId: row.recipient_account_id,
    recipientName: row.recipient_name,
    amountCents: row.amount_cents,
    currency: "BRL",
    note: row.note,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
