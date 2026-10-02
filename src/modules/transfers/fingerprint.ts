import { createHash } from "node:crypto";

export interface TransferPayload {
  recipientAccountId: string;
  amountCents: number;
  note: string | null;
}

export function payloadFingerprint(payload: TransferPayload): string {
  const canonical = JSON.stringify([
    payload.recipientAccountId,
    payload.amountCents,
    payload.note,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
