import {
  academicRolloverAnomalySchema,
  academicRolloverWarningSchema,
  type AcademicRolloverPreviewDto,
  type AcademicRolloverRunDto,
  type AcademicRolloverWarning,
} from "@ecoledigitale/contracts/v2/academic";
import type { Tone } from "@/platform/ui/PageHeader";

export type RolloverWarningCode = AcademicRolloverWarning["code"];
export type RolloverAnomaly = AcademicRolloverPreviewDto["anomalies"][number];
export type RolloverAnomalyCode = RolloverAnomaly["code"];

/** Codes d'avertissement et d'anomalie connus du contrat (sert à la liste exhaustive des libellés). */
export const WARNING_CODES: ReadonlyArray<RolloverWarningCode> = academicRolloverWarningSchema.shape.code.options;
export const ANOMALY_CODES: ReadonlyArray<RolloverAnomalyCode> = academicRolloverAnomalySchema.shape.code.options;

/** Écran où l'on corrige la cause d'un avertissement (`null` : rien à corriger depuis l'écran). Affordance de navigation seulement. */
export const WARNING_LINKS: Readonly<Record<RolloverWarningCode, string | null>> = {
  target_year_has_periods: "/v2/academic/years",
  target_year_has_classrooms: "/v2/academic/classrooms",
  target_year_has_curriculum: "/v2/academic/curriculum",
  target_year_not_empty: "/v2/academic/years",
  periods_dates_clamped: "/v2/academic/years",
  periods_source_missing: "/v2/academic/years",
  holidays_not_recurring: "/v2/academic/settings?tab=calendar",
  curriculum_source_missing: "/v2/academic/curriculum",
  curriculum_source_draft: "/v2/academic/curriculum",
  classrooms_source_missing: "/v2/academic/classrooms",
  offerings_need_curriculum: "/v2/academic/curriculum",
  offerings_feature_disabled: null,
  promotion_decisions_missing: "/v2/results/decisions",
  conflict: null,
  item_failed: null,
};

/** Lien vers l'inscription ou la classe concernée par une anomalie. */
export function anomalyHref(a: Pick<RolloverAnomaly, "enrollmentId" | "classroomId">): string | null {
  if (a.enrollmentId) return `/v2/enrollments/${a.enrollmentId}`;
  if (a.classroomId) return `/v2/academic/classrooms/${a.classroomId}`;
  return null;
}

export function runTone(status: AcademicRolloverRunDto["status"]): Tone {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "FAILED":
      return "danger";
    case "RUNNING":
      return "info";
    default:
      return "warning";
  }
}

export function stepTone(status: string): Tone {
  switch (status) {
    case "DONE":
      return "success";
    case "FAILED":
      return "danger";
    case "RUNNING":
      return "info";
    case "SKIPPED":
      return "neutral";
    default:
      return "warning";
  }
}

/** Nombre de lignes d'une liste d'aperçu affichées avant « et N autres » (affichage seulement). */
export const PREVIEW_LIMIT = 30;

export function capped<T>(rows: ReadonlyArray<T>, limit = PREVIEW_LIMIT): { shown: T[]; more: number } {
  return { shown: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
}
