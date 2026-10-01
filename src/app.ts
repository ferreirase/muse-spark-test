import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import { AppError, errors, toApiErrorResponse } from './shared/errors.js';
import { ajvOptions, healthSchema, responseSchemas } from './shared/schemas.js';
import type { Clock } from './shared/clock.js';
import { registerOriginPlugin } from './http/plugins/origin.js';
import { registerNoStorePlugin } from './http/plugins/no-store.js';
import { registerAuthPlugin } from './http/plugins/auth.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerAccountsRoutes } from './modules/accounts/routes.js';
import { registerContactsRoutes } from './modules/contacts/routes.js';

export interface AppDeps {
  config: Config;
  db: Database.Database;
  clock: Clock;
}

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-test-control-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
];

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;

  const app = Fastify({
    genReqId: () => randomUUID(),
    requestIdHeader: false, // não confiar em header do cliente
    logger: {
      level: config.logLevel,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    ajv: { customOptions: { ...ajvOptions } },
  });

  // requestId em toda resposta (inclusive erros)
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerOriginPlugin(app, config.frontendOrigin);
  registerNoStorePlugin(app);

  registerAuthPlugin(app, { db: deps.db, clock: deps.clock });

  await app.register(cookie);
  await registerAuthRoutes(app, { config, db: deps.db, clock: deps.clock });
  registerAccountsRoutes(app, { db: deps.db });
  registerContactsRoutes(app, { db: deps.db });

  app.setErrorHandler((err, request, reply) => {
    const { statusCode, body } = toApiErrorResponse(err, request.id);
    if (statusCode >= 500) {
      request.log.error({ err, requestId: request.id }, 'erro interno');
    } else {
      request.log.warn({ requestId: request.id, code: body.error.code, statusCode }, 'erro de aplicação');
    }
    reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const { statusCode, body } = toApiErrorResponse(errors.notFound(), request.id);
    request.log.warn({ requestId: request.id, url: request.url }, 'rota inexistente');
    reply.code(statusCode).send(body);
  });

  app.get(
    '/health',
    { schema: { response: { 200: healthSchema, 503: responseSchemas.apiError } } },
    async (request, reply) => {
      try {
        deps.db.prepare('SELECT 1').get();
      } catch {
        const { body } = toApiErrorResponse(
          new AppError('SERVICE_UNAVAILABLE', 503, 'Serviço indisponível.'),
          request.id,
        );
        return reply.code(503).send(body);
      }
      return { status: 'ok' };
    },
  );

  // Módulos de domínio são registrados pelas tasks seguintes via
  // registerXRoutes(app, deps); nenhum módulo ainda nesta task.

  return app;
}
