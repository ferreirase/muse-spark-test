import type { Db } from '../../../db/connection.js';
import {
  CreditFailedError,
  compensateStep,
  creditStep,
  debitStep,
  markCompensating,
  type SagaStep,
} from './steps.js';
import { TransientExhaustedError, withRetry, type RetryOptions } from './retry.js';

export type SagaOutcome = 'COMPLETED' | 'FAILED' | 'RETRY_LATER';

/** Pontos de extensão para faults de teste (MT-29). Default: no-op. */
export interface SagaHooks {
  /** Chamado após o commit do débito, antes de qualquer crédito. Pode pausar. */
  afterDebit?: (transfer: { id: string; sourceAccountId: string; idempotencyKey: string }) => Promise<void>;
  /** Chamado antes do crédito: 'FAIL' força falha definitiva. */
  beforeCredit?: (transfer: { id: string; sourceAccountId: string; idempotencyKey: string }) => 'FAIL' | 'CONTINUE';
}

export interface RunSagaDeps {
  db: Db;
  now: () => string;
  retry?: RetryOptions;
  hooks?: SagaHooks;
  signal?: AbortSignal | undefined;
  log?: (fields: Record<string, unknown>, msg: string) => void;
  /** Overrides de passos (testes de retry transitório). */
  steps?: {
    debit?: typeof debitStep;
    credit?: typeof creditStep;
    markComp?: typeof markCompensating;
    compensate?: typeof compensateStep;
  };
}

function readTransferMeta(
  db: Db,
  transferId: string,
): { step: SagaStep; sourceAccountId: string; idempotencyKey: string } | null {
  const row = db
    .prepare('SELECT saga_step AS step, source_account_id AS sourceAccountId, idempotency_key AS idempotencyKey FROM transfers WHERE id=?')
    .get(transferId) as { step: SagaStep; sourceAccountId: string; idempotencyKey: string } | undefined;
  return row ?? null;
}

function recordRecoverable(db: Db, transferId: string, now: string, message: string): void {
  db.prepare(`UPDATE transfers SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`).run(
    message,
    now,
    transferId,
  );
  db.prepare(`UPDATE jobs SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE transfer_id = ?`).run(
    message,
    now,
    transferId,
  );
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Orquestrador: lê o estado persistido e avança até terminal ou RETRY_LATER.
 * Erro inesperado/transitório esgotado → grava attempts/last_error, nunca FAILED.
 */
export async function runSaga(deps: RunSagaDeps, transferId: string): Promise<SagaOutcome> {
  const log = deps.log ?? (() => undefined);
  const retry = deps.retry ?? {};
  const hooks = deps.hooks ?? {};
  const steps = {
    debit: deps.steps?.debit ?? debitStep,
    credit: deps.steps?.credit ?? creditStep,
    markComp: deps.steps?.markComp ?? markCompensating,
    compensate: deps.steps?.compensate ?? compensateStep,
  };

  for (;;) {
    if (aborted(deps.signal)) {
      log({ transferId, step: 'ABORTED' }, 'saga abortada');
      return 'RETRY_LATER';
    }
    const meta = readTransferMeta(deps.db, transferId);
    if (meta === null) throw new Error(`transferência inexistente: ${transferId}`);
    const step = meta.step;
    if (step === 'COMPLETED') return 'COMPLETED';
    if (step === 'FAILED') return 'FAILED';

    const now = deps.now();
    try {
      if (step === 'CREATED') {
        log({ transferId, step }, 'debitando');
        const r = await withRetry(() => steps.debit(deps.db, transferId, deps.now()), retry);
        log({ transferId, step, result: r }, 'débito concluído');
        if (r === 'INSUFFICIENT_FUNDS') return 'FAILED';
        continue;
      }
      if (step === 'DEBITED') {
        const hookTransfer = { id: transferId, sourceAccountId: meta.sourceAccountId, idempotencyKey: meta.idempotencyKey };
        await hooks.afterDebit?.(hookTransfer);
        if (aborted(deps.signal)) {
          log({ transferId, step: 'ABORTED' }, 'saga abortada após débito');
          return 'RETRY_LATER';
        }
        if (hooks.beforeCredit?.(hookTransfer) === 'FAIL') {
          log({ transferId, step }, 'falha definitiva injetada antes do crédito');
          await withRetry(() => steps.markComp(deps.db, transferId, 'injected FAIL_CREDIT', deps.now()), retry);
          continue;
        }
        log({ transferId, step }, 'creditando');
        try {
          await withRetry(() => steps.credit(deps.db, transferId, deps.now()), retry);
        } catch (err) {
          if (err instanceof CreditFailedError) {
            log({ transferId, step, err: String(err) }, 'crédito falhou, compensando');
            await withRetry(() => steps.markComp(deps.db, transferId, String(err), deps.now()), retry);
            continue;
          }
          throw err;
        }
        // Ponto de não retorno: crédito commitado → nunca compensar depois.
        log({ transferId, step }, 'crédito concluído');
        continue;
      }
      // COMPENSATING
      log({ transferId, step }, 'compensando');
      await withRetry(() => steps.compensate(deps.db, transferId, deps.now()), retry);
      log({ transferId, step }, 'compensação concluída');
      void now;
      continue;
    } catch (err) {
      if (aborted(deps.signal)) {
        log({ transferId, step: 'ABORTED' }, 'saga abortada durante erro');
        return 'RETRY_LATER';
      }
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const exhausted = err instanceof TransientExhaustedError;
      log({ transferId, step, err: message, exhausted }, 'passo falhou, reagendando');
      try {
        recordRecoverable(deps.db, transferId, deps.now(), message.slice(0, 500));
      } catch (recErr) {
        log({ transferId, step, err: String(recErr) }, 'falha ao gravar recuperação');
      }
      return 'RETRY_LATER';
    }
  }
}
