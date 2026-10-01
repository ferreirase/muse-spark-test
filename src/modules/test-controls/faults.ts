import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Clock } from '../../shared/clock.js';
import { checkIdempotencyKey, checkId } from '../../shared/validation.js';
import { errors } from '../../shared/errors.js';
import type { SagaHooks, TransferSnapshot } from '../transfers/saga/orchestrator.js';
import type { PauseRegistry } from './pause-registry.js';

export type FaultMode = 'FAIL_CREDIT_ONCE' | 'PAUSE_AFTER_DEBIT';

const MODES: readonly FaultMode[] = ['FAIL_CREDIT_ONCE', 'PAUSE_AFTER_DEBIT'];

/**
 * Arma (ou rearma, resetando o consumo) uma fault de teste associada a
 * (sourceAccountId, idempotencyKey) — uma única transferência (contrato §8).
 */
export function armFault(
  db: Database.Database,
  input: { sourceAccountId: unknown; idempotencyKey: unknown; mode: unknown },
  now: Date,
): { armed: true } {
  const sourceAccountId = checkId(input.sourceAccountId, 'sourceAccountId');
  const idempotencyKey = checkIdempotencyKey(input.idempotencyKey);
  const mode = input.mode;
  if (typeof mode !== 'string' || !MODES.includes(mode as FaultMode)) {
    throw errors.validation([{ field: 'mode', message: 'mode deve ser FAIL_CREDIT_ONCE ou PAUSE_AFTER_DEBIT' }]);
  }
  db.prepare(
    `INSERT INTO test_faults (id, source_account_id, idempotency_key, mode, armed_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(source_account_id, idempotency_key) DO UPDATE SET
       mode = excluded.mode, armed_at = excluded.armed_at,
       consumed_at = NULL, transfer_id = NULL`,
  ).run(randomUUID(), sourceAccountId, idempotencyKey, mode, now.toISOString());
  return { armed: true };
}

/**
 * Consome a fault PAUSE_AFTER_DEBIT (atomicamente; changes=1 só na primeira).
 * O consumo é persistido ANTES de bloquear a saga.
 */
export function consumePauseFault(db: Database.Database, t: TransferSnapshot, nowIso: string): boolean {
  const r = db
    .prepare(
      "UPDATE test_faults SET consumed_at = ?, transfer_id = ? WHERE source_account_id = ? AND idempotency_key = ? AND mode = 'PAUSE_AFTER_DEBIT' AND consumed_at IS NULL",
    )
    .run(nowIso, t.id, t.sourceAccountId, t.idempotencyKey);
  return r.changes === 1;
}

export function hasUnconsumedFailFault(db: Database.Database, t: TransferSnapshot): boolean {
  return db
    .prepare(
      "SELECT 1 FROM test_faults WHERE source_account_id = ? AND idempotency_key = ? AND mode = 'FAIL_CREDIT_ONCE' AND consumed_at IS NULL",
    )
    .get(t.sourceAccountId, t.idempotencyKey) !== undefined;
}

/** Consumo da fault FAIL_CREDIT_ONCE — chamado dentro da tx de markCompensating. */
export function consumeFailFault(db: Database.Database, t: TransferSnapshot, nowIso: string): void {
  db.prepare(
    "UPDATE test_faults SET consumed_at = ?, transfer_id = ? WHERE source_account_id = ? AND idempotency_key = ? AND mode = 'FAIL_CREDIT_ONCE' AND consumed_at IS NULL",
  ).run(nowIso, t.id, t.sourceAccountId, t.idempotencyKey);
}

export interface FaultHooksDeps {
  db: Database.Database;
  clock: Clock;
  registry: PauseRegistry;
  logger?: { info: (o: object, m?: string) => void };
}

/**
 * Hooks da Saga para os controles de avaliação. Só são passados ao worker
 * quando ENABLE_TEST_CONTROLS=true; caso contrário nunca consultam a tabela.
 */
export function createFaultHooks(deps: FaultHooksDeps): SagaHooks & { consumeOnCompensate: (t: TransferSnapshot) => void } {
  return {
    afterDebit: async (transfer, signal) => {
      const nowIso = deps.clock().toISOString();
      if (!consumePauseFault(deps.db, transfer, nowIso)) return;
      deps.logger?.info({ transferId: transfer.id }, 'fault: PAUSE_AFTER_DEBIT ativada');
      await deps.registry.wait(transfer.id, signal);
    },
    beforeCredit: async (transfer) => {
      if (hasUnconsumedFailFault(deps.db, transfer)) return 'FAIL' as const;
      return 'CONTINUE' as const;
    },
    consumeOnCompensate: (transfer) => {
      consumeFailFault(deps.db, transfer, deps.clock().toISOString());
    },
  };
}
