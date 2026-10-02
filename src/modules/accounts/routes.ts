import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import { unauthenticated } from "../../shared/errors.js";
import {
  authResultSchema,
  balanceSchema,
  errorResponseSchema,
} from "../../shared/schemas.js";
import { getMe } from "../auth/queries/get-me.js";
import { getBalance } from "./queries/get-balance.js";

export function registerAccountsRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): void {
  app.get(
    "/me",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: authResultSchema, 401: errorResponseSchema } },
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) throw unauthenticated();
      const result = getMe(deps.db, auth.userId);
      if (!result) throw unauthenticated();
      return result;
    },
  );

  app.get(
    "/accounts/me/balance",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: balanceSchema, 401: errorResponseSchema } },
    },
    async (request) => {
      const auth = request.auth;
      if (!auth) throw unauthenticated();
      const balance = getBalance(deps.db, auth.accountId);
      if (!balance) throw unauthenticated();
      return balance;
    },
  );
}
