import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import {
  apiErrorSchema,
  authResultSchema,
  signinBodySchema,
  signupBodySchema,
} from '../../shared/schemas.js';
import { requireAuthHook } from '../../http/plugins/auth.js';
import { clearSessionCookie, setSessionCookie } from './cookie.js';
import { signin, signout, signup } from './commands/auth-commands.js';

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const cmdDeps = { db: deps.db, clock: deps.clock };

  void app.post(
    '/v1/auth/signup',
    {
      schema: {
        body: signupBodySchema,
        response: { 201: authResultSchema, '4xx': apiErrorSchema, 500: apiErrorSchema },
      },
    },
    async (req, reply) => {
      const { authResult, session } = await signup(cmdDeps, (req.body ?? {}) as { name: unknown; email: unknown; password: unknown });
      req.log.info({ userId: authResult.user.id }, 'signup');
      setSessionCookie(reply, session.token, session.expiresAt, deps.config.cookieSecure);
      return reply.status(201).send(authResult);
    },
  );

  void app.post(
    '/v1/auth/signin',
    {
      schema: {
        body: signinBodySchema,
        response: { 200: authResultSchema, '4xx': apiErrorSchema, 500: apiErrorSchema },
      },
    },
    async (req, reply) => {
      const { authResult, session } = await signin(cmdDeps, (req.body ?? {}) as { email: unknown; password: unknown });
      req.log.info({ userId: authResult.user.id }, 'signin');
      setSessionCookie(reply, session.token, session.expiresAt, deps.config.cookieSecure);
      return reply.status(200).send(authResult);
    },
  );

  // Signout: sem validação de corpo (proxy pode enviar Content-Type + corpo vazio).
  // Fastify rejeita corpo vazio com Content-Type json ANTES da rota (FST_ERR_CTP_EMPTY_JSON_BODY).
  // onRequest por rota não existe; usa preParsing só no signout para normalizar.
  void app.post(
    '/v1/auth/signout',
    {
      preParsing: async (req, _reply, payload: unknown) => {
        const raw = req.headers['content-type'] ?? '';
        if (typeof raw === 'string' && raw.includes('application/json')) {
          const chunks: Buffer[] = [];
          const stream = payload as AsyncIterable<Buffer>;
          for await (const c of stream) chunks.push(Buffer.from(c));
          const text = Buffer.concat(chunks).toString('utf8');
          if (text.trim() === '') {
            const { Readable } = await import('node:stream');
            return Readable.from(['{}']);
          }
          const { Readable } = await import('node:stream');
          return Readable.from([text]);
        }
        return payload as import('node:stream').Readable;
      },
      preHandler: requireAuthHookOptional(),
    },
    async (req, reply) => {
      const token = req.cookies?.['bank_session'];
      signout(cmdDeps, token);
      clearSessionCookie(reply, deps.config.cookieSecure);
      return reply.status(204).send();
    },
  );

  function requireAuthHookOptional() {
    const strict = requireAuthHook({ db: deps.db, clock: deps.clock });
    return async (req: Parameters<typeof strict>[0]): Promise<void> => {
      try {
        await strict(req);
      } catch {
        // Signout é idempotente: segue sem auth.
      }
    };
  }
}
