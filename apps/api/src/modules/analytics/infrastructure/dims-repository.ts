/**
 * Lecture des dimensions déjà matérialisées (années, périodes, périmètres, classes) : sert aux filtres de l'API et à
 * l'énumération des périmètres de rafraîchissement. Lit UNIQUEMENT le schéma `analytics`.
 */
import type { Tx } from "@ecoledigitale/database";
import type { ScopeFact } from "../domain/types";

export interface YearDim {
  id: string;
  institutionId: string;
  code: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: string;
  isCurrent: boolean;
}

export interface PeriodDim {
  id: string;
  yearId: string;
  code: string;
  label: string;
  ordinal: number;
  startsOn: string;
  endsOn: string;
  status: string;
}

export interface ClassroomDim {
  id: string;
  institutionId: string;
  campusId: string | null;
  yearId: string;
  name: string;
  gradeLevelCode: string;
  gradeLevelLabel: string;
  educationLevelCode: string;
  programLabel: string;
  status: string;
  headcount: number;
}

export async function selectYears(tx: Tx): Promise<YearDim[]> {
  const rows = await tx.many<Record<string, any>>(
    `SELECT year_id, institution_id, code, label, starts_on::text AS starts_on, ends_on::text AS ends_on, status, is_current
       FROM analytics.dim_year ORDER BY starts_on DESC, code`,
  );
  return rows.map((r) => ({ id: r.year_id, institutionId: r.institution_id, code: r.code, label: r.label, startsOn: r.starts_on, endsOn: r.ends_on, status: r.status, isCurrent: r.is_current }));
}

export async function selectPeriods(tx: Tx, yearId?: string | null): Promise<PeriodDim[]> {
  const rows = await tx.many<Record<string, any>>(
    `SELECT period_id, year_id, code, label, ordinal, starts_on::text AS starts_on, ends_on::text AS ends_on, status
       FROM analytics.dim_period WHERE ($1::uuid IS NULL OR year_id = $1) ORDER BY starts_on, ordinal`,
    [yearId ?? null],
  );
  return rows.map((r) => ({ id: r.period_id, yearId: r.year_id, code: r.code, label: r.label, ordinal: r.ordinal, startsOn: r.starts_on, endsOn: r.ends_on, status: r.status }));
}

export async function selectScopes(tx: Tx): Promise<ScopeFact[]> {
  const rows = await tx.many<Record<string, any>>(`SELECT scope_kind, scope_id, parent_id, label, status FROM analytics.dim_scope ORDER BY scope_kind, label, scope_id`);
  return rows.map((r) => ({ kind: r.scope_kind, id: r.scope_id, parentId: r.parent_id, label: r.label, status: r.status }));
}

export async function selectClassrooms(tx: Tx, yearId?: string | null): Promise<ClassroomDim[]> {
  const rows = await tx.many<Record<string, any>>(
    `SELECT classroom_id, institution_id, campus_id, year_id, name, grade_level_code, grade_level_label, education_level_code, program_label, status, headcount
       FROM analytics.dim_classroom WHERE ($1::uuid IS NULL OR year_id = $1) ORDER BY name, classroom_id`,
    [yearId ?? null],
  );
  return rows.map((r) => ({
    id: r.classroom_id,
    institutionId: r.institution_id,
    campusId: r.campus_id,
    yearId: r.year_id,
    name: r.name,
    gradeLevelCode: r.grade_level_code,
    gradeLevelLabel: r.grade_level_label,
    educationLevelCode: r.education_level_code,
    programLabel: r.program_label,
    status: r.status,
    headcount: r.headcount,
  }));
}
