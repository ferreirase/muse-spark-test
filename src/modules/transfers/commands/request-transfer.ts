import { randomUUID } from 'node:crypto';
import type { Db } from '../../../db/connection.js';
import type { Clock } from '../../../shared/clock.js';
import type { Transfer } from '../../../shared/dto.js';
import { AppError } from '../../../shared/errors.js';
import {
  checkAmountCents,
  checkIdempotencyKey,
  normalizeNote,
} from '../../../shared/validation.js';
import { findRecipient } from '../../contacts/queries/get-recipient.js';
import { fingerprintTransferPayload } from '../fingerprint.js';

export interface RequestTransferDeps {
  db: Db;
  clock: Clock;
  uuid?: () => string;
  /** Notifica o worker in-process após o commit. */
  onAccepted?: (transferId: string) => void;
}

export interface RequestTransferInput {
  sourceAccountId: string;
  idempotencyKey: unknown;
  body: { recipientAccountId: unknown; amountCents: unknown; note?: unknown };
}

interface TransferRow {
  id: string;
  source_account_id: string;
  recipient_account_id: string;
  amount_cents: number;
  note: string | null;
  status: Transfer['status'];
  failure_code: Transfer['failureCode'];
  payload_fingerprint: string;
  created_at: string;
  updated_at: string;
}

function toDto(db: Db, row: TransferRow): Transfer {
  const nameRow = db
    .prepare(
      `SELECT u.name AS name FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id = ?`,
    )
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

function findExisting(db: Db, sourceAccountId: string, key: string): TransferRow | undefined {
  return db
    .prepare(`SELECT * FROM transfers WHERE source_account_id = ? AND idempotency_key = ?`)
    .get(sourceAccountId, key) as TransferRow | undefined;
}

function resolveExisting(
  db: Db,
  existing: TransferRow,
  fingerprint: string,
): { transfer: Transfer; replay: true } {
  if (existing.payload_fingerprint !== fingerprint) {
    throw new AppError('IDEMPOTENCY_CONFLICT', 409, 'Idempotency-Key já usada com payload diferente');
  }
  return { transfer: toDto(db, existing), replay: true };
}

/** Comando RequestTransfer: valida, aplica idempotência e persiste transfer+job na mesma tx. */
export function requestTransfer(
  deps: RequestTransferDeps,
  input: RequestTransferInput,
): { transfer: Transfer; replay: boolean } {
  const key = checkIdempotencyKey(input.idempotencyKey);
  const recipientAccountId =
    typeof input.body.recipientAccountId === 'string' ? input.body.recipientAccountId : '';
  const amountCents = checkAmountCents(input.body.amountCents);
  const note = normalizeNote(input.body.note);
  if (recipientAccountId === '') {
    throw new AppError('RECIPIENT_NOT_FOUND', 404, 'Destinatário não encontrado');
  }
  if (recipientAccountId === input.sourceAccountId) {
    throw new AppError('SELF_TRANSFER', 422, 'Não é possível transferir para a própria conta');
  }
  const found = findRecipient(deps.db, recipientAccountId);
  if (found === null) {
    throw new AppError('RECIPIENT_NOT_FOUND', 404, 'Destinatário não encontrado');
  }

  const fingerprint = fingerprintTransferPayload({ recipientAccountId, amountCents, note });
  const pre = findExisting(deps.db, input.sourceAccountId, key);
  if (pre !== undefined) return resolveExisting(deps.db, pre, fingerprint);

  const uuid = deps.uuid ?? randomUUID;
  const id = uuid();
  const now = deps.clock.now().toISOString();
  const tx = deps.db.transaction(() => {
    deps.db
      .prepare(
        `INSERT INTO transfers (id, source_account_id, recipient_account_id, amount_cents, note,
           status, failure_code, saga_step, in_transit_cents, attempts, last_error,
           idempotency_key, payload_fingerprint, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, 'CREATED', 0, 0, NULL, ?, ?, ?, ?)`,
      )
      .run(id, input.sourceAccountId, recipientAccountId, amountCents, note, key, fingerprint, now, now);
    deps.db
      .prepare(
        `INSERT INTO jobs (id, transfer_id, status, run_after, attempts, locked_by, locked_until, last_error, created_at, updated_at)
         VALUES (?, ?, 'PENDING', ?, 0, NULL, NULL, NULL, ?, ?)`,
      )
      .run(`job-${id}`, id, now, now, now);
  });
  try {
    tx.immediate();
  } catch (err) {
    // Corrida: outro pedido inseriu a mesma chave entre o SELECT e o INSERT.
    const code = (err as { code?: unknown }).code;
    const unique =
      code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test((err as Error).message);
    if (unique) {
      const raced = findExisting(deps.db, input.sourceAccountId, key);
      if (raced !== undefined) return resolveExisting(deps.db, raced, fingerprint);
    }
    throw err;
  }

  const row = deps.db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as TransferRow;
  const dto = toDto(deps.db, row);
  deps.onAccepted?.(id);
  return { transfer: dto, replay: false };
}
