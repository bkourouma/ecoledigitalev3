/**
 * Règles pures du cycle de vie d'une séance (spec 017 R2, R3, US3, US5) :
 *
 *     PLANNED --constat--> HELD --validation--> HELD + validated_at
 *        \--> CANCELLED (depuis PLANNED, ou HELD non validée) ; CANCELLED --restauration--> PLANNED
 *
 * La VALIDATION est un attribut de HELD (acte de gestion distinct du constat pédagogique), pas un
 * état. La base impose les mêmes règles (déclencheurs de 0953) ; ces fonctions les évaluent AVANT
 * l'écriture pour renvoyer un motif précis plutôt qu'une erreur SQL.
 */
import type { Occurrence, OccurrenceStaff, OccurrenceStatus, StaffRole } from "./types";

export type Editability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "CANCELLED" | "VALIDATED" | "LOCKED"; readonly lockRef?: string };

/** Une séance validée ou aux heures verrouillées est GELÉE (horaire, statut, salle, intervenants). */
export function editability(
  occ: Pick<Occurrence, "status" | "validatedAt">,
  staff: readonly Pick<OccurrenceStaff, "lockedAt" | "lockRef">[],
  options: { allowCancelled?: boolean } = {},
): Editability {
  const locked = staff.find((s) => s.lockedAt !== null);
  if (locked) return { ok: false, reason: "LOCKED", ...(locked.lockRef ? { lockRef: locked.lockRef } : {}) };
  if (occ.validatedAt !== null) return { ok: false, reason: "VALIDATED" };
  if (occ.status === "CANCELLED" && !options.allowCancelled) return { ok: false, reason: "CANCELLED" };
  return { ok: true };
}

export type TransitionTarget = "HELD" | "UNHELD" | "CANCELLED" | "RESTORED";

/** Statut d'arrivée si la transition est légale, sinon `null`. */
export function nextStatus(from: OccurrenceStatus, action: TransitionTarget): OccurrenceStatus | null {
  switch (action) {
    case "HELD":
      return from === "PLANNED" ? "HELD" : null;
    case "UNHELD":
      return from === "HELD" ? "PLANNED" : null;
    case "CANCELLED":
      return from === "PLANNED" || from === "HELD" ? "CANCELLED" : null;
    case "RESTORED":
      return from === "CANCELLED" ? "PLANNED" : null;
  }
}

/** Rôle rémunéré par défaut ; `supervisorsPaid` vient des paramètres de l'établissement (question O-06). */
export function defaultPaidRole(role: StaffRole, supervisorsPaid: boolean): boolean {
  return role === "SUPERVISOR" ? supervisorsPaid : true;
}

export type ValidationBlocker = "NOT_HELD" | "CANCELLED" | "NO_PAID_STAFF" | "SELF_VALIDATION";

export const VALIDATION_BLOCKER_MESSAGES: Readonly<Record<ValidationBlocker | "LOCKED" | "NOT_FOUND", string>> = Object.freeze({
  NOT_HELD: "La séance n'est pas constatée comme réalisée.",
  CANCELLED: "La séance est annulée.",
  NO_PAID_STAFF: "Aucun intervenant rémunéré : la séance n'est pas payable.",
  SELF_VALIDATION: "Validation à quatre yeux : le créateur d'une séance comptable ne peut pas la valider.",
  LOCKED: "Des heures sont verrouillées par la paie.",
  NOT_FOUND: "Séance introuvable.",
});

/**
 * Une séance est validable si elle est HELD, non annulée, avec au moins un intervenant de rôle rémunéré
 * (durée toujours connue : `ends_at > starts_at`). Retourne le premier obstacle.
 */
export function validationBlocker(
  occ: Pick<Occurrence, "status" | "origin" | "createdBy">,
  staff: readonly Pick<OccurrenceStaff, "isPaidRole">[],
  options: { actorId: string | null; allowSelfValidation: boolean },
): ValidationBlocker | null {
  if (occ.status === "CANCELLED") return "CANCELLED";
  if (occ.status !== "HELD") return "NOT_HELD";
  if (!staff.some((s) => s.isPaidRole)) return "NO_PAID_STAFF";
  if (occ.origin === "ACCOUNTING" && !options.allowSelfValidation && occ.createdBy !== null && occ.createdBy === options.actorId) return "SELF_VALIDATION";
  return null;
}

/** Minutes entières d'une séance (durée planifiée). */
export function occurrenceMinutes(startsAt: Date, endsAt: Date): number {
  return Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
}

/** Durée payée d'une ligne : la dérogation prime, sinon la durée de la séance (spec 017 AC5.4). */
export function paidMinutesOf(occ: Pick<Occurrence, "startsAt" | "endsAt">, staff: Pick<OccurrenceStaff, "paidMinutes">): number {
  return staff.paidMinutes ?? occurrenceMinutes(occ.startsAt, occ.endsAt);
}

/**
 * Prédicat de payabilité de la spec 017 (§AC5.4) : séance HELD ∧ validée ∧ intervenant de rôle rémunéré.
 * Miroir TypeScript de `scheduling.payable_hours` (la base fait foi pour la paie ; ce miroir sert aux
 * tests de parité et aux vérifications avant verrouillage).
 */
export function isPayable(occ: Pick<Occurrence, "status" | "validatedAt">, staff: Pick<OccurrenceStaff, "isPaidRole">): boolean {
  return occ.status === "HELD" && occ.validatedAt !== null && staff.isPaidRole;
}

/** Contrôle la durée payée : entier de 1 à 1440 (une journée), garde-fou technique et non plafond de paie. */
export function isValidPaidMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 1440;
}
