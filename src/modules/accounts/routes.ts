import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { errors } from '../../shared/errors.js';
import { responseSchemas } from '../../shared/schemas.js';
import { getMe } from '../auth/queries/get-me.js';
import { getBalance } from './queries/get-balance.js';

export interface AccountsRoutesDeps {
  db: Database.Database;
}

/** Rotas /v1/me e /v1/accounts/me/balance — leitura via query handlers. */
export function registerAccountsRoutes(app: FastifyInstance, deps: AccountsRoutesDeps): void {
  app.get('/v1/me', {
    preHandler: app.requireAuth,
    schema: { response: { 200: responseSchemas.authResult, 401: responseSchemas.apiError } },
  }, async (request) => {
    const result = getMe(deps.db, request.auth.userId);
    if (!result) throw errors.unauthenticated();
    return result;
  });

  app.get('/v1/accounts/me/balance', {
    preHandler: app.requireAuth,
    schema: { response: { 200: responseSchemas.balance, 401: responseSchemas.apiError } },
  }, async (request) => {
    const balance = getBalance(deps.db, request.auth.accountId);
    if (!balance) throw errors.unauthenticated();
    return balance;
  });
}
