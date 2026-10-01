import type { Db } from '../../db/connection.js';
import { resetDatabase, totalBalances } from '../../db/seed.js';

export interface ResetWorker {
  pause(): void;
  resume(): void;
  isIdle(): boolean;
}

export interface ResetDeps {
  db: Db;
  worker: ResetWorker | undefined;
  /** Aborta sagas pausadas (PAUSE_AFTER_DEBIT) antes do reset. */
  abortPaused?: () => void;
  waitMs?: number;
}

/**
 * Reset com worker pausado: aborta pausas, aguarda ociosidade, reseta, retoma.
 * Sempre resume em finally.
 */
export async function resetAll(deps: ResetDeps): Promise<{ totalCents: number }> {
  deps.worker?.pause();
  try {
    deps.abortPaused?.();
    const deadline = Date.now() + (deps.waitMs ?? 10000);
    for (;;) {
      if (deps.worker === undefined || deps.worker.isIdle()) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await resetDatabase(deps.db);
    return { totalCents: totalBalances(deps.db) };
  } finally {
    deps.worker?.resume();
  }
}
