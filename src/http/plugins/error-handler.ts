import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import {
  mapError,
  mapFastifyValidation,
  type ApiErrorBody,
} from "../../shared/errors.js";

interface MaybeFastifyError {
  code?: unknown;
  statusCode?: unknown;
  validation?: unknown;
  message?: unknown;
}

export default fp(
  async function errorHandler(app: FastifyInstance): Promise<void> {
    app.setErrorHandler((error, request, reply) => {
      const fastifyError = error as MaybeFastifyError;

      const validationError = mapFastifyValidation(fastifyError);
      if (validationError) {
        const mapped = mapError(validationError);
        return reply.status(mapped.status).send({
          error: {
            code: mapped.code,
            message: mapped.message,
            ...(mapped.details ? { details: mapped.details } : {}),
          },
          requestId: request.id,
        } satisfies ApiErrorBody);
      }

      const statusCode =
        typeof fastifyError.statusCode === "number" ? fastifyError.statusCode : 500;

      if (statusCode >= 500) {
        request.log.error(
          { err: error, requestId: request.id },
          "unhandled request error",
        );
        const mapped = mapError(error);
        return reply.status(mapped.status).send({
          error: { code: mapped.code, message: mapped.message },
          requestId: request.id,
        } satisfies ApiErrorBody);
      }

      const message =
        typeof fastifyError.message === "string"
          ? fastifyError.message
          : "Invalid request.";
      request.log.warn(
        { err: error, requestId: request.id },
        "client request error",
      );
      return reply.status(statusCode).send({
        error: { code: "VALIDATION_ERROR", message },
        requestId: request.id,
      } satisfies ApiErrorBody);
    });
  },
  { name: "error-handler", fastify: "5.x" },
);
