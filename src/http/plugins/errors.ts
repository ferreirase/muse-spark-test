import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, toApiErrorResponse } from '../../shared/errors.js';

/** requestId gerado pelo servidor; header x-request-id devolvido em toda resposta. */
export function requestIdPlugin(app: FastifyInstance): void {
  void app.addHook('onRequest', async (req) => {
    // genReqId já preencheu req.id; garante fallback defensivo.
    if (!req.id) req.id = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });
  void app.addHook('onSend', async (req, reply) => {
    void reply.header('x-request-id', req.id);
  });
}

export function errorHandlerPlugin(app: FastifyInstance): void {
  app.setErrorHandler((err, req: FastifyRequest, reply) => {
    const requestId = req.id ?? 'unknown';
    const { statusCode, body } = toApiErrorResponse(err, requestId);
    if (statusCode >= 500) {
      req.log.error({ err, statusCode }, 'unhandled error');
    } else {
      req.log.info(
        {
          statusCode,
          code: (err as { code?: unknown }).code ?? (err instanceof AppError ? err.code : undefined),
        },
        'request error',
      );
    }
    void reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const requestId = req.id ?? 'unknown';
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Rota não encontrada' },
      requestId,
    });
  });
}

/** Caminhos de redaction do Pino: nunca logar segredos. */
export const LOGGER_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-test-control-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.tokenHash',
  'req.body.password',
] as const;
