/**
 * Règles PURES de l'évaluation par compétences. AUCUNE moyenne, AUCUN seuil : on COMPTE des niveaux de maîtrise.
 * `summarizeCompetencies` est le jumeau TypeScript de la fonction SQL `primary_school.summarize_competencies` (test de parité).
 */
import type { Phrase, RatingLevel } from "./types";

export interface SummaryRow {
  domainCode: string;
  levelCode: string;
  status: "DRAFT" | "VALIDATED";
}

/** `{ domaine: { niveau: n } }` sur les seules lignes VALIDÉES. */
export function summarizeCompetencies(rows: readonly SummaryRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (r.status !== "VALIDATED") continue;
    const domain = (out[r.domainCode] ??= {});
    domain[r.levelCode] = (domain[r.levelCode] ?? 0) + 1;
  }
  return out;
}

/** Vérifie les niveaux d'une échelle : codes et ordinaux uniques, au moins deux niveaux. Renvoie le premier défaut ou `null`. */
export function validateLevels(levels: ReadonlyArray<Pick<RatingLevel, "code" | "ordinal">>): string | null {
  if (levels.length < 2) return "Une échelle compte au moins deux niveaux.";
  const codes = new Set<string>();
  const ordinals = new Set<number>();
  for (const l of levels) {
    if (codes.has(l.code)) return `Code de niveau en double : ${l.code}.`;
    if (ordinals.has(l.ordinal)) return `Ordinal en double : ${l.ordinal}.`;
    codes.add(l.code);
    ordinals.add(l.ordinal);
  }
  return null;
}

export type BulkOutcome = "create" | "update" | "unchanged" | "row_version_conflict" | "frozen";

export interface ExistingLine {
  ratingLevelId: string;
  note: string | null;
  observedOn: string;
  status: "DRAFT" | "VALIDATED";
  rowVersion: number;
}

export interface IncomingLine {
  ratingLevelId: string;
  note: string | null;
  observedOn: string | null;
  rowVersion: number | undefined;
}

/**
 * Décide du sort d'une ligne d'un lot (saisie idempotente) :
 *  - aucune ligne existante -> `create` ;
 *  - valeur identique -> `unchanged` (rejouer un lot ne change rien) ;
 *  - ligne VALIDÉE différente -> `frozen` (seule une révision tracée la corrige) ;
 *  - ligne en brouillon différente -> `update` si `rowVersion` correspond, sinon `row_version_conflict`.
 */
export function decideBulkLine(existing: ExistingLine | undefined, incoming: IncomingLine): BulkOutcome {
  if (!existing) return "create";
  const sameLevel = existing.ratingLevelId === incoming.ratingLevelId;
  const sameNote = (existing.note ?? null) === (incoming.note ?? null);
  const sameDate = incoming.observedOn === null || existing.observedOn === incoming.observedOn;
  if (sameLevel && sameNote && sameDate) return "unchanged";
  if (existing.status === "VALIDATED") return "frozen";
  if (incoming.rowVersion === undefined || incoming.rowVersion !== existing.rowVersion) return "row_version_conflict";
  return "update";
}

export interface CompletenessInput {
  /** Identifiants des compétences attendues (référentiel de la grille). */
  competencyIds: readonly string[];
  enrollmentIds: readonly string[];
  assessments: ReadonlyArray<{ enrollmentId: string; competencyId: string; status: "DRAFT" | "VALIDATED" }>;
}

export interface Completeness {
  expected: number;
  recorded: number;
  validated: number;
  byEnrollment: Array<{ enrollmentId: string; recorded: number; validated: number }>;
}

/** Complétude de la grille : lignes attendues = élèves × compétences ; une compétence non saisie reste « non évaluée » (jamais 0). */
export function completenessOf(input: CompletenessInput): Completeness {
  const competencies = new Set(input.competencyIds);
  const enrollments = new Set(input.enrollmentIds);
  const per = new Map<string, { recorded: number; validated: number }>(input.enrollmentIds.map((e) => [e, { recorded: 0, validated: 0 }]));
  let recorded = 0;
  let validated = 0;
  for (const a of input.assessments) {
    if (!competencies.has(a.competencyId) || !enrollments.has(a.enrollmentId)) continue;
    const slot = per.get(a.enrollmentId) as { recorded: number; validated: number };
    slot.recorded += 1;
    recorded += 1;
    if (a.status === "VALIDATED") {
      slot.validated += 1;
      validated += 1;
    }
  }
  return {
    expected: competencies.size * enrollments.size,
    recorded,
    validated,
    byEnrollment: input.enrollmentIds.map((enrollmentId) => ({ enrollmentId, ...(per.get(enrollmentId) as { recorded: number; validated: number }) })),
  };
}

export interface PhraseFilter {
  scope?: Phrase["scope"] | undefined;
  ratingLevelCode?: string | undefined;
  gradeLevelCode?: string | undefined;
  includeInactive?: boolean | undefined;
}

/**
 * Filtre la banque d'appréciations : une phrase sans niveau de maîtrise (ou sans niveau de classe) convient à tous ; avec un
 * niveau, elle ne convient qu'à celui-ci. Une phrase inactive n'est proposée que sur demande. Le texte n'est JAMAIS appliqué
 * seul : l'instituteur le valide.
 */
export function filterPhrases(phrases: readonly Phrase[], f: PhraseFilter): Phrase[] {
  return phrases.filter((p) => {
    if (!f.includeInactive && !p.active) return false;
    if (f.scope && p.scope !== f.scope) return false;
    if (f.ratingLevelCode && p.ratingLevelCode !== null && p.ratingLevelCode !== f.ratingLevelCode) return false;
    if (f.gradeLevelCode && p.gradeLevelCode !== null && p.gradeLevelCode !== f.gradeLevelCode) return false;
    return true;
  });
}

/** Une phrase `placeholder` est étiquetée comme telle dans l'interface. */
export const isPlaceholderPhrase = (p: Pick<Phrase, "sourceKind">): boolean => p.sourceKind === "placeholder";
