/** Paramètres, échelles, référentiels de compétences, banque d'appréciations, applications du modèle (SQL via le `Tx` de TenantDb). */
import type { Tx } from "@ecoledigitale/database";
import type { Competency, CompetencyDomain, Framework, FrameworkStatus, Phrase, RatingLevel, RatingScale, Settings, SourceKind, Uuid } from "../domain/types";
import { PHRASE_COLUMNS, toPhrase, toSettings } from "./rows";

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

export async function getSettingsRow(tx: Tx, institutionId: Uuid): Promise<Settings | null> {
  const r = await tx.queryOne(`SELECT * FROM primary_school.settings WHERE institution_id = $1`, [institutionId]);
  return r ? toSettings(r) : null;
}

export async function upsertSettingsRow(tx: Tx, tenantId: Uuid, s: Settings): Promise<Settings> {
  const r = await tx.queryOne(
    `INSERT INTO primary_school.settings (tenant_id, institution_id, require_homeroom_for_activation, council_required_for_bilan, phrase_bank_enabled, default_rating_scale_id, archive_retention_years)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, institution_id) DO UPDATE SET require_homeroom_for_activation = EXCLUDED.require_homeroom_for_activation,
       council_required_for_bilan = EXCLUDED.council_required_for_bilan, phrase_bank_enabled = EXCLUDED.phrase_bank_enabled,
       default_rating_scale_id = EXCLUDED.default_rating_scale_id, archive_retention_years = EXCLUDED.archive_retention_years, updated_at = now()
     RETURNING *`,
    [tenantId, s.institutionId, s.requireHomeroomForActivation, s.councilRequiredForBilan, s.phraseBankEnabled, s.defaultRatingScaleId, s.archiveRetentionYears],
  );
  return toSettings(r);
}

/** Insère les paramètres seulement s'ils n'existent pas (modèle de pack : jamais d'écrasement). */
export async function insertSettingsIfAbsent(tx: Tx, tenantId: Uuid, s: Settings): Promise<boolean> {
  const rows = await tx.many(
    `INSERT INTO primary_school.settings (tenant_id, institution_id, require_homeroom_for_activation, council_required_for_bilan, phrase_bank_enabled, default_rating_scale_id, archive_retention_years)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, institution_id) DO NOTHING RETURNING institution_id`,
    [tenantId, s.institutionId, s.requireHomeroomForActivation, s.councilRequiredForBilan, s.phraseBankEnabled, s.defaultRatingScaleId, s.archiveRetentionYears],
  );
  return rows.length > 0;
}

export async function getTemplateApplication(tx: Tx, institutionId: Uuid, educationSystem: string, templateVersion: number): Promise<{ appliedAt: Date; summary: Record<string, unknown> } | null> {
  const r = await tx.queryOne(`SELECT applied_at, summary FROM primary_school.template_applications WHERE institution_id = $1 AND education_system = $2 AND template_version = $3`, [institutionId, educationSystem, templateVersion]);
  return r ? { appliedAt: r.applied_at, summary: r.summary } : null;
}

export async function insertTemplateApplication(tx: Tx, a: { id: Uuid; tenantId: Uuid; institutionId: Uuid; educationSystem: string; templateVersion: number; appliedBy: Uuid | null; summary: Record<string, unknown> }): Promise<void> {
  await tx.query(
    `INSERT INTO primary_school.template_applications (id, tenant_id, institution_id, education_system, template_version, applied_by, summary) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [a.id, a.tenantId, a.institutionId, a.educationSystem, a.templateVersion, a.appliedBy, JSON.stringify(a.summary)],
  );
}

// ---------------------------------------------------------------------------
// Échelles
// ---------------------------------------------------------------------------

const toLevel = (r: any): RatingLevel => ({ id: r.id, scaleId: r.scale_id, code: r.code, label: r.label, ordinal: r.ordinal, meetsExpectation: r.meets_expectation });

async function levelsOf(tx: Tx, scaleIds: readonly Uuid[]): Promise<Map<Uuid, RatingLevel[]>> {
  const out = new Map<Uuid, RatingLevel[]>();
  if (scaleIds.length === 0) return out;
  const rows = await tx.many(`SELECT id, scale_id, code, label, ordinal, meets_expectation FROM primary_school.rating_levels WHERE scale_id = ANY($1::uuid[]) ORDER BY scale_id, ordinal`, [scaleIds]);
  for (const r of rows) out.set(r.scale_id, [...(out.get(r.scale_id) ?? []), toLevel(r)]);
  return out;
}

async function lockedScaleIds(tx: Tx, scaleIds: readonly Uuid[]): Promise<Set<Uuid>> {
  if (scaleIds.length === 0) return new Set();
  const rows = await tx.many(`SELECT DISTINCT scale_id FROM primary_school.competency_frameworks WHERE scale_id = ANY($1::uuid[]) AND status IN ('PUBLISHED','RETIRED')`, [scaleIds]);
  return new Set(rows.map((r) => r.scale_id as Uuid));
}

export async function listScalesRows(tx: Tx, scaleId?: Uuid): Promise<RatingScale[]> {
  const rows = await tx.many(
    `SELECT id, code, label, source_kind, source_reference, status FROM primary_school.rating_scales ${scaleId ? "WHERE id = $1" : ""} ORDER BY code`,
    scaleId ? [scaleId] : [],
  );
  const ids = rows.map((r) => r.id as Uuid);
  const levels = await levelsOf(tx, ids);
  const locked = await lockedScaleIds(tx, ids);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    sourceKind: r.source_kind as SourceKind,
    sourceReference: r.source_reference,
    status: r.status,
    levels: levels.get(r.id) ?? [],
    locked: locked.has(r.id),
  }));
}

export async function getScaleRow(tx: Tx, id: Uuid): Promise<RatingScale | null> {
  return (await listScalesRows(tx, id))[0] ?? null;
}

export async function findScaleByCode(tx: Tx, code: string): Promise<RatingScale | null> {
  const r = await tx.queryOne(`SELECT id FROM primary_school.rating_scales WHERE code = $1`, [code]);
  return r ? getScaleRow(tx, r.id) : null;
}

export async function insertScaleRow(tx: Tx, s: { id: Uuid; tenantId: Uuid; code: string; label: string; sourceKind: SourceKind; sourceReference: string | null }): Promise<void> {
  await tx.query(`INSERT INTO primary_school.rating_scales (id, tenant_id, code, label, source_kind, source_reference) VALUES ($1,$2,$3,$4,$5,$6)`, [s.id, s.tenantId, s.code, s.label, s.sourceKind, s.sourceReference]);
}

export async function updateScaleRow(tx: Tx, id: Uuid, patch: { label?: string | undefined; status?: "ACTIVE" | "ARCHIVED" | undefined }): Promise<void> {
  await tx.query(`UPDATE primary_school.rating_scales SET label = COALESCE($2, label), status = COALESCE($3, status), updated_at = now() WHERE id = $1`, [id, patch.label ?? null, patch.status ?? null]);
}

export async function replaceLevels(tx: Tx, tenantId: Uuid, scaleId: Uuid, levels: ReadonlyArray<{ id: Uuid; code: string; label: string; ordinal: number; meetsExpectation: boolean }>): Promise<void> {
  await tx.query(`DELETE FROM primary_school.rating_levels WHERE scale_id = $1`, [scaleId]);
  for (const l of levels) {
    await tx.query(
      `INSERT INTO primary_school.rating_levels (id, tenant_id, scale_id, code, label, ordinal, meets_expectation) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [l.id, tenantId, scaleId, l.code, l.label, l.ordinal, l.meetsExpectation],
    );
  }
}

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

const FRAMEWORK_SELECT = `f.id, f.code, f.version, f.label, f.scale_id, f.status, f.source_kind, f.source_reference, f.published_at,
  COALESCE((SELECT array_agg(g.grade_level_code ORDER BY g.grade_level_code) FROM primary_school.framework_grade_levels g WHERE g.framework_id = f.id), '{}') AS grade_level_codes,
  (SELECT count(*)::int FROM primary_school.competencies c WHERE c.framework_id = f.id) AS competency_count`;

const toFramework = (r: any): Framework => ({
  id: r.id,
  code: r.code,
  version: r.version,
  label: r.label,
  scaleId: r.scale_id,
  status: r.status,
  sourceKind: r.source_kind,
  sourceReference: r.source_reference,
  publishedAt: r.published_at,
  gradeLevelCodes: r.grade_level_codes ?? [],
  competencyCount: r.competency_count,
});

export async function listFrameworkRows(tx: Tx, f: { status?: FrameworkStatus | undefined; gradeLevelCode?: string | undefined } = {}): Promise<Framework[]> {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (f.status) { params.push(f.status); where.push(`f.status = $${params.length}`); }
  if (f.gradeLevelCode) { params.push(f.gradeLevelCode); where.push(`EXISTS (SELECT 1 FROM primary_school.framework_grade_levels g WHERE g.framework_id = f.id AND g.grade_level_code = $${params.length})`); }
  const rows = await tx.many(`SELECT ${FRAMEWORK_SELECT} FROM primary_school.competency_frameworks f WHERE ${where.join(" AND ")} ORDER BY f.code, f.version DESC`, params);
  return rows.map(toFramework);
}

export async function getFrameworkRow(tx: Tx, id: Uuid, forUpdate = false): Promise<Framework | null> {
  const r = await tx.queryOne(`SELECT ${FRAMEWORK_SELECT} FROM primary_school.competency_frameworks f WHERE f.id = $1 ${forUpdate ? "FOR UPDATE OF f" : ""}`, [id]);
  return r ? toFramework(r) : null;
}

export async function maxFrameworkVersion(tx: Tx, code: string): Promise<number> {
  const r = await tx.queryOne(`SELECT COALESCE(max(version), 0)::int AS v FROM primary_school.competency_frameworks WHERE code = $1`, [code]);
  return r?.v ?? 0;
}

export async function insertFrameworkRow(
  tx: Tx,
  f: { id: Uuid; tenantId: Uuid; code: string; version: number; label: string; scaleId: Uuid; sourceKind: SourceKind; sourceReference: string | null; status?: "DRAFT" | "PUBLISHED"; publishedAt?: Date | null; publishedBy?: Uuid | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO primary_school.competency_frameworks (id, tenant_id, code, version, label, scale_id, source_kind, source_reference, status, published_at, published_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [f.id, f.tenantId, f.code, f.version, f.label, f.scaleId, f.sourceKind, f.sourceReference, f.status ?? "DRAFT", f.publishedAt ?? null, f.publishedBy ?? null],
  );
}

export async function updateFrameworkLabel(tx: Tx, id: Uuid, label: string): Promise<void> {
  await tx.query(`UPDATE primary_school.competency_frameworks SET label = $2, updated_at = now() WHERE id = $1`, [id, label]);
}

export async function setFrameworkStatus(tx: Tx, id: Uuid, status: FrameworkStatus, by: Uuid | null, now: Date): Promise<void> {
  if (status === "PUBLISHED") {
    await tx.query(`UPDATE primary_school.competency_frameworks SET status = 'PUBLISHED', published_at = $2, published_by = $3, updated_at = now() WHERE id = $1`, [id, now.toISOString(), by]);
  } else {
    await tx.query(`UPDATE primary_school.competency_frameworks SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
  }
}

export async function retirePublishedOfCode(tx: Tx, code: string, exceptId: Uuid): Promise<number> {
  const rows = await tx.many(`UPDATE primary_school.competency_frameworks SET status = 'RETIRED', updated_at = now() WHERE code = $1 AND status = 'PUBLISHED' AND id <> $2 RETURNING id`, [code, exceptId]);
  return rows.length;
}

export async function deleteDraftFramework(tx: Tx, id: Uuid): Promise<void> {
  await tx.query(`DELETE FROM primary_school.framework_grade_levels WHERE framework_id = $1`, [id]);
  await tx.query(`DELETE FROM primary_school.competencies WHERE framework_id = $1`, [id]);
  await tx.query(`DELETE FROM primary_school.competency_domains WHERE framework_id = $1`, [id]);
  await tx.query(`DELETE FROM primary_school.competency_frameworks WHERE id = $1`, [id]);
}

export async function loadStructure(tx: Tx, frameworkId: Uuid): Promise<CompetencyDomain[]> {
  const domains = await tx.many(`SELECT id, code, label, ordinal FROM primary_school.competency_domains WHERE framework_id = $1 ORDER BY ordinal`, [frameworkId]);
  const comps = await tx.many(`SELECT id, domain_id, code, label, description, ordinal FROM primary_school.competencies WHERE framework_id = $1 ORDER BY domain_id, ordinal`, [frameworkId]);
  const byDomain = new Map<Uuid, Competency[]>();
  for (const c of comps) {
    byDomain.set(c.domain_id, [...(byDomain.get(c.domain_id) ?? []), { id: c.id, domainId: c.domain_id, code: c.code, label: c.label, description: c.description, ordinal: c.ordinal }]);
  }
  return domains.map((d) => ({ id: d.id, code: d.code, label: d.label, ordinal: d.ordinal, competencies: byDomain.get(d.id) ?? [] }));
}

export interface StructureInput {
  domains: ReadonlyArray<{ code: string; label: string; competencies: ReadonlyArray<{ code: string; label: string; description?: string | null | undefined }> }>;
}

/** Remplace TOUTE la structure d'un brouillon (domaines, compétences, niveaux d'application). Les déclencheurs refusent un référentiel publié. */
export async function replaceStructure(tx: Tx, tenantId: Uuid, frameworkId: Uuid, input: StructureInput, newId: () => string): Promise<void> {
  await tx.query(`DELETE FROM primary_school.competencies WHERE framework_id = $1`, [frameworkId]);
  await tx.query(`DELETE FROM primary_school.competency_domains WHERE framework_id = $1`, [frameworkId]);
  let domainOrdinal = 0;
  for (const d of input.domains) {
    domainOrdinal += 1;
    const domainId = newId();
    await tx.query(`INSERT INTO primary_school.competency_domains (id, tenant_id, framework_id, code, label, ordinal) VALUES ($1,$2,$3,$4,$5,$6)`, [domainId, tenantId, frameworkId, d.code, d.label, domainOrdinal]);
    let ordinal = 0;
    for (const c of d.competencies) {
      ordinal += 1;
      await tx.query(
        `INSERT INTO primary_school.competencies (id, tenant_id, framework_id, domain_id, code, label, description, ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId(), tenantId, frameworkId, domainId, c.code, c.label, c.description ?? null, ordinal],
      );
    }
  }
}

export async function replaceGradeLevels(tx: Tx, tenantId: Uuid, frameworkId: Uuid, codes: readonly string[]): Promise<void> {
  await tx.query(`DELETE FROM primary_school.framework_grade_levels WHERE framework_id = $1`, [frameworkId]);
  for (const code of [...new Set(codes)]) {
    await tx.query(`INSERT INTO primary_school.framework_grade_levels (tenant_id, framework_id, grade_level_code) VALUES ($1,$2,$3)`, [tenantId, frameworkId, code]);
  }
}

export async function countLevelsOfScale(tx: Tx, scaleId: Uuid): Promise<number> {
  const r = await tx.queryOne(`SELECT count(*)::int AS n FROM primary_school.rating_levels WHERE scale_id = $1`, [scaleId]);
  return r?.n ?? 0;
}

export async function countCompetencies(tx: Tx, frameworkId: Uuid): Promise<number> {
  const r = await tx.queryOne(`SELECT count(*)::int AS n FROM primary_school.competencies WHERE framework_id = $1`, [frameworkId]);
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Banque d'appréciations
// ---------------------------------------------------------------------------

export async function listPhraseRows(tx: Tx): Promise<Phrase[]> {
  const rows = await tx.many(`SELECT ${PHRASE_COLUMNS} FROM primary_school.appreciation_phrases p ORDER BY p.scope, p.code`);
  return rows.map(toPhrase);
}

export async function getPhraseRow(tx: Tx, id: Uuid): Promise<Phrase | null> {
  const r = await tx.queryOne(`SELECT ${PHRASE_COLUMNS} FROM primary_school.appreciation_phrases p WHERE p.id = $1`, [id]);
  return r ? toPhrase(r) : null;
}

export async function findPhraseByCode(tx: Tx, code: string): Promise<Phrase | null> {
  const r = await tx.queryOne(`SELECT ${PHRASE_COLUMNS} FROM primary_school.appreciation_phrases p WHERE p.code = $1`, [code]);
  return r ? toPhrase(r) : null;
}

export async function insertPhraseRow(tx: Tx, p: { id: Uuid; tenantId: Uuid; code: string; scope: Phrase["scope"]; body: string; ratingLevelCode: string | null; gradeLevelCode: string | null; sourceKind: SourceKind }): Promise<Phrase> {
  const r = await tx.queryOne(
    `INSERT INTO primary_school.appreciation_phrases (id, tenant_id, code, scope, body, rating_level_code, grade_level_code, source_kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${PHRASE_COLUMNS.replace(/p\./g, "")}`,
    [p.id, p.tenantId, p.code, p.scope, p.body, p.ratingLevelCode, p.gradeLevelCode, p.sourceKind],
  );
  return toPhrase(r);
}

export async function updatePhraseRow(tx: Tx, id: Uuid, patch: { body?: string | undefined; ratingLevelCode?: string | null | undefined; gradeLevelCode?: string | null | undefined; active?: boolean | undefined }): Promise<Phrase | null> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  if (patch.body !== undefined) { params.push(patch.body); sets.push(`body = $${params.length}`); }
  if (patch.ratingLevelCode !== undefined) { params.push(patch.ratingLevelCode); sets.push(`rating_level_code = $${params.length}`); }
  if (patch.gradeLevelCode !== undefined) { params.push(patch.gradeLevelCode); sets.push(`grade_level_code = $${params.length}`); }
  if (patch.active !== undefined) { params.push(patch.active); sets.push(`active = $${params.length}`); }
  const r = await tx.queryOne(`UPDATE primary_school.appreciation_phrases SET ${sets.join(", ")} WHERE id = $1 RETURNING ${PHRASE_COLUMNS.replace(/p\./g, "")}`, params);
  return r ? toPhrase(r) : null;
}
