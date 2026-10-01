import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import { AppError, errors } from '../../shared/errors.js';
import { checkTestControlAccess } from './guard.js';
import { resetAll } from './reset-all.js';
import type { PauseRegistry } from './pause-registry.js';
import type { Worker } from '../worker/worker.js';

export interface TestControlsDeps {
  config: Config;
  db: Database.Database;
  getWorker: () => Worker;
  registry: PauseRegistry;
}

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

  scope.post('/__test/reset', {
    config: {
      // body vazio tolerante: sem content-type parser aqui, rota não lê body
    },
  }, async (_request, reply) => {
    await resetAll({ db: deps.db, worker: deps.getWorker(), registry: deps.registry });
    return reply.code(204).send();
  });
};

export function registerTestControlsRoutes(app: FastifyInstance, deps: TestControlsDeps): void {
  void app.register(testControlsPlugin, deps);
}
