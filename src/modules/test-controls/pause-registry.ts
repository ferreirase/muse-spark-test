/**
 * Registro de AbortControllers das sagas em execução/pausadas. O reset de
 * teste aborta todas para que nenhuma saga escreva depois do reset.
 */
export interface PauseRegistry {
  register(controller: AbortController): void;
  unregister(controller: AbortController): void;
  abortAll(): void;
}

export function createPauseRegistry(): PauseRegistry {
  const controllers = new Set<AbortController>();
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
    },
  };
}
