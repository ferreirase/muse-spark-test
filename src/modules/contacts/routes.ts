import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import {
  addContactBodySchema,
  apiErrorSchema,
  contactSchema,
  contactsListSchema,
  recipientParamsSchema,
  recipientSchema,
} from '../../shared/schemas.js';
import { requireAuthHook } from '../../http/plugins/auth.js';
import { addContact } from './commands/add-contact.js';
import { getRecipient } from './queries/get-recipient.js';
import { listContacts } from './queries/list-contacts.js';

export function registerContactRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.get(
    '/v1/recipients/:accountId',
    {
      preHandler: requireAuthHook({ db: deps.db, clock: deps.clock }),
      schema: {
        params: recipientParamsSchema,
        response: { 200: recipientSchema, '4xx': apiErrorSchema, 500: apiErrorSchema },
      },
    },
    async (req) => {
      const params = req.params as { accountId: string };
      return getRecipient(deps.db, {
        requesterAccountId: req.auth?.accountId ?? '',
        accountId: params.accountId,
      });
    },
  );

  void app.get(
    '/v1/contacts',
    {
      preHandler: requireAuthHook({ db: deps.db, clock: deps.clock }),
      schema: { response: { 200: contactsListSchema, '4xx': apiErrorSchema, 500: apiErrorSchema } },
    },
    async (req) => ({ items: listContacts(deps.db, req.auth?.userId ?? '') }),
  );

  void app.post(
    '/v1/contacts',
    {
      preHandler: requireAuthHook({ db: deps.db, clock: deps.clock }),
      schema: {
        body: addContactBodySchema,
        response: { 201: contactSchema, '4xx': apiErrorSchema, 500: apiErrorSchema },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as { nickname: unknown; recipientAccountId: unknown };
      const contact = addContact(
        { db: deps.db, clock: deps.clock },
        {
          ownerUserId: req.auth?.userId ?? '',
          ownerAccountId: req.auth?.accountId ?? '',
          nickname: body.nickname,
          recipientAccountId: body.recipientAccountId,
        },
      );
      return reply.status(201).send(contact);
    },
  );
}
