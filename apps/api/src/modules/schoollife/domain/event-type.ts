/**
 * Cohérence d'un type d'événement (miroir des CHECK de `schoollife.event_types`). La base reste l'autorité ; ce contrôle
 * donne des messages clairs avant l'aller-retour SQL. Le TYPE (donnée) porte le circuit : validation, quatre yeux, recours,
 * partage aux familles, confidentialité plancher, dates.
 */
import type { SchoolLifeEventTypeInput } from "@ecoledigitale/contracts/src/v2/schoollife";

export interface TypeFlags {
  readonly kind: SchoolLifeEventTypeInput["kind"];
  readonly requiresValidation: boolean;
  readonly requiresFourEyes: boolean;
  readonly requiresDates: boolean;
  readonly appealable: boolean;
}

export interface TypeIssue {
  readonly field: string;
  readonly message: string;
}

export function validateTypeFlags(t: TypeFlags): TypeIssue[] {
  const issues: TypeIssue[] = [];
  if (t.requiresDates !== (t.kind === "TEMP_EXCLUSION")) issues.push({ field: "requiresDates", message: "Les dates de début et de fin sont exigées pour une exclusion temporaire, et pour elle seule." });
  if (t.requiresFourEyes && !t.requiresValidation) issues.push({ field: "requiresFourEyes", message: "La séparation des tâches suppose une validation." });
  if (t.kind === "TEMP_EXCLUSION" && !t.requiresValidation) issues.push({ field: "requiresValidation", message: "Une exclusion temporaire exige toujours une validation." });
  if ((t.kind === "INCIDENT" || t.kind === "ENCOURAGEMENT" || t.kind === "OBSERVATION") && (t.requiresValidation || t.appealable)) {
    issues.push({ field: "requiresValidation", message: "Un incident, un encouragement ou une observation n'a ni validation ni recours." });
  }
  if (t.kind !== "SANCTION" && t.kind !== "TEMP_EXCLUSION" && t.appealable) issues.push({ field: "appealable", message: "Seules une sanction et une exclusion temporaire sont susceptibles de recours." });
  return issues;
}

export const MEASURE_KINDS = ["SANCTION", "WARNING", "TEMP_EXCLUSION"] as const;
export const NOTE_KINDS = ["ENCOURAGEMENT", "OBSERVATION"] as const;
export const isMeasureKind = (k: string): k is (typeof MEASURE_KINDS)[number] => (MEASURE_KINDS as readonly string[]).includes(k);
export const isNoteKind = (k: string): k is (typeof NOTE_KINDS)[number] => (NOTE_KINDS as readonly string[]).includes(k);
