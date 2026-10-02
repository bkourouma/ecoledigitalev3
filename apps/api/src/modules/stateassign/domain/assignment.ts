/**
 * Règles PURES du dossier d'affectation : machine d'états (miroir de `stateassign.assignments_guard`, vérifié par un test de
 * parité contre la base), actes humains, normalisation de la référence, montants.
 *
 * Aucune règle officielle ici : le module ne décide pas de l'éligibilité d'un élève à une affectation. Il enregistre ce que
 * l'acte d'affectation déclare, le fait VÉRIFIER par un humain et suit la suite.
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import { ASSIGNMENT_STATUSES, LIVE_ASSIGNMENT_STATUSES } from "@ecoledigitale/contracts/src/v2/stateassign";
import type { AssignmentRecord, AssignmentStatus } from "./types";

/** Transitions permises (la base les impose : `RECEIVED → VERIFIED` n'existe que par un humain, etc.). */
export const ASSIGNMENT_TRANSITIONS: Readonly<Record<AssignmentStatus, readonly AssignmentStatus[]>> = Object.freeze({
  RECEIVED: ["VERIFIED", "REJECTED", "SUPERSEDED"],
  VERIFIED: ["ACTIVE", "REJECTED", "SUPERSEDED"],
  ACTIVE: ["SUSPENDED", "ENDED", "TRANSFERRED", "SUPERSEDED"],
  SUSPENDED: ["ACTIVE", "ENDED", "SUPERSEDED"],
  ENDED: [],
  REJECTED: [],
  TRANSFERRED: [],
  SUPERSEDED: [],
});

export const FINAL_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = Object.freeze(["ENDED", "REJECTED", "TRANSFERRED", "SUPERSEDED"]);

export const canTransitionAssignment = (from: AssignmentStatus, to: AssignmentStatus): boolean => ASSIGNMENT_TRANSITIONS[from].includes(to);

export const isLiveAssignment = (status: AssignmentStatus): boolean => (LIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status);

/** Contrôles et échéances ne se planifient que sur un dossier vérifié, actif ou suspendu. */
export const isOperationalAssignment = (status: AssignmentStatus): boolean => status === "VERIFIED" || status === "ACTIVE" || status === "SUSPENDED";

/**
 * Actes sur le cycle de vie : la cible, le motif exigé et l'événement publié. Tous sont HUMAINS (la base refuse un acteur
 * `system` ou `superAdmin`).
 */
export type AssignmentAct = "verify" | "reject" | "activate" | "suspend" | "resume" | "end" | "transfer-out";

export const ASSIGNMENT_ACTS: Readonly<Record<AssignmentAct, { readonly to: AssignmentStatus; readonly event: string; readonly sensitive: boolean }>> = Object.freeze({
  verify: { to: "VERIFIED", event: "stateassign.assignment.verified", sensitive: true },
  reject: { to: "REJECTED", event: "stateassign.assignment.rejected", sensitive: true },
  activate: { to: "ACTIVE", event: "stateassign.assignment.activated", sensitive: true },
  suspend: { to: "SUSPENDED", event: "stateassign.assignment.suspended", sensitive: true },
  resume: { to: "ACTIVE", event: "stateassign.assignment.resumed", sensitive: true },
  end: { to: "ENDED", event: "stateassign.assignment.ended", sensitive: true },
  "transfer-out": { to: "TRANSFERRED", event: "stateassign.assignment.transferred", sensitive: true },
});

/** L'acte demandé est-il permis depuis cet état ? (`resume` : SUSPENDED seulement ; `activate` : VERIFIED seulement.) */
export function actAllowedFrom(act: AssignmentAct, from: AssignmentStatus): boolean {
  if (act === "resume") return from === "SUSPENDED";
  if (act === "activate") return from === "VERIFIED";
  if (act === "reject") return from === "RECEIVED" || from === "VERIFIED";
  if (act === "end") return from === "ACTIVE" || from === "SUSPENDED";
  if (act === "transfer-out" || act === "suspend") return from === "ACTIVE";
  return canTransitionAssignment(from, ASSIGNMENT_ACTS[act].to);
}

/** Référence d'affectation : espaces extérieurs retirés, espaces internes réduits à un seul ; vide refusée. */
export function normalizeReference(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, " ");
  return v.length > 0 && v.length <= 120 ? v : null;
}

/** Texte libre optionnel : `null` si vide. */
export function normalizeText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0) return null;
  return v.length > max ? v.slice(0, max) : v;
}

/** Montant déclaré saisi (entier ≥ 0, unités mineures) -> `Money` ; `null`/absent -> `null`. Un flottant est refusé. */
export function declaredAmount(raw: number | null | undefined, currency: string): Money | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isSafeInteger(raw) || raw < 0) throw new RangeError("Un montant déclaré est un entier positif ou nul (unités mineures).");
  return Money.of(raw, currency as CurrencyCode);
}

/** Facturé = déclaré + écart (un montant déclaré absent compte pour 0, comme dans le calcul de l'écart). */
export function billedFrom(declared: Money | null, delta: Money | null, currency: string): Money | null {
  if (delta === null) return null;
  return (declared ?? Money.zero(currency as CurrencyCode)).add(delta);
}

/** Les champs de fond d'un dossier (figés dès la vérification : un changement passe par un avenant). */
export const FROZEN_FIELDS = ["reference", "issuedOn", "issuingAuthority", "declaredState", "declaredParent"] as const;

export function hasContentChange(
  current: Pick<AssignmentRecord, "reference" | "issuedOn" | "issuingAuthority" | "declaredState" | "declaredParent">,
  next: { reference?: string | undefined; issuedOn?: string | null | undefined; issuingAuthority?: string | null | undefined; declaredState?: Money | null | undefined; declaredParent?: Money | null | undefined },
): boolean {
  const sameMoney = (a: Money | null, b: Money | null): boolean => (a === null && b === null) || (a !== null && b !== null && a.amount === b.amount && a.currency === b.currency);
  if (next.reference !== undefined && next.reference !== current.reference) return true;
  if (next.issuedOn !== undefined && next.issuedOn !== current.issuedOn) return true;
  if (next.issuingAuthority !== undefined && next.issuingAuthority !== current.issuingAuthority) return true;
  if (next.declaredState !== undefined && !sameMoney(next.declaredState, current.declaredState)) return true;
  if (next.declaredParent !== undefined && !sameMoney(next.declaredParent, current.declaredParent)) return true;
  return false;
}

export const ALL_ASSIGNMENT_STATUSES = ASSIGNMENT_STATUSES;
