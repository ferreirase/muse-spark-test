const TRANSIENT_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED']);

/** Erro de infra transitório do SQLite (retry com backoff). */
export function isTransientSqliteError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && TRANSIENT_CODES.has(String((err as { code?: unknown }).code))
  );
}

/** Lançado quando esgotam as tentativas de um passo com erro transitório. */
export class TransientExhaustedError extends Error {
  override name = 'TransientExhaustedError';
  readonly causeErr: unknown;
  constructor(message: string, causeErr: unknown) {
    super(message);
    this.causeErr = causeErr;
  }
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Chamado a cada backoff (testes/observabilidade). */
  onDelay?: (ms: number) => void;
}

/**
 * Repete fn só para erros transitórios, com backoff exponencial 25ms·2ⁿ + jitter.
 * Outros erros propagam na primeira ocorrência. Esgotado → TransientExhaustedError.
 */
export async function withRetry<T>(fn: () => T | Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 25;
  const maxMs = opts.maxMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  let last: unknown = null;
  for (let n = 0; n < attempts; n++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientSqliteError(err)) throw err;
      last = err;
      if (n < attempts - 1) {
        const delay = Math.min(maxMs, baseMs * 2 ** n + Math.floor(random() * baseMs));
        opts.onDelay?.(delay);
        await sleep(delay);
      }
    }
  }
  throw new TransientExhaustedError(`transitório persistiu após ${attempts} tentativas`, last);
}
