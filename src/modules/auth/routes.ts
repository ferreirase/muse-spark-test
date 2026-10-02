import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import { clearSessionCookie, setSessionCookie } from "../../http/cookies.js";
import {
  authResultSchema,
  errorResponseSchema,
  signinBodySchema,
  signupBodySchema,
} from "../../shared/schemas.js";
import { signin, type SigninInput } from "./commands/signin.js";
import { signout } from "./commands/signout.js";
import { signup, type SignupInput } from "./commands/signup.js";

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    "/signup",
    {
      schema: {
        body: signupBodySchema,
        response: { 201: authResultSchema, 400: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await signup(
        { db: deps.db, clock: deps.clock, ...(deps.generateId ? { generateId: deps.generateId } : {}) },
        request.body as SignupInput,
      );
      setSessionCookie(reply, result.token, deps.config);
      reply.header("Cache-Control", "no-store");
      reply.status(201);
      return result.auth;
    },
  );

  app.post(
    "/signin",
    {
      schema: {
        body: signinBodySchema,
        response: { 200: authResultSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await signin(
        { db: deps.db, clock: deps.clock, ...(deps.generateId ? { generateId: deps.generateId } : {}) },
        request.body as SigninInput,
      );
      setSessionCookie(reply, result.token, deps.config);
      reply.header("Cache-Control", "no-store");
      return result.auth;
    },
  );

  app.post(
    "/signout",
    { schema: { response: { 204: { type: "null" } } } },
    async (request, reply) => {
      const sessionId = request.auth?.sessionId;
      if (sessionId) {
        signout({ db: deps.db, clock: deps.clock }, sessionId);
      }
      clearSessionCookie(reply, deps.config);
      reply.header("Cache-Control", "no-store");
      reply.status(204);
      return null;
    },
  );
}
