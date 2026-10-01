import type { FastifyInstance, FastifyRequest } from 'fastify';
import { unauthenticated } from '../../shared/errors.js';
import type { Db } from '../../db/connection.js';
import type { Clock } from '../../shared/clock.js';
import { SESSION_COOKIE_NAME, resolveSession, type SessionAuth } from '../../modules/auth/session-repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: SessionAuth;
  }
}

export interface AuthPluginDeps {
  db: Db;
  clock: Clock;
}

/**
 * preHandler requireAuth: popula request.auth ou 401 UNAUTHENTICATED.
 * Uso: app.addHook('preHandler', requireAuthHook(deps)) dentro de rotas /v1 privadas,
 * ou { preHandler: requireAuthHook(deps) } por rota.
 */
export function requireAuthHook(deps: AuthPluginDeps) {
  return async (req: FastifyRequest): Promise<void> => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof token !== 'string' || token === '') {
      throw unauthenticated();
    }
    const auth = resolveSession(deps.db, token, deps.clock);
    if (auth === null) {
      throw unauthenticated();
    }
    req.auth = auth;
  };
}

export function registerAuthPlugin(_app: FastifyInstance, _deps: AuthPluginDeps): void {
  // Hook é aplicado por rota (rotas públicas como /health e signup não exigem auth).
}
