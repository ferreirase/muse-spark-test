import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Clock } from '../../shared/clock.js';
import { runSaga as defaultRunSaga, type RunSagaDeps } from '../transfers/saga/orchestrator.js';
import { claimJob, findDueJobs, releaseAllLocks, rescheduleJob, type JobRow } from './job-repository.js';
import type { PauseRegistry } from '../test-controls/pause-registry.js';

export type RunSagaFn = (deps: RunSagaDeps, transferId: string) => Promise<'COMPLETED' | 'FAILED' | 'RETRY_LATER'>;

export interface WorkerLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

const nullLogger: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface WorkerDeps {
  db: Database.Database;
  clock: Clock;
  pollIntervalMs?: number;
  concurrency?: number;
  leaseMs?: number;
  runSaga?: RunSagaFn;
  logger?: WorkerLogger;
  retry?: RunSagaDeps['retry'];
  /** Registro de sagas em voo para o reset abortar (test-controls). */
  pauseRegistry?: PauseRegistry;
  /** Hooks da Saga (faults de teste). */
  hooks?: RunSagaDeps['hooks'];
}

const RESCHEDULE_BASE_MS = 200;
const RESCHEDULE_MAX_MS = 5000;

/**
 * Worker durável: polling + wake, claim com lease, concorrência limitada.
 * RETRY_LATER reagenda com backoff (200ms·2^attempts, teto 5s). Erro no loop
 * nunca derruba o processo.
 */
export function createWorker(deps: WorkerDeps) {
  const db = deps.db;
  const clock = deps.clock;
  const pollIntervalMs = deps.pollIntervalMs ?? 200;
  const concurrency = deps.concurrency ?? 4;
  const leaseMs = deps.leaseMs ?? 60000;
  const runSagaFn = deps.runSaga ?? (defaultRunSaga as RunSagaFn);
  const log = deps.logger ?? nullLogger;
  const workerId = `worker-${randomUUID().slice(0, 8)}`;

  const inflight = new Map<string, Promise<void>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let stopping = false;
  let paused = false;

  async function tick(): Promise<void> {
    if (ticking || paused || stopping) return;
    ticking = true;
    try {
      const nowIso = clock().toISOString();
      const candidates = findDueJobs(db, nowIso, concurrency * 2);
      for (const job of candidates) {
        if (stopping || paused) break;
        if (inflight.size >= concurrency) break;
        if (inflight.has(job.transfer_id)) continue;
        if (!claimJob(db, job.id, workerId, nowIso, leaseMs)) continue;

        const p = (async () => {
          const ac = new AbortController();
          deps.pauseRegistry?.register(ac);
          try {
            const outcome = await runSagaFn(
              { db, clock, logger: log as never, retry: deps.retry, signal: ac.signal, hooks: deps.hooks },
              job.transfer_id,
            );
            if (outcome === 'RETRY_LATER') {
              const attempts = job.attempts + 1;
              const delay = Math.min(RESCHEDULE_MAX_MS, RESCHEDULE_BASE_MS * 2 ** Math.min(attempts, 6));
              const runAfter = new Date(clock().getTime() + delay).toISOString();
              rescheduleJob(db, job.id, runAfter, 'reagendado: trabalho recuperável');
              log.warn({ transferId: job.transfer_id, runAfter }, 'worker: reagendado');
            }
          } catch (err) {
            const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            const runAfter = new Date(clock().getTime() + RESCHEDULE_BASE_MS).toISOString();
            rescheduleJob(db, job.id, runAfter, msg);
            log.error({ transferId: job.transfer_id, err: msg }, 'worker: erro na saga');
          } finally {
            deps.pauseRegistry?.unregister(ac);
            inflight.delete(job.transfer_id);
            if (!stopping) wakeInternal();
          }
        })();
        inflight.set(job.transfer_id, p);
      }
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'worker: erro no loop (ignorado)');
    } finally {
      ticking = false;
    }
  }

  function wakeInternal(): void {
    void Promise.resolve().then(() => tick());
  }

  return {
    /** Boot: libera locks antigos, tick imediato, polling periódico. */
    start(): void {
      releaseAllLocks(db);
      wakeInternal();
      timer = setInterval(() => wakeInternal(), pollIntervalMs);
    },
    /** Acorda o loop (usado ao aceitar transferência). */
    wake(): void {
      wakeInternal();
    },
    async stop(): Promise<void> {
      stopping = true;
      if (timer) clearInterval(timer);
      while (inflight.size > 0) {
        await Promise.allSettled([...inflight.values()]);
      }
    },
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
      wakeInternal();
    },
    isIdle(): boolean {
      return inflight.size === 0;
    },
    /** Expõe jobs devidos apenas para fins de diagnóstico/teste. */
    _due(nowIso: string): JobRow[] {
      return findDueJobs(db, nowIso, concurrency);
    },
  };
}

export type Worker = ReturnType<typeof createWorker>;
