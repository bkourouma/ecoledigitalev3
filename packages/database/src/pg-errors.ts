/** Aides de lecture des erreurs `pg` (SQLSTATE). */

export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export const isUniqueViolation = (e: unknown): boolean => pgErrorCode(e) === "23505";
export const isForeignKeyViolation = (e: unknown): boolean => pgErrorCode(e) === "23503";
export const isNotNullViolation = (e: unknown): boolean => pgErrorCode(e) === "23502";
export const isCheckViolation = (e: unknown): boolean => pgErrorCode(e) === "23514";
export const isSerializationFailure = (e: unknown): boolean => pgErrorCode(e) === "40001";
export const isDeadlock = (e: unknown): boolean => pgErrorCode(e) === "40P01";

/**
 * Violation de policy RLS (WITH CHECK) : SQLSTATE 42501 « insufficient_privilege »
 * AVEC un message mentionnant la sécurité au niveau ligne — à distinguer d'un
 * simple « permission denied for table » (même SQLSTATE).
 */
export function isRlsViolation(e: unknown): boolean {
  if (pgErrorCode(e) !== "42501") return false;
  const message = e instanceof Error ? e.message : "";
  return /row-level security|row level security|sécurité au niveau ligne|s.curit. au niveau/i.test(message);
}
