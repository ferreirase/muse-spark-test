import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import { SESSION_COOKIE, SESSION_TTL_MS } from "./plugins/auth.js";

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  config: AppConfig,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.cookieSecure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(
  reply: FastifyReply,
  config: AppConfig,
): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.cookieSecure,
  });
}
