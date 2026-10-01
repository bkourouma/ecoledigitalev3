/**
 * Traduction des erreurs de l'API en messages d'écran (fonctions pures).
 *
 * Règle (docs/i18n.md) : les messages métier de l'API (`{ code, message }`, déjà en français) restent la source de
 * vérité ; on ne remplace que les codes pour lesquels l'écran sait dire quelque chose de plus utile (anti-escalade,
 * dernier propriétaire…) et les erreurs techniques du client (réseau, délai, session).
 */

import { ApiError, ClientErrorCode } from "@/platform/api/errors";

/** Code d'erreur de l'API -> clé du namespace `apiErrors` (les clés next-intl ne peuvent pas contenir de point). */
export const API_ERROR_KEYS: Readonly<Record<string, string>> = Object.freeze({
  "rbac.escalation_denied": "escalationDenied",
  "rbac.last_owner": "lastOwner",
  "rbac.role_locked": "roleLocked",
  "rbac.role_in_use": "roleInUse",
  "rbac.mfa_required": "mfaRequired",
  "rbac.role_key_taken": "roleKeyTaken",
  "rbac.unknown_permission": "unknownPermission",
  "rbac.unknown_scope": "unknownScope",
  "rbac.invalid_pattern": "invalidPermission",
});

export interface ErrorMessageSpec {
  /** Namespace + clé (`apiErrors.lastOwner`, `errors.network`…). */
  key: string;
  values?: Record<string, string>;
  /** Message de l'API à afficher tel quel quand aucune clé ne convient. */
  raw?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Permissions citées par le détail d'une erreur d'anti-escalade / de permission inconnue. */
export function permissionsFromDetails(details: unknown): string[] {
  const rec = asRecord(details);
  if (!rec) return [];
  const direct = stringList(rec.permissions);
  return direct.length > 0 ? direct : stringList(rec.unknown);
}

export function errorMessageSpec(error: unknown): ErrorMessageSpec {
  if (!(error instanceof ApiError)) return { key: "errors.generic" };

  const mapped = API_ERROR_KEYS[error.code];
  if (mapped) {
    const permissions = permissionsFromDetails(error.details);
    return { key: `apiErrors.${mapped}`, values: { permissions: permissions.join(", ") }, raw: error.message };
  }

  switch (error.code) {
    case ClientErrorCode.NETWORK:
      return { key: "errors.network" };
    case ClientErrorCode.TIMEOUT:
      return { key: "errors.timeout" };
    case ClientErrorCode.TENANT_UNKNOWN:
      return { key: "common.tenantUnknown" };
    case ClientErrorCode.RESPONSE_INVALID:
      return { key: "errors.invalidResponse" };
    case ClientErrorCode.ABORTED:
      return { key: "errors.generic" };
  }

  // Erreurs métier de l'API : son message (français) fait foi.
  if (error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429 && error.message) {
    return { key: statusKey(error.status), raw: error.message };
  }
  return { key: statusKey(error.status) };
}

function statusKey(status: number): string {
  switch (status) {
    case 401:
      return "errors.unauthorized";
    case 403:
      return "errors.forbidden";
    case 404:
      return "errors.notFound";
    case 409:
      return "errors.conflict";
    case 400:
    case 422:
      return "errors.validation";
    case 429:
      return "errors.rateLimited";
    default:
      return "errors.generic";
  }
}

/** Erreurs de validation par champ (`details: [{ path: ["permissions"], message }]` ou `{ issues: [...] }`). */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const rec = asRecord(error.details);
  const list = Array.isArray(error.details) ? error.details : Array.isArray(rec?.issues) ? (rec?.issues as unknown[]) : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const issue = asRecord(entry);
    if (!issue || typeof issue.message !== "string") continue;
    const path = Array.isArray(issue.path) ? issue.path.join(".") : typeof issue.path === "string" ? issue.path : "";
    if (path && !(path in out)) out[path] = issue.message;
  }
  return out;
}

/** Statut 404 d'un endpoint non livré (≠ ressource introuvable) : l'écran affiche « indisponible ». */
export function isUnavailableEndpoint(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}
