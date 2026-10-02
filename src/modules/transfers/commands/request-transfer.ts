import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../../db/connection.js";
import type { Clock } from "../../../shared/clock.js";
import type { TransferDto } from "../../../shared/dto.js";
import { idempotencyConflict } from "../../../shared/errors.js";
import { isUniqueConstraint } from "../../../shared/sqlite-errors.js";
import {
  normalizeNote,
  validateAccountId,
  validateAmountCents,
  validateIdempotencyKey,
} from "../../../shared/validation.js";
import { getRecipient } from "../../contacts/queries/get-recipient.js";
import { payloadFingerprint } from "../fingerprint.js";
import {
  findTransferByIdempotency,
  findTransferWithRecipient,
  toTransferDto,
} from "../repositories.js";

export interface RequestTransferInput {
  recipientAccountId: unknown;
  amountCents: unknown;
  note?: unknown;
  idempotencyKey: unknown;
}

export interface RequestTransferDeps {
  db: SqliteDb;
  clock: Clock;
  generateId?: () => string;
}

export interface RequestTransferResult {
  transfer: TransferDto;
  created: boolean;
}

export function requestTransfer(
  deps: RequestTransferDeps,
  sourceAccountId: string,
  input: RequestTransferInput,
): RequestTransferResult {
  const recipientAccountId = validateAccountId(input.recipientAccountId);
  const amountCents = validateAmountCents(input.amountCents);
  const note = normalizeNote(input.note);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const fingerprint = payloadFingerprint({
    recipientAccountId,
    amountCents,
    note,
  });
  const generateId = deps.generateId ?? randomUUID;
  const nowIso = deps.clock.now().toISOString();

  const run = deps.db.transaction((): { transferId: string; created: boolean } => {
    getRecipient(deps.db, sourceAccountId, recipientAccountId);

    const existing = findTransferByIdempotency(
      deps.db,
      sourceAccountId,
      idempotencyKey,
    );
    if (existing) {
      if (existing.payload_fingerprint !== fingerprint) {
        throw idempotencyConflict();
      }
      return { transferId: existing.id, created: false };
    }

    const transferId = generateId();
    try {
      deps.db
        .prepare(
          `INSERT INTO transfers
             (id, source_account_id, recipient_account_id, amount_cents, note,
              status, failure_code, saga_step, in_transit_cents, attempts,
              last_error, idempotency_key, payload_fingerprint,
              created_at, updated_at)
           VALUES
             (@id, @source, @recipient, @amount, @note,
              'PENDING', NULL, 'CREATED', 0, 0,
              NULL, @idempotency_key, @fingerprint,
              @now, @now)`,
        )
        .run({
          id: transferId,
          source: sourceAccountId,
          recipient: recipientAccountId,
          amount: amountCents,
          note,
          idempotency_key: idempotencyKey,
          fingerprint,
          now: nowIso,
        });

      deps.db
        .prepare(
          `INSERT INTO jobs
             (id, transfer_id, status, run_after, attempts,
              locked_by, locked_until, last_error, created_at, updated_at)
           VALUES (?, ?, 'PENDING', ?, 0, NULL, NULL, NULL, ?, ?)`,
        )
        .run(generateId(), transferId, nowIso, nowIso, nowIso);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        const raced = findTransferByIdempotency(
          deps.db,
          sourceAccountId,
          idempotencyKey,
        );
        if (raced && raced.payload_fingerprint === fingerprint) {
          return { transferId: raced.id, created: false };
        }
        throw idempotencyConflict();
      }
      throw error;
    }

    return { transferId, created: true };
  });

  const result = run.immediate();
  const row = findTransferWithRecipient(deps.db, result.transferId);
  if (!row) {
    throw new Error("transfer disappeared after creation");
  }
  return { transfer: toTransferDto(row), created: result.created };
}
