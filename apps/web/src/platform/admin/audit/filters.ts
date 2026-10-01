/**
 * Filtres du journal d'audit (fonctions pures, testées).
 *
 * L'état du formulaire (chaînes, dates `datetime-local` en heure locale) est converti en paramètres de requête conformes à
 * `auditLogListQuerySchema` / `auditLogExportQuerySchema` (`packages/contracts/src/v2/audit.ts`) : instants ISO UTC,
 * niveaux séparés par des virgules. La validation finale reste celle de l'API ; on évite seulement les aller-retours inutiles.
 */

import { AUDIT_EXPORT_MAX_DAYS, AUDIT_EXPORT_MAX_ROWS, AUDIT_SEVERITIES } from "@ecoledigitale/contracts/v2/audit";
import type { QueryParams } from "@/platform/api/client";

export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];
export const SEVERITIES: readonly AuditSeverity[] = AUDIT_SEVERITIES;
export { AUDIT_EXPORT_MAX_DAYS, AUDIT_EXPORT_MAX_ROWS };

export interface AuditFilterState {
  actorId: string;
  entity: string;
  entityId: string;
  /** Action exacte (`role.changed`) ou préfixe (`role.*`). */
  action: string;
  severity: readonly AuditSeverity[];
  /** Valeur d'un `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`), heure locale. */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: AuditFilterState = {
  actorId: "",
  entity: "",
  entityId: "",
  action: "",
  severity: [],
  from: "",
  to: "",
};

export type AuditFilterErrorKey = "actorId" | "entity" | "action" | "period" | "exportPeriodRequired" | "exportPeriodTooLong";
export type AuditFilterErrors = Partial<Record<"actorId" | "entity" | "action" | "from" | "to", AuditFilterErrorKey>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY = /^[a-z][a-z0-9_]*$/;
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*(\.\*)?$/;

/** Instant ISO UTC d'une saisie `datetime-local` ; `null` si vide ou invalide. */
export function toIsoInstant(local: string): string | null {
  if (!local.trim()) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function validateFilters(f: AuditFilterState): AuditFilterErrors {
  const errors: AuditFilterErrors = {};
  if (f.actorId.trim() && !UUID.test(f.actorId.trim())) errors.actorId = "actorId";
  if (f.entity.trim() && !ENTITY.test(f.entity.trim())) errors.entity = "entity";
  if (f.action.trim() && !ACTION.test(f.action.trim())) errors.action = "action";
  const from = toIsoInstant(f.from);
  const to = toIsoInstant(f.to);
  if (from && to && Date.parse(to) <= Date.parse(from)) errors.to = "period";
  return errors;
}

/** Paramètres de la liste. Les champs vides sont omis. */
export function toListQuery(f: AuditFilterState): QueryParams {
  const query: QueryParams = {};
  if (f.actorId.trim()) query.actorId = f.actorId.trim();
  if (f.entity.trim()) query.entity = f.entity.trim();
  if (f.entityId.trim()) query.entityId = f.entityId.trim();
  if (f.action.trim()) query.action = f.action.trim();
  if (f.severity.length > 0) query.severity = f.severity.join(",");
  const from = toIsoInstant(f.from);
  const to = toIsoInstant(f.to);
  if (from) query.from = from;
  if (to) query.to = to;
  return query;
}

/** L'export exige une période (<= 31 jours) : erreurs à afficher avant l'appel. */
export function validateExport(f: AuditFilterState): AuditFilterErrors {
  const errors = validateFilters(f);
  const from = toIsoInstant(f.from);
  const to = toIsoInstant(f.to);
  if (!from) errors.from = "exportPeriodRequired";
  if (!to) errors.to = "exportPeriodRequired";
  if (from && to && !errors.to && Date.parse(to) - Date.parse(from) > AUDIT_EXPORT_MAX_DAYS * 86_400_000) {
    errors.to = "exportPeriodTooLong";
  }
  return errors;
}

export function toExportQuery(f: AuditFilterState): QueryParams {
  return { ...toListQuery(f), limit: AUDIT_EXPORT_MAX_ROWS };
}

export function hasActiveFilters(f: AuditFilterState): boolean {
  return Object.keys(toListQuery(f)).length > 0;
}
