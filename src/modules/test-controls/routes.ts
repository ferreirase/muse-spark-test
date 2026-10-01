import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import type { Clock } from '../../shared/clock.js';
import type { Config } from '../../config.js';
import { AppError, errors } from '../../shared/errors.js';
import { checkTestControlAccess } from './guard.js';
import { resetAll } from './reset-all.js';
import { armFault } from './faults.js';
import type { PauseRegistry } from './pause-registry.js';
import type { Worker } from '../worker/worker.js';

export interface TestControlsDeps {
  config: Config;
  db: Database.Database;
  clock: Clock;
  getWorker: () => Worker;
  registry: PauseRegistry;
}

const faultBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceAccountId', 'idempotencyKey', 'mode'],
  properties: {
    sourceAccountId: { type: 'string', minLength: 1, maxLength: 128 },
    idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' },
    mode: { type: 'string', enum: ['FAIL_CREDIT_ONCE', 'PAUSE_AFTER_DEBIT'] },
  },
} as const;

const armedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['armed'],
  properties: { armed: { type: 'boolean', enum: [true] } },
} as const;

const releaseBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['transferId'],
  properties: { transferId: { type: 'string', minLength: 1, maxLength: 128 } },
} as const;

/**
 * Controles de avaliação (contrato §8). Registrados SOMENTE quando
 * ENABLE_TEST_CONTROLS=true; o gate valida X-Test-Control-Token por rota.
 */
export const testControlsPlugin: FastifyPluginAsync<TestControlsDeps> = async (scope, deps) => {
  const gate = (provided: string | undefined): void => {
    const access = checkTestControlAccess({
      enabled: deps.config.testControls.enabled,
      expectedToken: deps.config.testControls.token,
      providedToken: provided,
    });
    if (access === 'FORBIDDEN') {
      throw new AppError('FORBIDDEN', 403, 'Acesso negado.');
    }
    if (access === 'NOT_FOUND') {
      // não deveria ocorrer (plugin não é registrado com flag desligada)
      throw errors.notFound();
    }
  };

  scope.addHook('onRequest', async (request) => {
    const raw = request.headers['x-test-control-token'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    gate(provided);
  });

  scope.post('/__test/reset', {}, async (_request, reply) => {
    await resetAll({ db: deps.db, worker: deps.getWorker(), registry: deps.registry });
    return reply.code(204).send();
  });

  scope.post('/__test/faults', {
    schema: {
      body: faultBodySchema,
      response: { 201: armedSchema, 400: { type: 'object', additionalProperties: true } },
    },
  }, async (request, reply) => {
    const body = request.body as { sourceAccountId: string; idempotencyKey: string; mode: string };
    const r = armFault(deps.db, body, deps.clock());
    return reply.code(201).send(r);
  });

  scope.post('/__test/release', {
    schema: { body: releaseBodySchema },
  }, async (request, reply) => {
    const { transferId } = request.body as { transferId: string };
    deps.registry.release(transferId);
    return reply.code(204).send();
  });
};

export function registerTestControlsRoutes(app: FastifyInstance, deps: TestControlsDeps): void {
  void app.register(testControlsPlugin, deps);
}
