import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Clock } from '../../shared/clock.js';
import { responseSchemas, addContactBodySchema } from '../../shared/schemas.js';
import { getRecipient } from './queries/get-recipient.js';
import { listContacts } from './queries/list-contacts.js';
import { addContact } from './commands/add-contact.js';

export interface ContactsRoutesDeps {
  db: Database.Database;
  clock: Clock;
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

  app.get('/v1/contacts', {
    preHandler: app.requireAuth,
    schema: { response: { 200: responseSchemas.contactList, 401: responseSchemas.apiError } },
  }, async (request) => {
    return { items: listContacts(deps.db, request.auth.userId) };
  });

  app.post('/v1/contacts', {
    preHandler: app.requireAuth,
    schema: {
      body: addContactBodySchema,
      response: {
        201: responseSchemas.contact,
        400: responseSchemas.apiError,
        401: responseSchemas.apiError,
        404: responseSchemas.apiError,
        409: responseSchemas.apiError,
        422: responseSchemas.apiError,
      },
    },
  }, async (request, reply) => {
    const body = request.body as { nickname: unknown; recipientAccountId: string };
    const contact = addContact(
      { db: deps.db, now: deps.clock() },
      {
        ownerUserId: request.auth.userId,
        ownerAccountId: request.auth.accountId,
        nickname: body.nickname,
        recipientAccountId: body.recipientAccountId,
      },
    );
    request.log.info({ contactId: contact.id, userId: request.auth.userId }, 'contato criado');
    return reply.code(201).send(contact);
  });
}
