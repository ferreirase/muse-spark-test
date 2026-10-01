const TRANSIENT_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED']);

/** SQLITE_BUSY/LOCKED são transitórios (PRD §5 regra 6); o resto não. */
export function isTransientSqliteError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    TRANSIENT_CODES.has((err as { code: string }).code)
  );
}

export class TransientExhaustedError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('tentativas transitórias esgotadas');
    this.name = 'TransientExhaustedError';
    this.cause = cause;
  }
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  isTransient?: (err: unknown) => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry limitado por tentativa com backoff exponencial (base·2ⁿ) + jitter,
 * limitado a maxMs. Só repete erros transitórios; outros propagam na hora.
 * Esgotado → TransientExhaustedError (com causa).
 */
export async function withRetry<T>(fn: () => T, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 25;
  const maxMs = opts.maxMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const isTransient = opts.isTransient ?? isTransientSqliteError;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const exp = Math.min(maxMs, baseMs * 2 ** (i - 1));
      const delay = Math.min(maxMs, exp * (0.5 + random() * 0.5));
      await sleep(delay);
    }
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastError = err;
    }
  }
  throw new TransientExhaustedError(lastError);
}
