import type { SqliteDb } from "../../../db/connection.js";
import type { Clock } from "../../../shared/clock.js";

export interface SignoutDeps {
  db: SqliteDb;
  clock: Clock;
}

export interface SignoutResult {
  revoked: boolean;
}

export function signout(
  deps: SignoutDeps,
  sessionId: string | undefined,
): SignoutResult {
  if (!sessionId) return { revoked: false };
  const nowIso = deps.clock.now().toISOString();
  const result = deps.db
    .prepare(
      "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .run(nowIso, sessionId);
  return { revoked: result.changes > 0 };
}
