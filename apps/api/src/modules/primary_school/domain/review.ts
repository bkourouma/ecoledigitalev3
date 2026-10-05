/**
 * Bilan annuel : instantané canonique, empreinte et conditions de scellement (fonctions PURES).
 *
 * Le bilan ne calcule RIEN : il rassemble des résultats déjà calculés par `results` (résultat d'année FINAL, décision confirmée),
 * la synthèse de compétences (compteurs) et l'assiduité. Son empreinte (SHA-256 de la forme canonique) est stockée au scellement ;
 * la ligne devient alors immuable (déclencheur SQL `annual_reviews_guard`).
 */
import { createHash } from "node:crypto";
import type { AnnualReview, YearArchive } from "./types";

/** JSON canonique : clés triées, pas d'espaces, `undefined` ignoré ; les dates sont écrites en ISO 8601 UTC. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new TypeError(`Valeur non sérialisable : ${typeof value}`);
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Nombre de JOURNÉES d'assiduité tel qu'il est figé dans le bilan. Avec l'appel du matin et de l'après-midi (décision Q-P17), une
 * demi-journée vaut 0,5 : une valeur entière reste un nombre (bilans historiques inchangés), une valeur à demi-journée s'écrit en CHAÎNE
 * décimale exacte (« 2.5 »), comme partout dans les instantanés canoniques (les flottants y sont interdits).
 */
export function dayCount(days: number | null): number | string | null {
  if (days === null) return null;
  return Number.isInteger(days) ? days : days.toFixed(1);
}

/** « 2,5 » (virgule française) pour un nombre de journées figé par `dayCount`. */
const frDays = (v: unknown): string => String(v).replace(".", ",");

/** Phrase d'assiduité du bilan (affichage seulement : aucun seuil, aucun calcul) ; `null` quand le récapitulatif est illisible. */
export function attendanceText(summary: Record<string, unknown>): string | null {
  const { openDays, absentDays, justifiedAbsentDays, lateCount } = summary;
  if (openDays == null || absentDays == null) return null;
  const parts = [`${frDays(absentDays)} journée(s) d'absence sur ${frDays(openDays)} journée(s) d'appel`];
  if (justifiedAbsentDays != null) parts.push(`dont ${frDays(justifiedAbsentDays)} justifiée(s)`);
  if (lateCount != null) parts.push(`${frDays(lateCount)} journée(s) de retard`);
  return parts.join(", ");
}

/** Contenu figé et haché d'un bilan (tout ce qui s'affiche sur le document, sauf l'identifiant du PDF). */
export interface ReviewSnapshot {
  schema: 1;
  institutionId: string;
  academicYearId: string;
  enrollmentId: string;
  studentId: string;
  classroomId: string;
  gradeLevelCode: string;
  version: number;
  yearResultRef: string | null;
  decisionRef: string | null;
  outcomeCode: string | null;
  competencySummary: Record<string, Record<string, number>>;
  attendanceSummary: Record<string, unknown>;
  ruleVersionRef: string | null;
}

export function snapshotOf(r: Pick<AnnualReview, "institutionId" | "academicYearId" | "enrollmentId" | "studentId" | "classroomId" | "gradeLevelCode" | "version" | "yearResultRef" | "decisionRef" | "outcomeCode" | "competencySummary" | "attendanceSummary" | "ruleVersionRef">): ReviewSnapshot {
  return {
    schema: 1,
    institutionId: r.institutionId,
    academicYearId: r.academicYearId,
    enrollmentId: r.enrollmentId,
    studentId: r.studentId,
    classroomId: r.classroomId,
    gradeLevelCode: r.gradeLevelCode,
    version: r.version,
    yearResultRef: r.yearResultRef,
    decisionRef: r.decisionRef,
    outcomeCode: r.outcomeCode,
    competencySummary: r.competencySummary,
    attendanceSummary: r.attendanceSummary,
    ruleVersionRef: r.ruleVersionRef,
  };
}

export const reviewHash = (r: Parameters<typeof snapshotOf>[0]): string => sha256Hex(canonicalJson(snapshotOf(r)));

export interface SealBlocker {
  code: "primary_school.review_needs_results" | "primary_school.review_needs_decision" | "primary_school.review_periods_open";
  message: string;
}

/**
 * Manques empêchant le scellement (liste vide = scellable). Le scellement exige : toutes les périodes de l'année clôturées, un résultat
 * d'année FINAL, et — si l'établissement l'exige — la décision confirmée du conseil.
 */
export function sealBlockers(
  r: Pick<AnnualReview, "yearResultRef" | "decisionRef" | "outcomeCode">,
  opts: { councilRequired: boolean; allPeriodsClosed: boolean },
): SealBlocker[] {
  const out: SealBlocker[] = [];
  if (!opts.allPeriodsClosed) out.push({ code: "primary_school.review_periods_open", message: "Toutes les périodes de l'année ne sont pas clôturées." });
  if (r.yearResultRef === null) out.push({ code: "primary_school.review_needs_results", message: "Le résultat d'année FINAL n'est pas disponible." });
  if (opts.councilRequired && (r.decisionRef === null || r.outcomeCode === null)) {
    out.push({ code: "primary_school.review_needs_decision", message: "La décision du conseil des maîtres n'est pas confirmée." });
  }
  return out;
}

/** Manifeste d'archive : effectifs par classe et empreintes des bilans vivants (ordre déterministe). */
export interface ArchiveManifest {
  schema: 1;
  institutionId: string;
  academicYearId: string;
  reviews: Array<{ reviewId: string; enrollmentId: string; classroomId: string; version: number; contentHash: string }>;
  classrooms: Array<{ classroomId: string; reviews: number }>;
}

export function buildManifest(input: { institutionId: string; academicYearId: string; sealed: ReadonlyArray<Pick<AnnualReview, "id" | "enrollmentId" | "classroomId" | "version" | "contentHash">> }): ArchiveManifest {
  const reviews = input.sealed
    .filter((r): r is typeof r & { contentHash: string } => r.contentHash !== null)
    .map((r) => ({ reviewId: r.id, enrollmentId: r.enrollmentId, classroomId: r.classroomId, version: r.version, contentHash: r.contentHash }))
    .sort((a, b) => (a.enrollmentId < b.enrollmentId ? -1 : a.enrollmentId > b.enrollmentId ? 1 : a.version - b.version));
  const perClass = new Map<string, number>();
  for (const r of reviews) perClass.set(r.classroomId, (perClass.get(r.classroomId) ?? 0) + 1);
  const classrooms = [...perClass].map(([classroomId, n]) => ({ classroomId, reviews: n })).sort((a, b) => (a.classroomId < b.classroomId ? -1 : 1));
  return { schema: 1, institutionId: input.institutionId, academicYearId: input.academicYearId, reviews, classrooms };
}

export const manifestHash = (m: ArchiveManifest): string => sha256Hex(canonicalJson(m));

/** `READY` exige que 100 % des bilans comptés soient scellés. */
export function archiveBlockers(a: Pick<YearArchive, "reviewsTotal" | "reviewsSealed">, yearClosed: boolean): Array<{ code: string; message: string }> {
  const out: Array<{ code: string; message: string }> = [];
  if (!yearClosed) out.push({ code: "primary_school.archive_year_not_closed", message: "L'année académique n'est pas clôturée." });
  if (a.reviewsTotal === 0) out.push({ code: "primary_school.archive_not_ready", message: "Aucun bilan à archiver." });
  if (a.reviewsSealed < a.reviewsTotal) out.push({ code: "primary_school.archive_not_ready", message: `${a.reviewsTotal - a.reviewsSealed} bilan(s) non scellé(s).` });
  return out;
}
