import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Config } from '../../config.js';
import type { Clock } from '../../shared/clock.js';
import { responseSchemas, signinBodySchema, signupBodySchema } from '../../shared/schemas.js';
import { setSessionCookie, clearSessionCookie, SESSION_COOKIE } from './cookie.js';
import { signup } from './commands/signup.js';
import { signin } from './commands/signin.js';
import { signout } from './commands/signout.js';

export interface AuthRoutesDeps {
  config: Config;
  db: Database.Database;
  clock: Clock;
}

/** Rotas /v1/auth — transporte fino; regras nos command handlers. */
export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): Promise<void> {
  // POST pode chegar com Content-Type json e corpo vazio (proxy do frontend):
  // corpo vazio vira {}; JSON inválido continua 400 VALIDATION_ERROR.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post('/v1/auth/signup', {
    schema: {
      body: signupBodySchema,
      response: { 201: responseSchemas.authResult, 409: responseSchemas.apiError, 400: responseSchemas.apiError },
    },
  }, async (request, reply) => {
    const { authResult, session } = await signup({ db: deps.db, now: deps.clock() }, request.body as never);
    request.log.info({ userId: authResult.user.id }, 'signup concluído');
    setSessionCookie(reply, session.token, session.expiresAt, deps.config.cookieSecure);
    return reply.code(201).send(authResult);
  });

  app.post('/v1/auth/signin', {
    schema: {
      body: signinBodySchema,
      response: { 200: responseSchemas.authResult, 401: responseSchemas.apiError, 400: responseSchemas.apiError },
    },
  }, async (request, reply) => {
    const { authResult, session } = await signin({ db: deps.db, now: deps.clock() }, request.body as never);
    request.log.info({ userId: authResult.user.id }, 'signin concluído');
    setSessionCookie(reply, session.token, session.expiresAt, deps.config.cookieSecure);
    return reply.code(200).send(authResult);
  });

  app.post('/v1/auth/signout', {
    schema: { response: { 204: { type: 'null' } } },
  }, async (request, reply) => {
    signout({ db: deps.db, now: deps.clock() }, request.cookies[SESSION_COOKIE]);
    clearSessionCookie(reply, deps.config.cookieSecure);
    return reply.code(204).send();
  });
}
