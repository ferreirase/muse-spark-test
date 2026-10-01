// Tipos dos pontos de extensão /__test no server (MT-28/MT-29).
import type { PauseRegistry } from './pause-registry.js';

declare global {
  // eslint-disable-next-line no-var
  var __testSagaHooks:
    | { afterDebit?: (t: { id: string; sourceAccountId: string; idempotencyKey: string }) => Promise<void>; beforeCredit?: (t: { id: string; sourceAccountId: string; idempotencyKey: string }) => 'FAIL' | 'CONTINUE' }
    | undefined;
  // eslint-disable-next-line no-var
  var __testAbortSignal: AbortController | undefined;
  // eslint-disable-next-line no-var
  var __testAbortReplace: (() => void) | undefined;
  // eslint-disable-next-line no-var
  var __testPauseRegistry: PauseRegistry | undefined;
}

export {};
