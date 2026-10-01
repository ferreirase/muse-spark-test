import type { FastifyInstance, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import { errors } from '../../shared/errors.js';
import type { Clock } from '../../shared/clock.js';
import { authenticate, type AuthContext } from '../../modules/auth/session-repository.js';
import { SESSION_COOKIE } from '../../modules/auth/cookie.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<void>;
  }
}

export interface AuthPluginDeps {
  db: Database.Database;
  clock: Clock;
}

/**
 * preHandler de rotas privadas: popula request.auth ou responde 401
 * UNAUTHENTICATED (contrato §4).
 */
export function registerAuthPlugin(app: FastifyInstance, deps: AuthPluginDeps): void {
  app.decorateRequest('auth', null as unknown as AuthContext);
  app.decorate('requireAuth', async function requireAuth(request: FastifyRequest) {
    const token = request.cookies[SESSION_COOKIE];
    const auth = authenticate(deps.db, token, deps.clock());
    if (!auth) throw errors.unauthenticated();
    request.auth = auth;
  });
}
