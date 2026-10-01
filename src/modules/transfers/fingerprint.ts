import { createHash } from 'node:crypto';

/**
 * Fingerprint do payload normalizado de transferência (contrato §6):
 * SHA-256 do JSON canônico com chaves em ordem fixa. Nota já normalizada
 * (null quando ausente/vazia).
 */
export function fingerprintTransferPayload(input: {
  recipientAccountId: string;
  amountCents: number;
  note: string | null;
}): string {
  const canonical = `{"amountCents":${input.amountCents},"note":${JSON.stringify(input.note)},"recipientAccountId":${JSON.stringify(input.recipientAccountId)}}`;
  return createHash('sha256').update(canonical).digest('hex');
}
