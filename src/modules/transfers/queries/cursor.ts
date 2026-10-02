import { validationError } from "../../../shared/errors.js";

const SEPARATOR = "\u0000";

export interface TransferCursor {
  createdAt: string;
  id: string;
}

export function encodeTransferCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}${SEPARATOR}${id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeTransferCursor(cursor: string): TransferCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw invalidCursor();
  }
  const index = decoded.indexOf(SEPARATOR);
  if (index <= 0) throw invalidCursor();
  const createdAt = decoded.slice(0, index);
  const id = decoded.slice(index + 1);
  if (id.length === 0 || Number.isNaN(Date.parse(createdAt))) {
    throw invalidCursor();
  }
  return { createdAt, id };
}

function invalidCursor() {
  return validationError([
    { field: "cursor", message: "cursor is invalid or corrupted" },
  ]);
}
