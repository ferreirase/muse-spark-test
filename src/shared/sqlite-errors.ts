interface SqliteErrorLike {
  code?: unknown;
  message?: unknown;
}

export function isSqliteError(error: unknown, code: string): boolean {
  const candidate = error as SqliteErrorLike;
  return typeof candidate.code === "string" && candidate.code === code;
}

export function isUniqueConstraint(error: unknown): boolean {
  const candidate = error as SqliteErrorLike;
  if (typeof candidate.code === "string") {
    if (
      candidate.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      candidate.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    ) {
      return true;
    }
    if (!candidate.code.startsWith("SQLITE_CONSTRAINT")) return false;
  }
  return (
    typeof candidate.message === "string" &&
    candidate.message.includes("UNIQUE constraint failed")
  );
}

export function isBusyError(error: unknown): boolean {
  return (
    isSqliteError(error, "SQLITE_BUSY") || isSqliteError(error, "SQLITE_LOCKED")
  );
}
