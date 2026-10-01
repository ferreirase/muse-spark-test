import type Database from 'better-sqlite3';
import type { Clock } from '../../../shared/clock.js';
import { creditStep, compensateStep, debitStep, markCompensating } from './steps.js';
import { withRetry, TransientExhaustedError, type RetryOptions } from './retry.js';

export type SagaOutcome = 'COMPLETED' | 'FAILED' | 'RETRY_LATER';

export interface TransferSnapshot {
  id: string;
  sagaStep: string;
  status: string;
  sourceAccountId: string;
  recipientAccountId: string;
  amountCents: number;
}

/** Pontos de extensão para os controles de teste (no-op em produção). */
export interface SagaHooks {
  afterDebit?: (transfer: TransferSnapshot) => Promise<void>;
  beforeCredit?: (transfer: TransferSnapshot) => Promise<'FAIL' | 'CONTINUE'>;
}

export interface SagaLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

const nullLogger: SagaLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface RunSagaDeps {
  db: Database.Database;
  clock: Clock;
  hooks?: SagaHooks;
  signal?: AbortSignal;
  logger?: SagaLogger;
  retry?: Partial<RetryOptions>;
}

function readSnapshot(db: Database.Database, transferId: string): TransferSnapshot | null {
  const row = db
    .prepare('SELECT id, saga_step, status, source_account_id, recipient_account_id, amount_cents FROM transfers WHERE id=?')
    .get(transferId) as
    | {
        id: string; saga_step: string; status: string;
        source_account_id: string; recipient_account_id: string; amount_cents: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    sagaStep: row.saga_step,
    status: row.status,
    sourceAccountId: row.source_account_id,
    recipientAccountId: row.recipient_account_id,
    amountCents: row.amount_cents,
  };
}

function ensureJobDone(db: Database.Database, transferId: string, nowIso: string): void {
  db.prepare("UPDATE jobs SET status='DONE', updated_at=? WHERE transfer_id=? AND status='PENDING'").run(nowIso, transferId);
}

function recordFailure(db: Database.Database, transferId: string, err: unknown, nowIso: string): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  db.prepare('UPDATE transfers SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id=?').run(message, nowIso, transferId);
  db.prepare('UPDATE jobs SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE transfer_id=?').run(message, nowIso, transferId);
}

const errText = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

/**
 * Orquestrador da Saga (PRD §5): lê o estado persistido a cada iteração e
 * executa/retoma passos até terminal ou esgotamento de retries transitórios.
 * Nunca declara FAILED sem compensar; após o commit do crédito nunca compensa.
 */
export async function runSaga(deps: RunSagaDeps, transferId: string): Promise<SagaOutcome> {
  const { db, clock, hooks = {}, signal } = deps;
  const log = deps.logger ?? nullLogger;
  const retryOpts: RetryOptions = { attempts: 5, baseMs: 25, maxMs: 1000, ...deps.retry };

  try {
    for (;;) {
      const t = readSnapshot(db, transferId);
      if (!t) throw new Error(`transferência ${transferId} não encontrada`);
      log.info({ transferId, step: t.sagaStep }, 'saga: passo');

      switch (t.sagaStep) {
        case 'CREATED': {
          const result = await withRetry(() => debitStep(db, transferId, clock()), retryOpts);
          if (result === 'INSUFFICIENT_FUNDS') {
            log.info({ transferId, step: 'FAILED' }, 'saga: fundos insuficientes');
            ensureJobDone(db, transferId, clock().toISOString());
            return 'FAILED';
          }
          continue;
        }
        case 'DEBITED': {
          if (hooks.afterDebit) await hooks.afterDebit(t);
          if (signal?.aborted) return 'RETRY_LATER';
          const decision = (await hooks.beforeCredit?.(t)) ?? 'CONTINUE';
          if (decision === 'FAIL') {
            await withRetry(() => markCompensating(db, transferId, 'fault FAIL_CREDIT_ONCE', clock()), retryOpts);
            continue;
          }
          try {
            await withRetry(() => creditStep(db, transferId, clock()), retryOpts);
          } catch (err) {
            // falha definitiva de crédito (antes do commit) → compensar
            if (err instanceof Error && err.name === 'CreditFailedError') {
              await withRetry(() => markCompensating(db, transferId, errText(err), clock()), retryOpts);
              continue;
            }
            throw err;
          }
          continue;
        }
        case 'COMPENSATING': {
          await withRetry(() => compensateStep(db, transferId, clock()), retryOpts);
          continue;
        }
        case 'COMPLETED': {
          ensureJobDone(db, transferId, clock().toISOString());
          return 'COMPLETED';
        }
        case 'FAILED': {
          ensureJobDone(db, transferId, clock().toISOString());
          return 'FAILED';
        }
        default:
          throw new Error(`estado desconhecido ${String(t.sagaStep)}`);
      }
    }
  } catch (err) {
    if (err instanceof TransientExhaustedError) {
      log.warn({ transferId, err: errText(err.cause) }, 'saga: transitórias esgotadas, reagendar');
    } else {
      log.error({ transferId, err: errText(err) }, 'saga: erro inesperado, reagendar');
    }
    recordFailure(db, transferId, err, clock().toISOString());
    return 'RETRY_LATER';
  }
}
