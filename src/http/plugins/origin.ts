import { originNotAllowed } from '../../shared/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Política de Origin (contrato §4): métodos seguros sempre passam;
 * mutações passam sem Origin (CLI/testes) ou com Origin == allowedOrigin.
 */
export function isOriginAllowed(args: {
  method: string;
  origin: string | undefined;
  allowedOrigin: string;
}): boolean {
  if (SAFE_METHODS.has(args.method.toUpperCase())) return true;
  const { origin } = args;
  if (origin === undefined || origin === '') return true;
  return origin === args.allowedOrigin;
}

export function checkOrigin(args: {
  method: string;
  origin: string | undefined;
  allowedOrigin: string;
}): void {
  if (!isOriginAllowed(args)) {
    throw originNotAllowed(`Origin ${JSON.stringify(args.origin)} não permitida`);
  }
}
