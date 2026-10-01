import type { FastifyReply } from 'fastify';

export const SESSION_COOKIE = 'bank_session';

const cookieOptions = (secure: boolean, maxAge: number) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure,
  maxAge,
});

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string, secure: boolean): void {
  const expires = new Date(expiresAt);
  reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions(secure, 24 * 60 * 60), expires });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, '', { ...cookieOptions(secure, 0), expires: new Date(0) });
}
