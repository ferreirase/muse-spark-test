import type { Sleep } from "../../../shared/clock.js";
import { realSleep } from "../../../shared/clock.js";
import { isBusyError } from "../../../shared/sqlite-errors.js";

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  sleep?: Sleep;
  jitter?: () => number;
  isRetryable?: (error: unknown) => boolean;
}

export class RetryExhaustedError extends Error {
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super("retry attempts exhausted");
    this.name = "RetryExhaustedError";
    this.cause = cause;
  }
}

export async function retryAsync<T>(
  fn: () => T | Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  const jitter = options.jitter ?? Math.random;
  const isRetryable = options.isRetryable ?? isBusyError;
  const attempts = Math.max(1, options.attempts);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts - 1;
      if (isLast || !isRetryable(error)) {
        throw error;
      }
      const backoff = options.baseDelayMs * 2 ** attempt;
      const delay = Math.round(backoff + jitter() * options.baseDelayMs);
      await sleep(delay);
    }
  }
  throw new RetryExhaustedError(lastError);
}
