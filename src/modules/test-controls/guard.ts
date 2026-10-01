import { timingSafeEqual } from 'node:crypto';

/** Gate dos controles /__test (contrato §8). Comparação em tempo constante. */
export function checkTestControlAccess(args: {
  enabled: boolean;
  expectedToken: string;
  providedToken: string | undefined;
}): 'NOT_FOUND' | 'FORBIDDEN' | 'OK' {
  if (!args.enabled) return 'NOT_FOUND';
  const a = Buffer.from(args.expectedToken, 'utf8');
  const b = Buffer.from(args.providedToken ?? '', 'utf8');
  if (a.length !== b.length) return 'FORBIDDEN';
  if (a.length === 0) return 'FORBIDDEN';
  return timingSafeEqual(a, b) ? 'OK' : 'FORBIDDEN';
}
