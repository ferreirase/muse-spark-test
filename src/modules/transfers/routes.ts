import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import {
  apiErrorSchema,
  listTransfersQuerySchema,
  requestTransferBodySchema,
  transferHeadersSchema,
  transferPageSchema,
  transferParamsSchema,
  transferSchema,
} from '../../shared/schemas.js';
import { requireAuthHook } from '../../http/plugins/auth.js';
import { requestTransfer } from './commands/request-transfer.js';
import { getTransfer } from './queries/get-transfer.js';
import { listTransfers } from './queries/list-transfers.js';

export function registerTransferRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.post(
    '/v1/transfers',
    {
      preHandler: requireAuthHook({ db: deps.db, clock: deps.clock }),
      schema: {
        body: requestTransferBodySchema,
        headers: transferHeadersSchema,
        response: { 200: transferSchema, 201: transferSchema, 202: transferSchema, '4xx': apiErrorSchema, 500: apiErrorSchema },
      },
    },
    async (req, reply) => {
      const headers = req.headers as Record<string, unknown>;
      const key = headers['idempotency-key'];
      const { transfer, replay } = requestTransfer(
        {
          db: deps.db,
          clock: deps.clock,
          onAccepted: () => {
            try {
              deps.worker?.wake?.();
            } catch {
              /* worker ainda não plugado — polling cobre */
            }
          },
        },
        {
          sourceAccountId: req.auth?.accountId ?? '',
          idempotencyKey: key,
          body: (req.body ?? {}) as {
            recipientAccountId: unknown;
            amountCents: unknown;
            note?: unknown;
          },
        },
      );
      req.log.info(
        { transferId: transfer.id, replay },
        'transferência aceita',
      );
      return reply.status(replay ? 200 : 202).send(transfer);
    },
  );

  void app.get(
    '/v1/transfers/:id',
    {
      preHandler: requireAuthHook({ db: deps.db, clock: deps.clock }),
      schema: {
        params: transferParamsSchema,
        response: { 200: transferSchema, '4xx': apiErrorSchema, 500: apiErrorSchema },
      },
    },
    async (req) => {
      const params = req.params as { id: string };
      return getTransfer(deps.db, { sourceAccountId: req.auth?.accountId ?? '', transferId: params.id });
    },
  );

  void app.get(
    '/v1/transfers',
    {
      preHandler: requireAuthHook({ db: deps.db, clock: deps.clock }),
      schema: {
        querystring: listTransfersQuerySchema,
        response: { 200: transferPageSchema, '4xx': apiErrorSchema, 500: apiErrorSchema },
      },
    },
    async (req) => {
      const query = (req.query ?? {}) as { limit?: unknown; cursor?: unknown };
      return listTransfers(deps.db, {
        sourceAccountId: req.auth?.accountId ?? '',
        limit: query.limit,
        cursor: query.cursor,
      });
    },
  );
}
