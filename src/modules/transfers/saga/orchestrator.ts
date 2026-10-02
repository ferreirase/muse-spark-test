import type { SqliteDb } from "../../../db/connection.js";
import type { Clock, Sleep } from "../../../shared/clock.js";
import { findTransferById } from "../repositories.js";
import { consumeFault } from "../../test-controls/faults.js";
import { CreditFailedError, TransferNotFoundError } from "./errors.js";
import { retryAsync } from "./retry.js";
import {
  stepCompensate,
  stepCredit,
  stepDebit,
  stepMarkCompensating,
  stepMarkInsufficientFunds,
  type SagaStepDeps,
} from "./steps.js";

export type SagaOutcome =
  | "COMPLETED"
  | "FAILED"
  | "PAUSED"
  | "PROCESSING";

export interface PauseControl {
  pause(transferId: string): void;
  isPaused(transferId: string): boolean;
  release(transferId: string): void;
}

export interface SagaDeps {
  db: SqliteDb;
  clock: Clock;
  sleep?: Sleep;
  maxAttempts?: number;
  baseDelayMs?: number;
  pauseControl?: PauseControl;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_BASE_DELAY_MS = 25;

export function createPauseControl(): PauseControl {
  const paused = new Set<string>();
  return {
    pause: (id) => paused.add(id),
    isPaused: (id) => paused.has(id),
    release: (id) => paused.delete(id),
  };
}

function stepDeps(deps: SagaDeps): SagaStepDeps {
  return { db: deps.db, clock: deps.clock };
}

function retry<T>(
  deps: SagaDeps,
  fn: () => T,
): Promise<T> {
  return retryAsync(fn, {
    attempts: deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    baseDelayMs: deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
}

export async function runSaga(
  deps: SagaDeps,
  transferId: string,
): Promise<SagaOutcome> {
  const transfer = findTransferById(deps.db, transferId);
  if (!transfer) throw new TransferNotFoundError(transferId);

  if (transfer.status === "COMPLETED") return "COMPLETED";
  if (transfer.status === "FAILED") return "FAILED";

  if (deps.pauseControl?.isPaused(transferId)) {
    return "PAUSED";
  }

  if (transfer.saga_step === "COMPENSATING") {
    await retry(deps, () => stepCompensate(stepDeps(deps), transferId));
    return "FAILED";
  }

  if (transfer.saga_step === "CREATED") {
    const outcome = await retry(deps, () => stepDebit(stepDeps(deps), transferId));
    if (outcome === "INSUFFICIENT_FUNDS") {
      await retry(deps, () =>
        stepMarkInsufficientFunds(stepDeps(deps), transferId),
      );
      return "FAILED";
    }
  }

  const afterDebit = findTransferById(deps.db, transferId);
  if (!afterDebit) throw new TransferNotFoundError(transferId);
  if (afterDebit.saga_step === "COMPLETED") return "COMPLETED";
  if (afterDebit.saga_step === "FAILED") return "FAILED";
  if (afterDebit.saga_step === "COMPENSATING") {
    await retry(deps, () => stepCompensate(stepDeps(deps), transferId));
    return "FAILED";
  }

  const mode = consumeFault(
    { db: deps.db, clock: deps.clock },
    afterDebit.source_account_id,
    afterDebit.idempotency_key,
    transferId,
  );

  if (mode === "FAIL_CREDIT_ONCE") {
    await retry(deps, () => stepMarkCompensating(stepDeps(deps), transferId));
    await retry(deps, () => stepCompensate(stepDeps(deps), transferId));
    return "FAILED";
  }

  if (mode === "PAUSE_AFTER_DEBIT") {
    deps.pauseControl?.pause(transferId);
    return "PAUSED";
  }

  try {
    await retry(deps, () => stepCredit(stepDeps(deps), transferId));
    return "COMPLETED";
  } catch (error) {
    if (error instanceof CreditFailedError) {
      await retry(deps, () => stepMarkCompensating(stepDeps(deps), transferId));
      await retry(deps, () => stepCompensate(stepDeps(deps), transferId));
      return "FAILED";
    }
    throw error;
  }
}
