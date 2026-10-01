import { createHash } from 'node:crypto';

export interface TransferPayload {
  recipientAccountId: string;
  amountCents: number;
  note: string | null;
}

/** SHA-256 do JSON canônico (chaves em ordem fixa, nota já normalizada). */
export function fingerprintTransferPayload(p: TransferPayload): string {
  const canonical = `{"amountCents":${p.amountCents},"note":${JSON.stringify(p.note)},"recipientAccountId":${JSON.stringify(p.recipientAccountId)}}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
