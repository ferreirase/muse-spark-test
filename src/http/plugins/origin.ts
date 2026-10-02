import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { originNotAllowed } from "../../shared/errors.js";
import { isOriginAllowed } from "../origin.js";

export interface OriginPluginOptions {
  frontendOrigin: string;
}

export default fp(
  async function originGuard(
    app: FastifyInstance,
    options: OriginPluginOptions,
  ): Promise<void> {
    app.addHook("onRequest", async (request) => {
      if (
        !isOriginAllowed(
          request.method,
          request.headers.origin,
          options.frontendOrigin,
        )
      ) {
        throw originNotAllowed();
      }
    });
  },
  { name: "origin-guard", fastify: "5.x" },
);
