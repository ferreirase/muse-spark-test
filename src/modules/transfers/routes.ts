import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Clock } from '../../shared/clock.js';
import { responseSchemas, requestTransferBodySchema, idempotencyKeyHeaderSchema } from '../../shared/schemas.js';
import { requestTransfer } from './commands/request-transfer.js';

export interface TransfersRoutesDeps {
  db: Database.Database;
  clock: Clock;
  /** worker.wake() — plugado pela task do worker. */
  onAccepted?: () => void;
}

export function registerTransfersRoutes(app: FastifyInstance, deps: TransfersRoutesDeps): void {
  app.post('/v1/transfers', {
    preHandler: app.requireAuth,
    schema: {
      headers: idempotencyKeyHeaderSchema,
      body: requestTransferBodySchema,
      response: {
        200: responseSchemas.transfer,
        202: responseSchemas.transfer,
        400: responseSchemas.apiError,
        401: responseSchemas.apiError,
        404: responseSchemas.apiError,
        409: responseSchemas.apiError,
        422: responseSchemas.apiError,
      },
    },
  }, async (request, reply) => {
    const body = request.body as { recipientAccountId: string; amountCents: number; note?: unknown };
    const idempotencyKey = request.headers['idempotency-key'] as string;
    const { transfer, replay } = requestTransfer(
      { db: deps.db, now: deps.clock(), onAccepted: deps.onAccepted },
      {
        sourceAccountId: request.auth.accountId,
        idempotencyKey,
        recipientAccountId: body.recipientAccountId,
        amountCents: body.amountCents,
        note: body.note,
      },
    );
    request.log.info({ transferId: transfer.id, idempotencyKey, replay }, 'transferência aceita');
    return reply.code(replay ? 200 : 202).send(transfer);
  });
}
