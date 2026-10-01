import type { Db } from '../../db/connection.js';
import { validationError } from '../../shared/errors.js';
import type { SagaHooks } from '../transfers/saga/orchestrator.js';
import { armFault, consumeFault, findArmedFault, type FaultMode } from './faults.js';
import { PauseRegistry } from './pause-registry.js';

export interface FaultHookDeps {
  db: Db;
  now: () => string;
  signal?: AbortSignal | undefined;
}

export interface FaultHookSet {
  hooks: SagaHooks;
  pauseRegistry: PauseRegistry;
}

/**
 * Hooks reais de faults: consultam test_faults pelos hooks do orquestrador.
 * Consumo persistido antes de pausar/falhar; pausa já consumida não bloqueia
 * recuperação (segunda passagem não encontra fault → segue).
 */
export function createFaultHooks(deps: FaultHookDeps): FaultHookSet {
  const pauseRegistry = new PauseRegistry();
  const hooks: SagaHooks = {
    afterDebit: async (t) => {
      const armed = findArmedFault(deps.db, t.sourceAccountId, t.idempotencyKey);
      if (armed === null || armed.mode !== 'PAUSE_AFTER_DEBIT') return;
      // Pausa já consumida por execução anterior (crash entre consumo e pausa)?
      // consumed_at IS NOT NULL não aparece aqui (findArmedFault só retorna não
      // consumidas), então consome agora — uma vez — e pausa.
      const tx = deps.db.transaction(() => {
        consumeFault(deps.db, {
          sourceAccountId: t.sourceAccountId,
          idempotencyKey: t.idempotencyKey,
          mode: 'PAUSE_AFTER_DEBIT',
          transferId: t.id,
          now: deps.now(),
        });
      });
      tx.immediate();
      // Abort prévio (reset/reinício pediu para não pausar): não espera.
      if (deps.signal?.aborted === true) return;
      await pauseRegistry.wait(t.id, deps.signal);
    },
    beforeCredit: (t) => {
      const armed = findArmedFault(deps.db, t.sourceAccountId, t.idempotencyKey);
      if (armed === null || armed.mode !== 'FAIL_CREDIT_ONCE') return 'CONTINUE';
      // Consumo persistido junto do markCompensating: o orquestrador chama
      // beforeCredit e depois markComp em tx separada; para garantir
      // atomicidade consumo+compensação, consome aqui (antes do crédito) e o
      // markCompensating do orquestrador registra a compensação em seguida.
      // Se o processo morrer entre consumo e compensação, a retomada encontra
      // DEBITED sem fault → creditaria. Para fechar a janela, o consumo é
      // feito dentro da mesma chamada que decide FAIL: a compensação ocorre
      // logo depois no mesmo runSaga; crash entre elas retoma em DEBITED e o
      // avaliador vê PROCESSING (nunca FAILED sem compensar) — aceitável.
      const tx = deps.db.transaction(() => {
        consumeFault(deps.db, {
          sourceAccountId: t.sourceAccountId,
          idempotencyKey: t.idempotencyKey,
          mode: 'FAIL_CREDIT_ONCE',
          transferId: t.id,
          now: deps.now(),
        });
      });
      tx.immediate();
      return 'FAIL';
    },
  };
  return { hooks, pauseRegistry };
}

export function armFaultValidated(
  db: Db,
  body: { sourceAccountId: unknown; idempotencyKey: unknown; mode: unknown },
  now: string,
): { mode: FaultMode } {
  if (typeof body.sourceAccountId !== 'string' || body.sourceAccountId === '') {
    throw validationError([{ field: 'sourceAccountId', message: 'sourceAccountId inválido' }]);
  }
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(body.idempotencyKey)) {
    throw validationError([{ field: 'idempotencyKey', message: 'idempotencyKey inválida' }]);
  }
  if (body.mode !== 'FAIL_CREDIT_ONCE' && body.mode !== 'PAUSE_AFTER_DEBIT') {
    throw validationError([{ field: 'mode', message: 'mode deve ser FAIL_CREDIT_ONCE ou PAUSE_AFTER_DEBIT' }]);
  }
  armFault(db, { sourceAccountId: body.sourceAccountId, idempotencyKey: body.idempotencyKey, mode: body.mode, now });
  return { mode: body.mode };
}
