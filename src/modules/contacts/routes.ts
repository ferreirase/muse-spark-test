import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import { unauthenticated } from "../../shared/errors.js";
import {
  accountIdParamsSchema,
  addContactBodySchema,
  contactListSchema,
  contactSchema,
  errorResponseSchema,
  recipientSchema,
} from "../../shared/schemas.js";
import { addContact, type AddContactInput } from "./commands/add-contact.js";
import { getRecipient } from "./queries/get-recipient.js";
import { listContacts } from "./queries/list-contacts.js";

export function registerContactsRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): void {
  app.get(
    "/recipients/:accountId",
    {
      preHandler: app.authenticate,
      schema: {
        params: accountIdParamsSchema,
        response: {
          200: recipientSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) throw unauthenticated();
      const { accountId } = request.params as { accountId: string };
      return getRecipient(deps.db, auth.accountId, accountId);
    },
  );

  app.get(
    "/contacts",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: contactListSchema, 401: errorResponseSchema } },
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) throw unauthenticated();
      return { items: listContacts(deps.db, auth.userId) };
    },
  );

  app.post(
    "/contacts",
    {
      preHandler: app.authenticate,
      schema: {
        body: addContactBodySchema,
        response: {
          201: contactSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) throw unauthenticated();
      const contact = addContact(
        {
          db: deps.db,
          clock: deps.clock,
          ...(deps.generateId ? { generateId: deps.generateId } : {}),
        },
        auth.userId,
        auth.accountId,
        request.body as AddContactInput,
      );
      reply.status(201);
      return contact;
    },
  );
}
