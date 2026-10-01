/** Aides de lecture des erreurs `pg` propres au module (SQLSTATE). */
import { pgErrorCode } from "@ecoledigitale/database";

/** 23P01 : contrainte d'exclusion (chevauchement de périodes d'effet de versions ou de liaisons actives). */
export const isExclusionViolation = (e: unknown): boolean => pgErrorCode(e) === "23P01";

/** 23001 : écriture interdite par un trigger de garde (`rules.version_immutable`, `rules.transition_forbidden`…). */
export const isRestrictViolation = (e: unknown): boolean => pgErrorCode(e) === "23001";

/** 42P01 : table inexistante (migrations non appliquées). */
export const isUndefinedTable = (e: unknown): boolean => pgErrorCode(e) === "42P01";

/** Code stable `rules.*` porté par le message d'un trigger de garde (`rules.version_immutable: …`). */
export function guardCode(e: unknown): string | null {
  const message = e instanceof Error ? e.message : "";
  const m = /^(rules\.[a-z_]+):/.exec(message);
  return m ? (m[1] as string) : null;
}
