import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Transfer } from '../../../shared/dto.js';
import { errors } from '../../../shared/errors.js';
import { normalizeNote } from '../../../shared/validation.js';
import { findRecipient } from '../../contacts/queries/get-recipient.js';
import { mapTransferRow, type TransferRow } from '../map-transfer.js';
import { fingerprintTransferPayload } from '../fingerprint.js';

export interface RequestTransferDeps {
  db: Database.Database;
  now: Date;
  uuid?: () => string;
  /** Callback pós-commit (worker.wake) para latência < 5 s. */
  onAccepted?: () => void;
}

export interface RequestTransferInput {
  sourceAccountId: string;
  idempotencyKey: string;
  recipientAccountId: string;
  amountCents: number;
  note: unknown;
}

export interface RequestTransferResult {
  transfer: Transfer;
  replay: boolean;
}

function findByKey(db: Database.Database, sourceAccountId: string, key: string): TransferRow | undefined {
  return db
    .prepare('SELECT * FROM transfers WHERE source_account_id=? AND idempotency_key=?')
    .get(sourceAccountId, key) as TransferRow | undefined;
}

function toTransfer(db: Database.Database, row: TransferRow): Transfer {
  const recipient = findRecipient(db, row.recipient_account_id);
  return mapTransferRow(row, recipient?.name ?? '');
}

/**
 * Comando RequestTransfer (B05/B07): valida, normaliza, aplica idempotência
 * por (conta remetente, chave) e persiste transferência CREATED + job durável
 * em UMA transação antes de responder. Corrida na unicidade vira replay ou
 * conflito — nunca 500.
 */
export function requestTransfer(deps: RequestTransferDeps, input: RequestTransferInput): RequestTransferResult {
  const { db, now } = deps;
  const note = normalizeNote(input.note);
  const fingerprint = fingerprintTransferPayload({
    recipientAccountId: input.recipientAccountId,
    amountCents: input.amountCents,
    note,
  });

  const existing = findByKey(db, input.sourceAccountId, input.idempotencyKey);
  if (existing) return replayOrConflict(db, existing, fingerprint);

  if (input.recipientAccountId === input.sourceAccountId) throw errors.selfTransfer();
  const recipient = findRecipient(db, input.recipientAccountId);
  if (!recipient) throw errors.recipientNotFound();

  const transferId = (deps.uuid ?? randomUUID)();
  const nowIso = now.toISOString();

  const run = db.transaction((): TransferRow => {
    db.prepare(
      "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,'PENDING',NULL,'CREATED',0,0,?,?,?,?)",
    ).run(transferId, input.sourceAccountId, input.recipientAccountId, input.amountCents, note, input.idempotencyKey, fingerprint, nowIso, nowIso);
    db.prepare("INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,'PENDING',?,?,?)")
      .run((deps.uuid ?? randomUUID)(), transferId, nowIso, nowIso, nowIso);
    return db.prepare('SELECT * FROM transfers WHERE id=?').get(transferId) as TransferRow;
  });

  let row: TransferRow;
  try {
    row = run.immediate();
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const raced = findByKey(db, input.sourceAccountId, input.idempotencyKey);
      if (raced) return replayOrConflict(db, raced, fingerprint);
    }
    throw err;
  }

  deps.onAccepted?.();
  return { transfer: mapTransferRow(row, recipient.name), replay: false };
}

function replayOrConflict(db: Database.Database, existing: TransferRow, fingerprint: string): RequestTransferResult {
  if (existing.payload_fingerprint === fingerprint) {
    return { transfer: toTransfer(db, existing), replay: true };
  }
  throw errors.idempotencyConflict();
}
