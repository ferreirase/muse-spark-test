/**
 * PauseRegistry: pausas determinísticas do worker (sem sleep).
 * wait() bloqueia a saga até release() ou abortAll()/abort por signal.
 */
export class PauseRegistry {
  private readonly pauses = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();

  wait(transferId: string, signal?: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(new Error('pausa abortada'));
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        this.pauses.delete(transferId);
        reject(new Error('pausa abortada'));
      };
      if (signal !== undefined) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.pauses.set(transferId, {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          this.pauses.delete(transferId);
          resolve();
        },
        reject: (err) => {
          signal?.removeEventListener('abort', onAbort);
          this.pauses.delete(transferId);
          reject(err);
        },
      });
    });
  }

  /** Libera a pausa; no-op se não houver pausa para o id. */
  release(transferId: string): boolean {
    const p = this.pauses.get(transferId);
    if (p === undefined) return false;
    p.resolve();
    return true;
  }

  abortAll(reason = 'pausas abortadas'): void {
    for (const [, p] of [...this.pauses]) p.reject(new Error(reason));
    this.pauses.clear();
  }

  get size(): number {
    return this.pauses.size;
  }
}
