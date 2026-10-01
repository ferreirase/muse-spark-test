import { timingSafeEqual } from 'node:crypto';

export type TestControlAccess = 'NOT_FOUND' | 'FORBIDDEN' | 'OK';

/**
 * Gate dos controles de teste (contrato §8): flag desligada → NOT_FOUND
 * (rota nem existe); sem token/token errado → FORBIDDEN; correto → OK.
 * Comparação em tempo constante; tamanhos diferentes falham rápido.
 */
export function checkTestControlAccess(args: {
  enabled: boolean;
  expectedToken: string;
  providedToken: string | undefined;
}): TestControlAccess {
  if (!args.enabled) return 'NOT_FOUND';
  if (args.providedToken === undefined || args.providedToken === '') return 'FORBIDDEN';
  const a = Buffer.from(args.expectedToken, 'utf8');
  const b = Buffer.from(args.providedToken, 'utf8');
  if (a.length !== b.length) return 'FORBIDDEN';
  return timingSafeEqual(a, b) ? 'OK' : 'FORBIDDEN';
}
