import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { AppError } from '../../shared/errors.js';
import './globals.js';
import { armFaultValidated } from './fault-hooks.js';
import { checkTestControlAccess } from './guard.js';
import { resetAll } from './reset.js';

export const TEST_CONTROL_HEADER = 'x-test-control-token';

const faultsBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceAccountId', 'idempotencyKey', 'mode'],
  properties: {
    sourceAccountId: { type: 'string', minLength: 1 },
    idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' },
    mode: { type: 'string', enum: ['FAIL_CREDIT_ONCE', 'PAUSE_AFTER_DEBIT'] },
  },
} as const;

const faultsArmedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['armed'],
  properties: { armed: { type: 'boolean', const: true } },
} as const;

const releaseBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transferId'],
  properties: { transferId: { type: 'string', minLength: 1 } },
} as const;

/**
 * Rotas /__test — registradas SOMENTE com ENABLE_TEST_CONTROLS=true.
 * Flag desligada → plugin nem registra → 404 natural do notFound handler.
 */
export function registerTestControlRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/__test/')) return;
    const verdict = checkTestControlAccess({
      enabled: deps.config.testControls.enabled,
      expectedToken: deps.config.testControls.token,
      providedToken: req.headers[TEST_CONTROL_HEADER] as string | undefined,
    });
    if (verdict === 'NOT_FOUND') {
      throw new AppError('NOT_FOUND', 404, 'Rota não encontrada');
    }
    if (verdict === 'FORBIDDEN') {
      throw new AppError('TEST_CONTROLS_FORBIDDEN', 403, 'Token de controle inválido');
    }
  });

  void app.post('/__test/reset', async (_req, reply) => {
    await resetAll({
      db: deps.db,
      worker: deps.worker,
      abortPaused: () => {
        globalThis.__testPauseRegistry?.abortAll('reset');
        globalThis.__testAbortSignal?.abort?.();
        globalThis.__testAbortReplace?.();
      },
    });
    return reply.status(204).send();
  });

  void app.post(
    '/__test/faults',
    { schema: { body: faultsBodySchema, response: { 201: faultsArmedSchema } } },
    async (req, reply) => {
      armFaultValidated(deps.db, (req.body ?? {}) as { sourceAccountId: unknown; idempotencyKey: unknown; mode: unknown }, new Date().toISOString());
      return reply.status(201).send({ armed: true });
    },
  );

  void app.post(
    '/__test/release',
    { schema: { body: releaseBodySchema } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { transferId: string };
      globalThis.__testPauseRegistry?.release(body.transferId);
      return reply.status(204).send();
    },
  );
}
