import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SqliteDb } from "../../db/connection.js";
import type { Clock } from "../../shared/clock.js";
import { unauthenticated } from "../../shared/errors.js";
import { hashSessionToken } from "../../modules/auth/session-token.js";
import {
  findAccountByUserId,
  findSessionByTokenHash,
} from "../../modules/auth/repositories.js";
import "../types.js";

export const SESSION_COOKIE = "bank_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface AuthPluginOptions {
  db: SqliteDb;
  clock: Clock;
}

async function authPlugin(
  app: FastifyInstance,
  options: AuthPluginOptions,
): Promise<void> {
  const { db, clock } = options;

  app.decorateRequest("auth", undefined);

  app.decorate(
    "authenticate",
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      const token = request.cookies[SESSION_COOKIE];
      if (!token) throw unauthenticated();

      const session = findSessionByTokenHash(db, hashSessionToken(token));
      if (!session) throw unauthenticated();
      if (session.revoked_at !== null) throw unauthenticated();
      if (new Date(session.expires_at).getTime() <= clock.now().getTime()) {
        throw unauthenticated();
      }

      const account = findAccountByUserId(db, session.user_id);
      if (!account) throw unauthenticated();

      request.auth = {
        sessionId: session.id,
        userId: session.user_id,
        accountId: account.id,
      };
    },
  );

}

export default fp(authPlugin, {
  name: "auth",
  fastify: "5.x",
});
