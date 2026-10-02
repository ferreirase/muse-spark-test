import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { AppDeps } from "./deps.js";
import { errorResponseSchema, healthSchema } from "./shared/schemas.js";
import errorHandler from "./http/plugins/error-handler.js";
import originGuard from "./http/plugins/origin.js";
import authPlugin from "./http/plugins/auth.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerAccountsRoutes } from "./modules/accounts/routes.js";
import { registerContactsRoutes } from "./modules/contacts/routes.js";
import { registerTransfersRoutes } from "./modules/transfers/routes.js";
import { registerTestControlRoutes } from "./modules/test-controls/routes.js";
import { TransferWorker, type WorkerOptions } from "./modules/worker/worker.js";

export interface BuiltApp {
  app: FastifyInstance;
  worker: TransferWorker;
}

export interface BuildAppOptions extends AppDeps {
  worker?: TransferWorker;
  workerOverrides?: Partial<
    Pick<WorkerOptions, "sleep" | "leaseMs" | "workerId" | "maxAttempts" | "baseDelayMs">
  >;
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const { db, config, clock } = options;

  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                "req.headers.cookie",
                "req.headers.authorization",
                "req.headers['x-test-control-token']",
                "res.headers['set-cookie']",
                "*.password",
                "*.passwordHash",
                "*.password_hash",
              ],
              censor: "[redacted]",
            },
          },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        allErrors: true,
        useDefaults: false,
      },
    },
  });

  await app.register(cookie);
  await app.register(errorHandler);
  await app.register(originGuard, { frontendOrigin: config.frontendOrigin });
  await app.register(authPlugin, { db, clock });

  const worker =
    options.worker ??
    new TransferWorker({
      db,
      clock,
      pollIntervalMs: config.workerPollIntervalMs,
      ...(options.workerOverrides ?? {}),
    });

  app.get("/health", { schema: { response: { 200: healthSchema, 503: errorResponseSchema } } }, async (request, reply) => {
    try {
      db.prepare("SELECT 1").get();
      return { status: "ok" };
    } catch {
      reply.status(503);
      return {
        error: { code: "SERVICE_UNAVAILABLE", message: "SQLite is not ready." },
        requestId: request.id,
      };
    }
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    if (
      request.url.startsWith("/v1") ||
      request.url.startsWith("/__test")
    ) {
      reply.header("Cache-Control", "no-store");
    }
  });

  app.register(
    async (instance) => {
      registerAuthRoutes(instance, options);
    },
    { prefix: "/v1/auth" },
  );

  app.register(
    async (instance) => {
      registerAccountsRoutes(instance, options);
    },
    { prefix: "/v1" },
  );

  app.register(
    async (instance) => {
      registerContactsRoutes(instance, options);
    },
    { prefix: "/v1" },
  );

  app.register(
    async (instance) => {
      registerTransfersRoutes(instance, options);
    },
    { prefix: "/v1" },
  );

  registerTestControlRoutes(app, options, worker);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Route not found." },
      requestId: request.id,
    });
  });

  await app.ready();

  return { app, worker };
}
