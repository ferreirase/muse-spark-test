import type Database from 'better-sqlite3';
import { resetDatabase } from '../../db/seed.js';
import type { Worker } from '../worker/worker.js';
import type { PauseRegistry } from './pause-registry.js';

export interface ResetAllDeps {
  db: Database.Database;
  worker: Worker;
  registry: PauseRegistry;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reset do contrato §8: pausa o worker, aborta sagas pausadas/em voo,
 * aguarda idle (com teto), restaura o seed e retoma o worker.
 */
export async function resetAll(deps: ResetAllDeps): Promise<void> {
  const { db, worker, registry } = deps;
  const timeoutMs = deps.timeoutMs ?? 5000;
  const sleep = deps.sleep ?? defaultSleep;

  worker.pause();
  try {
    registry.abortAll();
    const start = Date.now();
    while (!worker.isIdle()) {
      if (Date.now() - start > timeoutMs) break;
      await sleep(10);
    }
    await resetDatabase(db);
  } finally {
    worker.resume();
  }
}
