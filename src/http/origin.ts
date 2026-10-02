const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutation(method: string): boolean {
  return MUTATION_METHODS.has(method.toUpperCase());
}

export function isOriginAllowed(
  method: string,
  origin: string | undefined,
  allowedOrigin: string,
): boolean {
  if (origin === undefined) return true;
  if (!isMutation(method)) return true;
  return origin === allowedOrigin;
}
