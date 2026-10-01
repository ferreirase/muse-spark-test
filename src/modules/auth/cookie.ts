import type { FastifyReply } from 'fastify';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './session-repository.js';

/** Helpers de cookie bank_session (contrato §4). */

export function cookieAttrs(secure: boolean, expires: Date): {
  path: string;
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
  expires: Date;
} {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    expires,
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: string,
  secure: boolean,
): void {
  void reply.setCookie(SESSION_COOKIE_NAME, token, cookieAttrs(secure, new Date(expiresAt)));
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  void reply.setCookie(SESSION_COOKIE_NAME, '', { ...cookieAttrs(secure, new Date(0)), maxAge: 0 });
}
