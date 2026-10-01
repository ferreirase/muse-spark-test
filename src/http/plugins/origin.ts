import type { FastifyInstance } from 'fastify';
import { errors } from '../../shared/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Política de Origin (contrato §4): métodos seguros sempre passam; mutações
 * sem Origin passam (CLI/testes); mutação com Origin só passa se for exatamente
 * a origem configurada do frontend.
 */
export function isOriginAllowed(args: {
  method: string;
  origin: string | undefined;
  allowedOrigin: string;
}): boolean {
  if (SAFE_METHODS.has(args.method.toUpperCase())) return true;
  const { origin } = args;
  if (origin === undefined || origin === null || origin === '') return true;
  return origin === args.allowedOrigin;
}

export function registerOriginPlugin(app: FastifyInstance, allowedOrigin: string): void {
  app.addHook('onRequest', async (request) => {
    const origin = request.headers.origin;
    if (!isOriginAllowed({ method: request.method, origin, allowedOrigin })) {
      throw errors.originNotAllowed();
    }
  });
}
