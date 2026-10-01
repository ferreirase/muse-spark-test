import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/connection.js';
import type { Clock } from '../../shared/clock.js';
import type { SagaOutcome } from '../transfers/saga/orchestrator.js';
import { claimJob, findDueJobs, releaseAllLocks, rescheduleJob, unlockJob } from './job-repository.js';

export interface WorkerOptions {
  db: Db;
  clock: Clock;
  runSaga: (transferId: string) => Promise<SagaOutcome>;
  pollIntervalMs?: number;
  concurrency?: number;
  leaseMs?: number;
  workerId?: string;
  log?: (fields: Record<string, unknown>, msg: string) => void;
  /** Backoff base do reagendamento após RETRY_LATER. */
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface Worker {
  start(): void;
  stop(): Promise<void>;
  wake(): void;
  pause(): void;
  resume(): void;
  isIdle(): boolean;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Backoff por attempts: 200ms·2^a, teto 5s. */
export function retryDelayMs(attempts: number, baseMs = 200, maxMs = 5000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts));
}

/** Worker local: polling + claim com lease + in-flight limitado. */
export function createWorker(opts: WorkerOptions): Worker {
  const pollIntervalMs = opts.pollIntervalMs ?? 200;
  const concurrency = opts.concurrency ?? 4;
  const leaseMs = opts.leaseMs ?? 60000;
  const workerId = opts.workerId ?? `worker-${randomUUID()}`;
  const log = opts.log ?? (() => undefined);
  const retryBaseMs = opts.retryBaseMs ?? 200;
  const retryMaxMs = opts.retryMaxMs ?? 5000;

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let paused = false;
  let ticking = false;
  const inFlight = new Set<string>();
  let wakeRequested = false;

  function isIdle(): boolean {
    return inFlight.size === 0;
  }

  async function tick(): Promise<void> {
    if (ticking || stopped || paused) return;
    ticking = true;
    wakeRequested = false;
    try {
      const nowMs = opts.clock.now().getTime();
      const now = iso(nowMs);
      const due = findDueJobs(opts.db, now, concurrency * 2);
      for (const job of due) {
        if (inFlight.size >= concurrency) break;
        if (inFlight.has(job.transferId)) continue;
        const claimed = claimJob(opts.db, job.id, workerId, now, iso(nowMs + leaseMs));
        if (!claimed) continue;
        inFlight.add(job.transferId);
        void runOne(job.transferId, job.attempts).finally(() => {
          inFlight.delete(job.transferId);
          // Há mais trabalho? agenda tick imediato.
          if (wakeRequested || !stopped) scheduleSoon();
        });
      }
    } catch (err) {
      log({ workerId, err: String(err) }, 'tick do worker falhou');
    } finally {
      ticking = false;
    }
  }

  async function runOne(transferId: string, attempts: number): Promise<void> {
    const startMs = opts.clock.now().getTime();
    try {
      log({ workerId, transferId }, 'saga iniciada pelo worker');
      const outcome = await opts.runSaga(transferId);
      const now = iso(opts.clock.now().getTime());
      if (outcome === 'RETRY_LATER') {
        const delay = retryDelayMs(attempts, retryBaseMs, retryMaxMs);
        rescheduleJob(opts.db, `job-${transferId}`, iso(startMs + delay), 'RETRY_LATER', now);
        log({ workerId, transferId, delayMs: delay }, 'saga reagendada');
      } else {
        unlockJob(opts.db, `job-${transferId}`, now);
        log({ workerId, transferId, outcome }, 'saga terminada');
      }
    } catch (err) {
      try {
        const now = iso(opts.clock.now().getTime());
        const delay = retryDelayMs(attempts, retryBaseMs, retryMaxMs);
        rescheduleJob(opts.db, `job-${transferId}`, iso(startMs + delay), String(err).slice(0, 500), now);
      } catch (recErr) {
        log({ workerId, transferId, err: String(recErr) }, 'falha ao reagendar job');
      }
      log({ workerId, transferId, err: String(err) }, 'runSaga lançou, job reagendado');
    }
  }

  let soonTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSoon(): void {
    if (stopped || paused || soonTimer !== null) return;
    soonTimer = setTimeout(() => {
      soonTimer = null;
      void tick();
    }, 0);
  }

  return {
    start(): void {
      stopped = false;
      const released = releaseAllLocks(opts.db);
      log({ workerId, released }, 'worker iniciado, locks liberados');
      if (timer === null) {
        timer = setInterval(() => {
          void tick();
        }, pollIntervalMs);
      }
      void tick();
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (soonTimer !== null) {
        clearTimeout(soonTimer);
        soonTimer = null;
      }
      // Aguarda in-flight terminarem (com timeout de segurança).
      const deadline = Date.now() + 30000;
      while (inFlight.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      log({ workerId }, 'worker parado');
    },
    wake(): void {
      scheduleSoon();
    },
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
      void tick();
    },
    isIdle,
  };
}
