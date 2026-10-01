import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { apiErrorSchema, balanceSchema } from '../../shared/schemas.js';
import { requireAuthHook } from '../../http/plugins/auth.js';
import { getBalance } from './queries/get-balance.js';

export function registerAccountRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.get(
    '/v1/accounts/me/balance',
    {
      preHandler: requireAuthHook({ db: deps.db, clock: deps.clock }),
      schema: { response: { 200: balanceSchema, '4xx': apiErrorSchema, 500: apiErrorSchema } },
    },
    async (req) => getBalance(deps.db, req.auth?.accountId ?? ''),
  );
}
