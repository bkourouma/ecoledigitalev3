/** Lecture d'une erreur `pg` en `DbViolation` (domaine) : SQLSTATE, message, contrainte. */
import type { DbViolation } from "../domain/errors";

export function violationOf(e: unknown): DbViolation | null {
  if (typeof e !== "object" || e === null) return null;
  const err = e as { code?: unknown; message?: unknown; constraint?: unknown };
  if (typeof err.code !== "string" || typeof err.message !== "string") return null;
  // SQLSTATE sur 5 caractères uniquement (les codes applicatifs `schoollife.*` ne sont pas des erreurs de base).
  if (!/^[0-9A-Z]{5}$/.test(err.code)) return null;
  return { sqlstate: err.code, message: err.message, constraint: typeof err.constraint === "string" ? err.constraint : undefined };
}
