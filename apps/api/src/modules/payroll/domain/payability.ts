/**
 * PRÉDICAT DE PAYABILITÉ — défini ICI, et nulle part ailleurs (spec 032 AC1.2, R-PAY-03).
 *
 *     payable  :=  réalisée  ∧  validée  ∧  enseignant ≠ null  ∧  durée retenue déterminable
 *     minutes  :=  dérogation  ??  durée explicite (présence)  ??  (fin − début)
 *
 * Tout ce qui décide « cette heure se paie-t-elle ? » — collecteurs, calcul, compteurs, doublures de test —
 * passe par `isPayable` / `toPayable`. Le test d'architecture `test/unit/architecture.test.ts` interdit toute
 * autre définition (même forme de condition recopiée dans un autre fichier du module).
 *
 * Une durée valide est un ENTIER de minutes de 1 à 1 440 (une journée) : une dérogation hors de cette plage,
 * ou une plage horaire inversée, rend l'heure non payable (jamais un montant négatif ou énorme par accident).
 */
import { isIsoDate, timeToMinutes } from "./calendar";
import type { HourFact, PayableHour } from "./types";

export const MIN_PAID_MINUTES = 1;
export const MAX_PAID_MINUTES = 1440;

export type PayabilityBlocker = "NOT_REALIZED" | "NOT_VALIDATED" | "NO_STAFF" | "NO_DURATION" | "INVALID_DATE";

/** Libellés des motifs (alignés sur les motifs du legacy : STATUT_NON_REALISEE, SANS_ENSEIGNANT, HORAIRES_INCOMPLETS). */
export const PAYABILITY_BLOCKER_MESSAGES: Readonly<Record<PayabilityBlocker, string>> = Object.freeze({
  NOT_REALIZED: "L'heure n'est pas constatée comme réalisée.",
  NOT_VALIDATED: "L'heure n'est pas validée par la gestion.",
  NO_STAFF: "Aucun enseignant n'est rattaché à l'heure.",
  NO_DURATION: "La durée de l'heure est indéterminable.",
  INVALID_DATE: "La date de l'heure est invalide.",
});

const validMinutes = (n: number | null | undefined): n is number => n != null && Number.isInteger(n) && n >= MIN_PAID_MINUTES && n <= MAX_PAID_MINUTES;

type DurationInputs = Pick<HourFact, "paidMinutesOverride" | "durationMinutes" | "startTime" | "endTime">;

/** Durée retenue en minutes, ou `null` si elle ne peut pas être déterminée. */
export function retainedMinutes(f: DurationInputs): number | null {
  if (f.paidMinutesOverride != null) return validMinutes(f.paidMinutesOverride) ? f.paidMinutesOverride : null;
  if (f.durationMinutes != null) return validMinutes(f.durationMinutes) ? f.durationMinutes : null;
  const start = timeToMinutes(f.startTime);
  const end = timeToMinutes(f.endTime);
  if (start === null || end === null) return null;
  const span = end - start;
  return validMinutes(span) ? span : null;
}

export function payabilityBlockers(f: HourFact): PayabilityBlocker[] {
  const blockers: PayabilityBlocker[] = [];
  if (!f.realized) blockers.push("NOT_REALIZED");
  if (!f.validated) blockers.push("NOT_VALIDATED");
  if (f.staffId == null || f.staffId === "") blockers.push("NO_STAFF");
  if (retainedMinutes(f) === null) blockers.push("NO_DURATION");
  if (!isIsoDate(f.date)) blockers.push("INVALID_DATE");
  return blockers;
}

export function isPayable(f: HourFact): boolean {
  return payabilityBlockers(f).length === 0;
}

/** L'heure payable (durée retenue calculée) ou `null`. */
export function toPayable(f: HourFact): PayableHour | null {
  if (!isPayable(f)) return null;
  return {
    kind: f.kind,
    refId: f.refId,
    staffId: f.staffId as string,
    date: f.date,
    startTime: f.startTime,
    minutes: retainedMinutes(f) as number,
    nodeId: f.nodeId,
    classroomId: f.classroomId,
    label: f.label,
    code: f.code,
    classroomLabel: f.classroomLabel,
  };
}

/** Clé d'unicité d'une heure payée : (origine, identifiant de la source, enseignant) — celle de `hour_claims`. */
export const hourKey = (h: { kind: string; refId: string; staffId: string }): string => `${h.kind}|${h.refId}|${h.staffId}`;

export interface RejectedHour {
  readonly fact: HourFact;
  readonly blockers: readonly PayabilityBlocker[];
}

export interface CollectedHours {
  readonly payable: PayableHour[];
  readonly rejected: RejectedHour[];
}

/**
 * Filtre des faits d'un port : retient les heures payables de `[from, to]` (et des enseignants demandés),
 * sans doublon (même clé d'unicité : la première occurrence l'emporte).
 */
export function collectPayable(facts: readonly HourFact[], window: { from: string; to: string; staffIds?: ReadonlySet<string> | null }): CollectedHours {
  const payable: PayableHour[] = [];
  const rejected: RejectedHour[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    if (fact.date < window.from || fact.date > window.to) continue; // R-PAY-14 : la date de la séance, aucun prorata
    if (window.staffIds && (fact.staffId === null || !window.staffIds.has(fact.staffId))) continue;
    const blockers = payabilityBlockers(fact);
    if (blockers.length > 0) {
      rejected.push({ fact, blockers });
      continue;
    }
    const p = toPayable(fact) as PayableHour;
    const key = hourKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    payable.push(p);
  }
  return { payable, rejected };
}
