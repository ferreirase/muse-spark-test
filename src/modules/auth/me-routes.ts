import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { apiErrorSchema, authResultSchema } from '../../shared/schemas.js';
import { requireAuthHook } from '../../http/plugins/auth.js';
import { getMe } from '../auth/queries/get-me.js';

export function registerMeRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.get(
    '/v1/me',
    {
      preHandler: requireAuthHook({ db: deps.db, clock: deps.clock }),
      schema: { response: { 200: authResultSchema, '4xx': apiErrorSchema, 500: apiErrorSchema } },
    },
    async (req) => getMe(deps.db, req.auth?.userId ?? ''),
  );
}
