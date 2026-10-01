/**
 * Registro de sagas em voo (AbortControllers) e de pausas determinísticas
 * (Map por transferId). abortAll cobre os dois: aborta sinais e libera waits.
 */
export interface PauseRegistry {
  register(controller: AbortController): void;
  unregister(controller: AbortController): void;
  abortAll(): void;
  wait(transferId: string, signal?: AbortSignal): Promise<void>;
  release(transferId: string): void;
}

export function createPauseRegistry(): PauseRegistry {
  const controllers = new Set<AbortController>();
  const waits = new Map<string, { promise: Promise<void>; resolve: () => void }>();

  return {
    register(controller) {
      controllers.add(controller);
    },
    unregister(controller) {
      controllers.delete(controller);
    },
    abortAll() {
      for (const c of controllers) {
        if (!c.signal.aborted) c.abort(new Error('reset de teste'));
      }
      controllers.clear();
      for (const [, w] of waits) w.resolve();
      waits.clear();
    },
    wait(transferId, signal) {
      if (signal?.aborted) return Promise.resolve();
      const existing = waits.get(transferId);
      if (existing) return existing.promise;
      let resolve!: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });
      waits.set(transferId, { promise, resolve });
      signal?.addEventListener('abort', () => {
        if (waits.get(transferId)?.resolve === resolve) {
          waits.delete(transferId);
          resolve();
        }
      }, { once: true });
      return promise;
    },
    release(transferId) {
      const w = waits.get(transferId);
      if (!w) return; // no-op: pausa inexistente/já liberada
      waits.delete(transferId);
      w.resolve();
    },
  };
}
