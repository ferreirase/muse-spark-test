import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import { unauthenticated } from "../../shared/errors.js";
import {
  errorResponseSchema,
  requestTransferBodySchema,
  transferIdParamsSchema,
  transferPageSchema,
  transferQuerySchema,
  transferSchema,
} from "../../shared/schemas.js";
import { validateLimit } from "../../shared/validation.js";
import {
  requestTransfer,
  type RequestTransferInput,
} from "./commands/request-transfer.js";
import { getTransfer } from "./queries/get-transfer.js";
import { listTransfers } from "./queries/list-transfers.js";

export function registerTransfersRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): void {
  app.post(
    "/transfers",
    {
      preHandler: app.authenticate,
      schema: {
        body: requestTransferBodySchema,
        response: {
          200: transferSchema,
          202: transferSchema,
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
      const body = request.body as Omit<RequestTransferInput, "idempotencyKey">;
      const result = requestTransfer(
        {
          db: deps.db,
          clock: deps.clock,
          ...(deps.generateId ? { generateId: deps.generateId } : {}),
        },
        auth.accountId,
        {
          ...body,
          idempotencyKey: request.headers["idempotency-key"],
        },
      );
      reply.status(result.created ? 202 : 200);
      return result.transfer;
    },
  );

  app.get(
    "/transfers/:id",
    {
      preHandler: app.authenticate,
      schema: {
        params: transferIdParamsSchema,
        response: {
          200: transferSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) throw unauthenticated();
      const { id } = request.params as { id: string };
      return getTransfer(deps.db, auth.accountId, id);
    },
  );

  app.get(
    "/transfers",
    {
      preHandler: app.authenticate,
      schema: {
        querystring: transferQuerySchema,
        response: {
          200: transferPageSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) throw unauthenticated();
      const query = request.query as { limit?: string; cursor?: string };
      const limit = validateLimit(query.limit);
      return listTransfers(deps.db, auth.accountId, {
        limit,
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      });
    },
  );
}
