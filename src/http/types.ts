import type { FastifyReply, FastifyRequest } from "fastify";

export interface AuthContext {
  sessionId: string;
  userId: string;
  accountId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
