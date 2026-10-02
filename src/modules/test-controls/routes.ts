import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import type { TransferWorker } from "../worker/worker.js";
import { AppError } from "../../shared/errors.js";
import { sessionTokensEqual } from "../auth/session-token.js";
import {
  errorResponseSchema,
  testFaultBodySchema,
  testFaultResultSchema,
  testReleaseBodySchema,
} from "../../shared/schemas.js";
import { reset } from "../../db/reset.js";
import { armFault, type FaultMode } from "./faults.js";
import { validationError } from "../../shared/errors.js";

interface FaultsBody {
  sourceAccountId: string;
  idempotencyKey: string;
  mode: FaultMode;
}

interface ReleaseBody {
  transferId: string;
}

export function registerTestControlRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  worker: TransferWorker,
): void {
  if (!deps.config.enableTestControls) return;

  app.register(
    async (instance) => {
      instance.addHook("onRequest", async (request) => {
        const token = request.headers["x-test-control-token"];
        if (
          typeof token !== "string" ||
          !sessionTokensEqual(token, deps.config.testControlToken)
        ) {
          throw new AppError("FORBIDDEN", 403);
        }
      });

      instance.post("/reset", async (_request, reply) => {
        await worker.stop();
        try {
          await reset(deps.db, { clock: deps.clock });
        } finally {
          worker.start();
        }
        reply.status(204);
        return null;
      });

      instance.post(
        "/faults",
        {
          schema: {
            body: testFaultBodySchema,
            response: {
              201: testFaultResultSchema,
              400: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const body = request.body as FaultsBody;
          if (body.sourceAccountId.trim() === "") {
            throw validationError([
              { field: "sourceAccountId", message: "sourceAccountId must not be empty" },
            ]);
          }
          if (body.idempotencyKey.trim() === "") {
            throw validationError([
              { field: "idempotencyKey", message: "idempotencyKey must not be empty" },
            ]);
          }
          armFault(
            {
              db: deps.db,
              clock: deps.clock,
              ...(deps.generateId ? { generateId: deps.generateId } : {}),
            },
            {
              sourceAccountId: body.sourceAccountId,
              idempotencyKey: body.idempotencyKey,
              mode: body.mode,
            },
          );
          reply.status(201);
          return { armed: true };
        },
      );

      instance.post(
        "/release",
        {
          schema: {
            body: testReleaseBodySchema,
            response: { 204: { type: "null" }, 400: errorResponseSchema, 403: errorResponseSchema },
          },
        },
        async (request, reply) => {
          const body = request.body as ReleaseBody;
          worker.release(body.transferId);
          reply.status(204);
          return null;
        },
      );
    },
    { prefix: "/__test" },
  );
}
