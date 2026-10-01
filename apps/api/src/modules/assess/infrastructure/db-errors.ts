/**
 * Retraduit les violations levées par les déclencheurs SQL d'`assess` (préfixe `assess.<code>: …`) en erreurs métier
 * typées. Les déclencheurs sont la dernière défense : l'application refuse EN AMONT avec les mêmes codes ; ce
 * mappeur garantit qu'une course ou un contournement produit quand même une réponse stable (409/400), jamais un 500.
 */
import { isAppError, type AppError } from "@ecoledigitale/kernel";
import { AssessCode, DB_CODE_MESSAGES, conflict, dbCodeOf, validation } from "../domain/errors";

interface PgErrorLike {
  code?: string;
  message?: string;
}

export function mapDbError(e: unknown): AppError | null {
  if (isAppError(e)) return e;
  const pg = e as PgErrorLike;
  if (typeof pg?.message !== "string") return null;
  const code = dbCodeOf(pg.message);
  if (code) {
    const known = DB_CODE_MESSAGES[code];
    if (known) {
      return known.kind === "validation" ? validation(known.code, known.message, undefined, { dbCode: code }) : conflict(known.code, known.message, { dbCode: code });
    }
    return conflict(AssessCode.GRADE_FROZEN, "Opération refusée par les garde-fous de la base.", { dbCode: code });
  }
  return null;
}

/** Exécute `fn` en retraduisant les violations de déclencheur. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const mapped = mapDbError(e);
    if (mapped) throw mapped;
    throw e;
  }
}
