/**
 * Retraduit les violations levées par les déclencheurs SQL de `results` (préfixe `results.<code>: …`) en erreurs métier
 * typées : une course ou un contournement produit une réponse stable (409), jamais un 500.
 */
import { isAppError, type AppError } from "@ecoledigitale/kernel";
import { DB_CODE_MESSAGES, ResultsCode, conflict, dbCodeOf } from "../domain/errors";

export function mapDbError(e: unknown): AppError | null {
  if (isAppError(e)) return e;
  const message = (e as { message?: unknown })?.message;
  if (typeof message !== "string") return null;
  const code = dbCodeOf(message);
  if (!code) return null;
  const known = DB_CODE_MESSAGES[code];
  return known ? conflict(known.code, known.message, { dbCode: code }) : conflict(ResultsCode.FINAL_IMMUTABLE, "Opération refusée par les garde-fous de la base.", { dbCode: code });
}

export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const mapped = mapDbError(e);
    if (mapped) throw mapped;
    throw e;
  }
}
