import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { responseSchemas } from '../../shared/schemas.js';
import { getRecipient } from './queries/get-recipient.js';

export interface ContactsRoutesDeps {
  db: Database.Database;
}

export function registerContactsRoutes(app: FastifyInstance, deps: ContactsRoutesDeps): void {
  app.get('/v1/recipients/:accountId', {
    preHandler: app.requireAuth,
    schema: {
      params: {
        type: 'object',
        required: ['accountId'],
        properties: { accountId: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: {
        200: responseSchemas.recipient,
        401: responseSchemas.apiError,
        404: responseSchemas.apiError,
        422: responseSchemas.apiError,
      },
    },
  }, async (request) => {
    const { accountId } = request.params as { accountId: string };
    return getRecipient(deps.db, { requesterAccountId: request.auth.accountId, accountId });
  });
}
