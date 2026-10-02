import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../db/connection.js";
import type { Clock, Sleep } from "../../shared/clock.js";
import { realSleep } from "../../shared/clock.js";
import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  createPauseControl,
  runSaga,
  type PauseControl,
  type SagaDeps,
} from "../transfers/saga/orchestrator.js";
import { claimNextJob, completeJob, recoverStaleLocks, rescheduleJob } from "./job-repository.js";

export interface WorkerOptions {
  db: SqliteDb;
  clock: Clock;
  pollIntervalMs: number;
  workerId?: string;
  leaseMs?: number;
  sleep?: Sleep;
  maxAttempts?: number;
  baseDelayMs?: number;
  pauseControl?: PauseControl;
  onError?: (error: unknown, transferId: string) => void;
}

export class TransferWorker {
  private readonly db: SqliteDb;
  private readonly clock: Clock;
  private readonly pollIntervalMs: number;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly sleep: Sleep;
  private readonly pauseControl: PauseControl;
  private readonly onError: (error: unknown, transferId: string) => void;
  private readonly sagaDeps: SagaDeps;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(options: WorkerOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.pollIntervalMs = options.pollIntervalMs;
    this.workerId = options.workerId ?? randomUUID();
    this.leaseMs = options.leaseMs ?? 30_000;
    this.sleep = options.sleep ?? realSleep;
    this.pauseControl = options.pauseControl ?? createPauseControl();
    this.onError = options.onError ?? (() => {});
    this.sagaDeps = {
      db: this.db,
      clock: this.clock,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      pauseControl: this.pauseControl,
    };
  }

  recoverOnBoot(): number {
    return recoverStaleLocks(this.db, this.clock.now().toISOString());
  }

  isPaused(transferId: string): boolean {
    return this.pauseControl.isPaused(transferId);
  }

  release(transferId: string): void {
    this.pauseControl.release(transferId);
    const nowIso = this.clock.now().toISOString();
    this.db
      .prepare(
        `UPDATE jobs
            SET status = 'PENDING', locked_by = NULL, locked_until = NULL, run_after = ?, updated_at = ?
          WHERE transfer_id = ? AND status = 'PENDING'`,
      )
      .run(nowIso, nowIso, transferId);
  }

  async tick(): Promise<boolean> {
    const nowIso = this.clock.now().toISOString();
    const job = claimNextJob(this.db, {
      workerId: this.workerId,
      nowIso,
      leaseMs: this.leaseMs,
    });
    if (!job) return false;

    try {
      const outcome = await runSaga(this.sagaDeps, job.transfer_id);
      if (outcome === "PAUSED") {
        return true;
      }
      completeJob(this.db, job.transfer_id, this.clock.now().toISOString());
      return true;
    } catch (error) {
      this.onError(error, job.transfer_id);
      const runAfter = new Date(
        this.clock.now().getTime() + this.pollIntervalMs,
      ).toISOString();
      rescheduleJob(this.db, job.transfer_id, {
        runAfter,
        lastError: error instanceof Error ? error.message : String(error),
        nowIso: this.clock.now().toISOString(),
      });
      return true;
    }
  }

  async processAvailable(): Promise<number> {
    let processed = 0;
    while (await this.tick()) {
      processed += 1;
    }
    return processed;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const processed = await this.processAvailable();
      if (processed === 0 && this.running) {
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }
}
