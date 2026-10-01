import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Db } from './db/connection.js';
import { AJV_OPTIONS } from './shared/schemas.js';
import type { Clock } from './shared/clock.js';
import { LOGGER_REDACT_PATHS, errorHandlerPlugin, requestIdPlugin } from './http/plugins/errors.js';
import { checkOrigin } from './http/plugins/origin.js';
import { noStorePlugin } from './http/plugins/no-store.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerMeRoutes } from './modules/auth/me-routes.js';
import { registerAccountRoutes } from './modules/accounts/routes.js';
import { registerContactRoutes } from './modules/contacts/routes.js';
import { registerTransferRoutes } from './modules/transfers/routes.js';
import { registerTestControlRoutes } from './modules/test-controls/routes.js';

export interface AppDeps {
  config: Config;
  db: Db;
  clock: Clock;
  // Registradores de módulos — plugados pelas tasks de rotas (MT-20+).
  routeRegistrars?: Array<(app: FastifyInstance, deps: AppDeps) => void>;
  // Worker — plugado em MT-27 (wake opcional até lá).
  worker?: import('./modules/worker/worker.js').Worker | undefined;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: [...LOGGER_REDACT_PATHS],
    },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    requestIdLogLabel: 'requestId',
    ajv: {
      customOptions: { ...AJV_OPTIONS },
    },
  });

  requestIdPlugin(app);
  errorHandlerPlugin(app);

  void app.register(cookie);

  // Origin: mutações com Origin estranha → 403.
  void app.addHook('onRequest', async (req) => {
    checkOrigin({
      method: req.method,
      origin: req.headers.origin,
      allowedOrigin: config.frontendOrigin,
    });
  });

  noStorePlugin(app);

  void app.get('/health', async (req, reply) => {
    let sqliteOk = false;
    try {
      const row = deps.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      sqliteOk = row?.ok === 1;
    } catch (err) {
      req.log.error({ err }, 'healthcheck sqlite falhou');
    }
    if (!sqliteOk) {
      const requestId = req.id ?? 'unknown';
      return reply.status(503).send({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Banco de dados indisponível' },
        requestId,
      });
    }
    return { status: 'ok' };
  });

  // Rotas de módulos (auth registrado agora; demais módulos nas próximas tasks).
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerAccountRoutes(app, deps);
  registerContactRoutes(app, deps);
  registerTransferRoutes(app, deps);
  // Controles /__test: só com flag ligada (desligada → 404 natural).
  if (deps.config.testControls.enabled) {
    registerTestControlRoutes(app, deps);
  }
  for (const register of deps.routeRegistrars ?? []) {
    register(app, deps);
  }

  return app;
}
