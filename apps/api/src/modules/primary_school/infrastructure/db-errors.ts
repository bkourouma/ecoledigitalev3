/**
 * Retraduit les violations levées par les déclencheurs SQL de primary_school (préfixe `primary_school.<code>: …`) en erreurs
 * métier typées : une course ou un contournement produit une réponse stable (409), jamais un 500.
 */
import { isAppError, type AppError } from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import { DB_CODE_MESSAGES, PrimaryCode, conflict, dbCodeOf } from "../domain/errors";

export function mapDbError(e: unknown): AppError | null {
  if (isAppError(e)) return e;
  const message = (e as { message?: unknown })?.message;
  if (typeof message !== "string") return null;
  const code = dbCodeOf(message);
  if (!code) return null;
  const known = DB_CODE_MESSAGES[code];
  return known ? conflict(known.code, known.message, { dbCode: code }) : conflict(PrimaryCode.VALIDATED_FROZEN, "Opération refusée par les garde-fous de la base.", { dbCode: code });
}

/** Exécute `fn` en traduisant les garde-fous SQL en erreurs métier ; `onUnique` traduit une violation d'unicité. */
export async function guarded<T>(fn: () => Promise<T>, onUnique?: () => AppError): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (onUnique && isUniqueViolation(e)) throw onUnique();
    const mapped = mapDbError(e);
    if (mapped) throw mapped;
    throw e;
  }
}
