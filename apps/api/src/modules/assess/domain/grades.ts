/**
 * Saisie des notes : normalisation et plan d'écriture d'un lot, en logique PURE (aucun accès base).
 *
 *  - Seul `ENTERED` porte un score ; absence justifiée / injustifiée, dispense et « non évalué » n'en portent pas
 *    (`score = null`) : une absence N'EST PAS un zéro, c'est la règle de calcul qui décide (Q-10).
 *  - `0 ≤ score ≤ barème`, à 3 décimales au plus (et au plus `maxScoreDecimals` pour le tenant). Jamais d'arrondi.
 *  - Lot IDEMPOTENT : une ligne dont la valeur est déjà celle demandée n'écrit rien (rejouer un lot ne change rien) ;
 *    une ligne existante dont la valeur diffère exige la `rowVersion` lue par le client (sinon 409 `assess.stale_grade`) :
 *    jamais d'écrasement silencieux entre deux enseignants.
 */
import { createHash } from "node:crypto";
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { canonical, compareDecimal, equalDecimal, isDecimalString, significantDecimals } from "./decimal";
import { AssessCode, validation } from "./errors";
import type { AssessEntryStatus, Grade } from "./types";

export interface EntryInput {
  readonly enrollmentId: string;
  readonly score?: string | null | undefined;
  readonly entryStatus?: AssessEntryStatus | undefined;
  readonly comment?: string | null | undefined;
  readonly rowVersion?: number | undefined;
}

export interface NormalizedEntry {
  readonly enrollmentId: string;
  readonly entryStatus: AssessEntryStatus;
  /** Chaîne canonique à 3 décimales, ou `null`. */
  readonly score: string | null;
  readonly comment: string | null;
  readonly rowVersion: number | undefined;
}

export function normalizeEntry(input: EntryInput, scaleMax: string, maxDecimals: number): Result<NormalizedEntry, AppError> {
  const hasScore = input.score !== undefined && input.score !== null;
  const status: AssessEntryStatus = input.entryStatus ?? (hasScore ? "ENTERED" : "NOT_GRADED");
  const field = (name: string) => `entries.${input.enrollmentId}.${name}`;

  if (status === "ENTERED") {
    if (!hasScore) return err(validation(AssessCode.INVALID_ENTRY, "Une note saisie exige une valeur.", field("score")));
    const raw = String(input.score).trim();
    if (!isDecimalString(raw)) return err(validation(AssessCode.INVALID_ENTRY, `Note invalide « ${raw} » : valeur décimale positive attendue.`, field("score")));
    if (significantDecimals(raw) > maxDecimals) {
      return err(validation(AssessCode.SCORE_PRECISION, `Une note a ${maxDecimals} décimale(s) au plus dans cet établissement.`, field("score")));
    }
    if (compareDecimal(raw, scaleMax) > 0) {
      return err(validation(AssessCode.SCORE_OUT_OF_SCALE, `La note ${raw} dépasse le barème (${canonical(scaleMax)}).`, field("score")));
    }
    return ok({ enrollmentId: input.enrollmentId, entryStatus: status, score: canonical(raw), comment: cleanComment(input.comment), rowVersion: input.rowVersion });
  }
  if (hasScore) return err(validation(AssessCode.INVALID_ENTRY, "Seul l'état « noté » porte une valeur : une absence n'est pas un zéro.", field("score")));
  return ok({ enrollmentId: input.enrollmentId, entryStatus: status, score: null, comment: cleanComment(input.comment), rowVersion: input.rowVersion });
}

function cleanComment(c: string | null | undefined): string | null {
  const t = c?.trim();
  return t ? t : null;
}

export type EntryAction = "create" | "update" | "unchanged" | "stale";

export interface PlannedEntry {
  readonly entry: NormalizedEntry;
  readonly action: EntryAction;
  readonly existing: Grade | null;
}

export function sameValue(entry: Pick<NormalizedEntry, "score" | "entryStatus" | "comment">, grade: Pick<Grade, "score" | "entryStatus" | "comment">): boolean {
  return entry.entryStatus === grade.entryStatus && equalDecimal(entry.score, grade.score) && (entry.comment ?? null) === (grade.comment ?? null);
}

export function planSave(entries: readonly NormalizedEntry[], existingByEnrollment: ReadonlyMap<string, Grade>): PlannedEntry[] {
  return entries.map((entry) => {
    const existing = existingByEnrollment.get(entry.enrollmentId) ?? null;
    if (!existing) return { entry, action: "create", existing: null };
    if (sameValue(entry, existing)) return { entry, action: "unchanged", existing };
    if (entry.rowVersion === undefined || entry.rowVersion !== existing.rowVersion) return { entry, action: "stale", existing };
    return { entry, action: "update", existing };
  });
}

/** Empreinte stable d'un lot (clé d'idempotence rejouée avec un AUTRE contenu = conflit). */
export function payloadHash(entries: readonly NormalizedEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.enrollmentId < b.enrollmentId ? -1 : a.enrollmentId > b.enrollmentId ? 1 : 0));
  const body = sorted.map((e) => [e.enrollmentId, e.entryStatus, e.score, e.comment, e.rowVersion ?? null]);
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
