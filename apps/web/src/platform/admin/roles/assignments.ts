/**
 * Attributions de rôles : statut de validité, périmètre, validation du formulaire (fonctions pures, testées).
 */

import type { RbacAssignment, RbacCreateAssignmentBody, RbacScope } from "@ecoledigitale/contracts/v2/rbac";
import { toIsoInstant } from "../audit/filters";

export type ValidityStatus = "active" | "upcoming" | "expired";

/** Statut d'une attribution à l'instant `now` (`valid_from <= now < valid_until`, bornes absentes = illimité). */
export function validityStatus(a: Pick<RbacAssignment, "validFrom" | "validUntil">, now: Date): ValidityStatus {
  const t = now.getTime();
  if (a.validFrom && Date.parse(a.validFrom) > t) return "upcoming";
  if (a.validUntil && Date.parse(a.validUntil) <= t) return "expired";
  return "active";
}

export type ScopeType = RbacScope["type"];

export function buildScope(type: ScopeType, institutionId: string, campusId: string): RbacScope | null {
  if (type === "tenant") return { type: "tenant" };
  if (type === "institution") return institutionId ? { type: "institution", id: institutionId } : null;
  return campusId ? { type: "campus", id: campusId } : null;
}

export interface AssignmentFormState {
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  institutionId: string;
  campusId: string;
  validFrom: string;
  validUntil: string;
}

export const EMPTY_ASSIGNMENT_FORM: AssignmentFormState = {
  userId: "",
  roleId: "",
  scopeType: "tenant",
  institutionId: "",
  campusId: "",
  validFrom: "",
  validUntil: "",
};

export type AssignmentFormErrorKey = "user" | "userInvalid" | "role" | "institution" | "campus" | "period";
export type AssignmentFormErrors = Partial<Record<"userId" | "roleId" | "institutionId" | "campusId" | "validUntil", AssignmentFormErrorKey>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAssignmentForm(f: AssignmentFormState): AssignmentFormErrors {
  const errors: AssignmentFormErrors = {};
  if (!f.userId.trim()) errors.userId = "user";
  else if (!UUID.test(f.userId.trim())) errors.userId = "userInvalid";
  if (!f.roleId) errors.roleId = "role";
  if (f.scopeType === "institution" && !f.institutionId) errors.institutionId = "institution";
  if (f.scopeType === "campus") {
    if (!f.institutionId) errors.institutionId = "institution";
    if (!f.campusId) errors.campusId = "campus";
  }
  const from = toIsoInstant(f.validFrom);
  const until = toIsoInstant(f.validUntil);
  if (from && until && Date.parse(until) <= Date.parse(from)) errors.validUntil = "period";
  return errors;
}

/** Corps de `POST /rbac/assignments` (le périmètre et les dates sont déjà validés) ; `null` si le formulaire est invalide. */
export function toCreateBody(f: AssignmentFormState): RbacCreateAssignmentBody | null {
  const scope = buildScope(f.scopeType, f.institutionId, f.campusId);
  if (!scope || !f.userId.trim() || !f.roleId) return null;
  const from = toIsoInstant(f.validFrom);
  const until = toIsoInstant(f.validUntil);
  return {
    userId: f.userId.trim(),
    roleId: f.roleId,
    scope,
    ...(from ? { validFrom: from } : {}),
    ...(until ? { validUntil: until } : {}),
  };
}

/** `datetime-local` (heure locale) depuis un instant ISO, pour préremplir une modification. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
