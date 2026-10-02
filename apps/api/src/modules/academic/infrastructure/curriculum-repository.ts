/** Programmes, matières, versions de curriculum, nœuds, prérequis, amendements. */
import type { Tx } from "@ecoledigitale/database";
import type { CurriculumAmendment, CurriculumNode, CurriculumVersion, Program, Subject } from "../domain/records";
import { AMENDMENT_COLS, NODE_COLS, PROGRAM_COLS, SUBJECT_COLS, VERSION_COLS, mapAmendment, mapNode, mapProgram, mapSubject, mapVersion } from "./mappers";

// ---------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------

export async function listPrograms(tx: Tx, f: { institutionId?: string | null; status?: string | null; educationLevelId?: string | null }): Promise<Program[]> {
  const rows = await tx.many(
    `SELECT ${PROGRAM_COLS} FROM academic.programs p
      WHERE ($1::uuid IS NULL OR p.institution_id = $1) AND ($2::text IS NULL OR p.status = $2) AND ($3::uuid IS NULL OR p.education_level_id = $3)
      ORDER BY p.institution_id, p.code`,
    [f.institutionId ?? null, f.status ?? null, f.educationLevelId ?? null],
  );
  return rows.map(mapProgram);
}

export async function getProgram(tx: Tx, id: string): Promise<Program | null> {
  const r = await tx.queryOne(`SELECT ${PROGRAM_COLS} FROM academic.programs p WHERE p.id = $1`, [id]);
  return r ? mapProgram(r) : null;
}

export async function insertProgram(
  tx: Tx,
  v: {
    id: string;
    institutionId: string;
    educationLevelId: string;
    parentProgramId: string | null;
    code: string;
    label: string;
    kindCode: string;
    domainCode: string | null;
    description: string | null;
    durationMonths: number | null;
    attributes: Record<string, unknown>;
    isCycle?: boolean;
    calculationContract?: string | null;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.programs (id, tenant_id, institution_id, education_level_id, parent_program_id, code, label, kind_code, domain_code, description, duration_months, attributes, is_cycle, calculation_contract)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
    [v.id, v.institutionId, v.educationLevelId, v.parentProgramId, v.code, v.label, v.kindCode, v.domainCode, v.description, v.durationMonths, JSON.stringify(v.attributes), v.isCycle ?? false, v.calculationContract ?? null],
  );
}

export async function updateProgram(
  tx: Tx,
  id: string,
  v: { label?: string; kindCode?: string; domainCode?: string | null; description?: string | null; durationMonths?: number | null; attributes?: Record<string, unknown>; status?: string; isCycle?: boolean; calculationContract?: string | null },
): Promise<void> {
  await tx.query(
    `UPDATE academic.programs SET
        label = COALESCE($2, label), kind_code = COALESCE($3, kind_code),
        domain_code = CASE WHEN $4::boolean THEN $5 ELSE domain_code END,
        description = CASE WHEN $6::boolean THEN $7 ELSE description END,
        duration_months = CASE WHEN $8::boolean THEN $9::integer ELSE duration_months END,
        attributes = COALESCE($10::jsonb, attributes), status = COALESCE($11, status),
        is_cycle = COALESCE($12::boolean, is_cycle),
        calculation_contract = CASE WHEN $13::boolean THEN $14::text ELSE calculation_contract END, updated_at = now()
      WHERE id = $1`,
    [
      id,
      v.label ?? null,
      v.kindCode ?? null,
      v.domainCode !== undefined,
      v.domainCode ?? null,
      v.description !== undefined,
      v.description ?? null,
      v.durationMonths !== undefined,
      v.durationMonths ?? null,
      v.attributes ? JSON.stringify(v.attributes) : null,
      v.status ?? null,
      v.isCycle ?? null,
      v.calculationContract !== undefined,
      v.calculationContract ?? null,
    ],
  );
}

export async function replaceProgramGradeLevels(tx: Tx, programId: string, gradeLevelIds: readonly string[]): Promise<void> {
  await tx.query("DELETE FROM academic.program_grade_levels WHERE program_id = $1 AND NOT (grade_level_id = ANY($2::uuid[]))", [programId, gradeLevelIds]);
  for (const [i, gradeLevelId] of gradeLevelIds.entries()) {
    await tx.query(
      `INSERT INTO academic.program_grade_levels (tenant_id, program_id, grade_level_id, ordinal) VALUES (kernel.current_tenant_id(), $1, $2, $3)
       ON CONFLICT (tenant_id, program_id, grade_level_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
      [programId, gradeLevelId, i],
    );
  }
}

/** Le niveau du programme est-il utilisé par une classe ou un nœud `LEVEL` d'un curriculum de ce programme ? */
export async function gradeLevelInUseByProgram(tx: Tx, programId: string, gradeLevelId: string): Promise<boolean> {
  const r = await tx.queryOne<{ used: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM academic.classrooms c WHERE c.program_id = $1 AND c.grade_level_id = $2)
          OR EXISTS (SELECT 1 FROM academic.curriculum_nodes n JOIN academic.curriculum_versions v ON v.tenant_id = n.tenant_id AND v.id = n.version_id
                      WHERE v.program_id = $1 AND n.grade_level_id = $2)) AS used`,
    [programId, gradeLevelId],
  );
  return r?.used === true;
}

// ---------------------------------------------------------------------------
// Matières
// ---------------------------------------------------------------------------

export async function listSubjects(tx: Tx, f: { institutionId?: string | null; status?: string | null; search?: string | null }): Promise<Subject[]> {
  const rows = await tx.many(
    `SELECT ${SUBJECT_COLS} FROM academic.subjects
      WHERE ($1::uuid IS NULL OR institution_id IS NULL OR institution_id = $1) AND ($2::text IS NULL OR status = $2)
        AND ($3::text IS NULL OR code ILIKE '%' || $3 || '%' OR label ILIKE '%' || $3 || '%')
      ORDER BY code`,
    [f.institutionId ?? null, f.status ?? null, f.search ?? null],
  );
  return rows.map(mapSubject);
}

export async function getSubject(tx: Tx, id: string): Promise<Subject | null> {
  const r = await tx.queryOne(`SELECT ${SUBJECT_COLS} FROM academic.subjects WHERE id = $1`, [id]);
  return r ? mapSubject(r) : null;
}

export async function insertSubject(
  tx: Tx,
  v: { id: string; institutionId: string | null; code: string; label: string; shortLabel: string | null; domainCode: string | null; description: string | null; attributes: Record<string, unknown> },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.subjects (id, tenant_id, institution_id, code, label, short_label, domain_code, description, attributes)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [v.id, v.institutionId, v.code, v.label, v.shortLabel, v.domainCode, v.description, JSON.stringify(v.attributes)],
  );
}

export async function updateSubject(
  tx: Tx,
  id: string,
  v: { label?: string; shortLabel?: string | null; domainCode?: string | null; description?: string | null; attributes?: Record<string, unknown>; status?: string },
): Promise<void> {
  await tx.query(
    `UPDATE academic.subjects SET label = COALESCE($2, label),
        short_label = CASE WHEN $3::boolean THEN $4 ELSE short_label END,
        domain_code = CASE WHEN $5::boolean THEN $6 ELSE domain_code END,
        description = CASE WHEN $7::boolean THEN $8 ELSE description END,
        attributes = COALESCE($9::jsonb, attributes), status = COALESCE($10, status), updated_at = now()
      WHERE id = $1`,
    [
      id,
      v.label ?? null,
      v.shortLabel !== undefined,
      v.shortLabel ?? null,
      v.domainCode !== undefined,
      v.domainCode ?? null,
      v.description !== undefined,
      v.description ?? null,
      v.attributes ? JSON.stringify(v.attributes) : null,
      v.status ?? null,
    ],
  );
}

export async function deleteSubject(tx: Tx, id: string): Promise<void> {
  await tx.query("DELETE FROM academic.subjects WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function listVersions(tx: Tx, f: { programId?: string | null; yearId?: string | null; status?: string | null; institutionId?: string | null }): Promise<CurriculumVersion[]> {
  const rows = await tx.many(
    `SELECT ${VERSION_COLS} FROM academic.curriculum_versions v JOIN academic.programs p ON p.tenant_id = v.tenant_id AND p.id = v.program_id
      WHERE ($1::uuid IS NULL OR v.program_id = $1) AND ($2::uuid IS NULL OR v.academic_year_id = $2) AND ($3::text IS NULL OR v.status = $3)
        AND ($4::uuid IS NULL OR p.institution_id = $4)
      ORDER BY v.academic_year_id, v.program_id`,
    [f.programId ?? null, f.yearId ?? null, f.status ?? null, f.institutionId ?? null],
  );
  return rows.map(mapVersion);
}

export async function getVersion(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<CurriculumVersion | null> {
  const r = await tx.queryOne(`SELECT ${VERSION_COLS} FROM academic.curriculum_versions v WHERE v.id = $1${options.forUpdate ? " FOR UPDATE OF v" : ""}`, [id]);
  return r ? mapVersion(r) : null;
}

export async function insertVersion(tx: Tx, v: { id: string; programId: string; academicYearId: string; clonedFromVersionId: string | null; note: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO academic.curriculum_versions (id, tenant_id, program_id, academic_year_id, cloned_from_version_id, note)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5)`,
    [v.id, v.programId, v.academicYearId, v.clonedFromVersionId, v.note],
  );
}

export async function setVersionStatus(tx: Tx, id: string, status: "DRAFT" | "PUBLISHED" | "LOCKED" | "ARCHIVED", actor: string | null): Promise<void> {
  await tx.query(
    `UPDATE academic.curriculum_versions SET status = $2,
        published_at = CASE WHEN $2 = 'PUBLISHED' THEN now() ELSE published_at END,
        published_by = CASE WHEN $2 = 'PUBLISHED' THEN $3::uuid ELSE published_by END,
        locked_at = CASE WHEN $2 = 'LOCKED' THEN now() ELSE locked_at END, updated_at = now()
      WHERE id = $1`,
    [id, status, actor],
  );
}

export async function listPublishedVersionsOfYear(tx: Tx, yearId: string): Promise<Array<{ id: string; programId: string }>> {
  const rows = await tx.many<{ id: string; program_id: string }>("SELECT id, program_id FROM academic.curriculum_versions WHERE academic_year_id = $1 AND status = 'PUBLISHED'", [yearId]);
  return rows.map((r) => ({ id: r.id, programId: r.program_id }));
}

// ---------------------------------------------------------------------------
// Nœuds
// ---------------------------------------------------------------------------

export async function listNodes(tx: Tx, versionId: string): Promise<CurriculumNode[]> {
  const rows = await tx.many(`SELECT ${NODE_COLS} FROM academic.curriculum_nodes n WHERE n.version_id = $1 ORDER BY n.ordinal, n.code`, [versionId]);
  return rows.map(mapNode);
}

export async function getNode(tx: Tx, id: string): Promise<CurriculumNode | null> {
  const r = await tx.queryOne(`SELECT ${NODE_COLS} FROM academic.curriculum_nodes n WHERE n.id = $1`, [id]);
  return r ? mapNode(r) : null;
}

export async function nextSiblingOrdinal(tx: Tx, versionId: string, parentId: string | null): Promise<number> {
  const r = await tx.queryOne<{ next: number }>(
    "SELECT COALESCE(max(ordinal), -1) + 1 AS next FROM academic.curriculum_nodes WHERE version_id = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid",
    [versionId, parentId],
  );
  return Number(r?.next ?? 0);
}

export interface NodeInsert {
  id: string;
  versionId: string;
  parentId: string | null;
  nodeTypeCode: string;
  lineageId: string;
  subjectId: string | null;
  gradeLevelId: string | null;
  periodTypeCode: string | null;
  periodOrdinal: number | null;
  code: string;
  label: string;
  ordinal: number;
  coefficient: string | null;
  credits: string | null;
  isMandatory: boolean;
  isTransversal: boolean;
  categoryCode: string | null;
  gradingMode?: "COMPOSED" | "DIRECT";
  resitAllowed?: boolean;
  countsInAverage?: boolean;
  sectionKey?: string | null;
  hoursTotal: string | null;
  hoursLecture: string | null;
  hoursTutorial: string | null;
  hoursPractical: string | null;
  attributes: Record<string, unknown>;
  status: "ACTIVE" | "INACTIVE";
}

const INSERT_NODE_COLS =
  "id, tenant_id, version_id, parent_id, node_type_code, lineage_id, subject_id, grade_level_id, period_type_code, period_ordinal, code, label, ordinal, coefficient, credits, is_mandatory, is_transversal, category_code, hours_total, hours_lecture, hours_tutorial, hours_practical, attributes, status, grading_mode, resit_allowed, counts_in_average, section_key";
const NODE_PARAM_COUNT = 27;

function nodeParams(n: NodeInsert): unknown[] {
  return [
    n.id, n.versionId, n.parentId, n.nodeTypeCode, n.lineageId, n.subjectId, n.gradeLevelId, n.periodTypeCode, n.periodOrdinal, n.code, n.label, n.ordinal,
    n.coefficient, n.credits, n.isMandatory, n.isTransversal, n.categoryCode, n.hoursTotal, n.hoursLecture, n.hoursTutorial, n.hoursPractical, JSON.stringify(n.attributes), n.status,
    n.gradingMode ?? "COMPOSED", n.resitAllowed ?? false, n.countsInAverage ?? true, n.sectionKey ?? null,
  ];
}

function nodeValuesSql(offset: number): string {
  const p = (i: number): string => `$${offset + i}`;
  return `(${p(1)}, kernel.current_tenant_id(), ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, ${p(13)}::numeric, ${p(14)}::numeric, ${p(15)}, ${p(16)}, ${p(17)}, ${p(18)}::numeric, ${p(19)}::numeric, ${p(20)}::numeric, ${p(21)}::numeric, ${p(22)}::jsonb, ${p(23)}, ${p(24)}, ${p(25)}, ${p(26)}, ${p(27)})`;
}

export async function insertNode(tx: Tx, n: NodeInsert): Promise<void> {
  await tx.query(`INSERT INTO academic.curriculum_nodes (${INSERT_NODE_COLS}) VALUES ${nodeValuesSql(0)}`, nodeParams(n));
}

/** Insère un lot de nœuds dont les parents sont DÉJÀ insérés (un niveau de profondeur à la fois). */
export async function insertNodesBatch(tx: Tx, nodes: readonly NodeInsert[], chunk = 150): Promise<void> {
  for (let start = 0; start < nodes.length; start += chunk) {
    const part = nodes.slice(start, start + chunk);
    const params: unknown[] = [];
    const values = part.map((n, i) => {
      params.push(...nodeParams(n));
      return nodeValuesSql(i * NODE_PARAM_COUNT);
    });
    await tx.query(`INSERT INTO academic.curriculum_nodes (${INSERT_NODE_COLS}) VALUES ${values.join(", ")}`, params);
  }
}

export async function updateNode(
  tx: Tx,
  id: string,
  v: {
    code?: string;
    label?: string;
    subjectId?: string | null;
    gradeLevelId?: string | null;
    periodTypeCode?: string | null;
    periodOrdinal?: number | null;
    ordinal?: number;
    coefficient?: string | null;
    credits?: string | null;
    isMandatory?: boolean;
    isTransversal?: boolean;
    categoryCode?: string | null;
    gradingMode?: "COMPOSED" | "DIRECT";
    resitAllowed?: boolean;
    countsInAverage?: boolean;
    sectionKey?: string | null;
    hoursTotal?: string | null;
    hoursLecture?: string | null;
    hoursTutorial?: string | null;
    hoursPractical?: string | null;
    attributes?: Record<string, unknown>;
    status?: string;
  },
): Promise<void> {
  const has = (k: keyof typeof v): boolean => v[k] !== undefined;
  await tx.query(
    `UPDATE academic.curriculum_nodes SET
        code = COALESCE($2, code), label = COALESCE($3, label),
        subject_id = CASE WHEN $4::boolean THEN $5::uuid ELSE subject_id END,
        grade_level_id = CASE WHEN $6::boolean THEN $7::uuid ELSE grade_level_id END,
        period_type_code = CASE WHEN $8::boolean THEN $9::text ELSE period_type_code END,
        period_ordinal = CASE WHEN $10::boolean THEN $11::integer ELSE period_ordinal END,
        ordinal = COALESCE($12::integer, ordinal),
        coefficient = CASE WHEN $13::boolean THEN $14::numeric ELSE coefficient END,
        credits = CASE WHEN $15::boolean THEN $16::numeric ELSE credits END,
        is_mandatory = COALESCE($17::boolean, is_mandatory), is_transversal = COALESCE($18::boolean, is_transversal),
        category_code = CASE WHEN $19::boolean THEN $20::text ELSE category_code END,
        hours_total = CASE WHEN $21::boolean THEN $22::numeric ELSE hours_total END,
        hours_lecture = CASE WHEN $23::boolean THEN $24::numeric ELSE hours_lecture END,
        hours_tutorial = CASE WHEN $25::boolean THEN $26::numeric ELSE hours_tutorial END,
        hours_practical = CASE WHEN $27::boolean THEN $28::numeric ELSE hours_practical END,
        attributes = COALESCE($29::jsonb, attributes), status = COALESCE($30::text, status),
        grading_mode = COALESCE($31::text, grading_mode), resit_allowed = COALESCE($32::boolean, resit_allowed),
        counts_in_average = COALESCE($33::boolean, counts_in_average),
        section_key = CASE WHEN $34::boolean THEN $35::text ELSE section_key END, updated_at = now()
      WHERE id = $1`,
    [
      id,
      v.code ?? null,
      v.label ?? null,
      has("subjectId"), v.subjectId ?? null,
      has("gradeLevelId"), v.gradeLevelId ?? null,
      has("periodTypeCode"), v.periodTypeCode ?? null,
      has("periodOrdinal"), v.periodOrdinal ?? null,
      v.ordinal ?? null,
      has("coefficient"), v.coefficient ?? null,
      has("credits"), v.credits ?? null,
      v.isMandatory ?? null,
      v.isTransversal ?? null,
      has("categoryCode"), v.categoryCode ?? null,
      has("hoursTotal"), v.hoursTotal ?? null,
      has("hoursLecture"), v.hoursLecture ?? null,
      has("hoursTutorial"), v.hoursTutorial ?? null,
      has("hoursPractical"), v.hoursPractical ?? null,
      v.attributes ? JSON.stringify(v.attributes) : null,
      v.status ?? null,
      v.gradingMode ?? null,
      v.resitAllowed ?? null,
      v.countsInAverage ?? null,
      has("sectionKey"), v.sectionKey ?? null,
    ],
  );
}

export async function moveNode(tx: Tx, id: string, parentId: string | null, ordinal: number): Promise<void> {
  await tx.query("UPDATE academic.curriculum_nodes SET parent_id = $2, ordinal = $3, updated_at = now() WHERE id = $1", [id, parentId, ordinal]);
}

export async function deleteNodes(tx: Tx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.query("DELETE FROM academic.curriculum_nodes WHERE id = ANY($1::uuid[])", [ids]);
}

export async function setStructuralChange(tx: Tx, on: boolean): Promise<void> {
  await tx.query("SELECT set_config('academic.structural_change', $1, true)", [on ? "on" : "off"]);
}

// ---------------------------------------------------------------------------
// Prérequis
// ---------------------------------------------------------------------------

export async function replacePrerequisites(tx: Tx, versionId: string, nodeId: string, id: () => string, lineageIds: readonly string[]): Promise<void> {
  await tx.query("DELETE FROM academic.curriculum_prerequisites WHERE node_id = $1 AND NOT (required_lineage_id = ANY($2::uuid[]))", [nodeId, lineageIds]);
  for (const lineageId of lineageIds) {
    await tx.query(
      `INSERT INTO academic.curriculum_prerequisites (id, tenant_id, version_id, node_id, required_lineage_id)
       VALUES ($1, kernel.current_tenant_id(), $2, $3, $4) ON CONFLICT (tenant_id, node_id, required_lineage_id) DO NOTHING`,
      [id(), versionId, nodeId, lineageId],
    );
  }
}

export async function insertPrerequisitesBatch(tx: Tx, versionId: string, rows: ReadonlyArray<{ id: string; nodeId: string; requiredLineageId: string }>, chunk = 300): Promise<void> {
  for (let start = 0; start < rows.length; start += chunk) {
    const part = rows.slice(start, start + chunk);
    const params: unknown[] = [versionId];
    const values = part.map((r, i) => {
      params.push(r.id, r.nodeId, r.requiredLineageId);
      return `($${i * 3 + 2}, kernel.current_tenant_id(), $1, $${i * 3 + 3}, $${i * 3 + 4})`;
    });
    await tx.query(`INSERT INTO academic.curriculum_prerequisites (id, tenant_id, version_id, node_id, required_lineage_id) VALUES ${values.join(", ")}`, params);
  }
}

/** Lignées existantes dans l'établissement (toutes versions, tous programmes) : cible légitime d'un prérequis. */
export async function knownLineagesOfInstitution(tx: Tx, institutionId: string): Promise<Set<string>> {
  const rows = await tx.many<{ lineage_id: string }>(
    `SELECT DISTINCT n.lineage_id FROM academic.curriculum_nodes n
       JOIN academic.curriculum_versions v ON v.tenant_id = n.tenant_id AND v.id = n.version_id
       JOIN academic.programs p ON p.tenant_id = v.tenant_id AND p.id = v.program_id
      WHERE p.institution_id = $1`,
    [institutionId],
  );
  return new Set(rows.map((r) => r.lineage_id));
}

/** Nœuds d'une version qui exigent l'une des lignées données (suppression d'un nœud référencé). */
export async function nodesRequiringLineages(tx: Tx, versionId: string, lineageIds: readonly string[]): Promise<Array<{ nodeId: string; lineageId: string }>> {
  if (lineageIds.length === 0) return [];
  const rows = await tx.many<{ node_id: string; required_lineage_id: string }>(
    "SELECT node_id, required_lineage_id FROM academic.curriculum_prerequisites WHERE version_id = $1 AND required_lineage_id = ANY($2::uuid[])",
    [versionId, lineageIds],
  );
  return rows.map((r) => ({ nodeId: r.node_id, lineageId: r.required_lineage_id }));
}

/** Premier nœud (actif) d'une lignée dans l'établissement : libellé pour les messages de prérequis manquants. */
export async function describeLineages(tx: Tx, lineageIds: readonly string[]): Promise<Map<string, { nodeId: string; code: string; label: string }>> {
  if (lineageIds.length === 0) return new Map();
  const rows = await tx.many<{ lineage_id: string; id: string; code: string; label: string }>(
    `SELECT DISTINCT ON (n.lineage_id) n.lineage_id, n.id, n.code, n.label FROM academic.curriculum_nodes n
      WHERE n.lineage_id = ANY($1::uuid[]) ORDER BY n.lineage_id, n.created_at DESC, n.id DESC`,
    [lineageIds],
  );
  return new Map(rows.map((r) => [r.lineage_id, { nodeId: r.id, code: r.code, label: r.label }]));
}

// ---------------------------------------------------------------------------
// Amendements
// ---------------------------------------------------------------------------

export async function insertAmendment(
  tx: Tx,
  v: { id: string; versionId: string; nodeId: string | null; kind: string; oldValue: unknown; newValue: unknown; reason: string; amendedBy: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.curriculum_amendments (id, tenant_id, version_id, node_id, kind, old_value, new_value, reason, amended_by)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [v.id, v.versionId, v.nodeId, v.kind, v.oldValue === undefined ? null : JSON.stringify(v.oldValue), v.newValue === undefined ? null : JSON.stringify(v.newValue), v.reason, v.amendedBy],
  );
}

export async function listAmendments(tx: Tx, versionId: string): Promise<CurriculumAmendment[]> {
  const rows = await tx.many(`SELECT ${AMENDMENT_COLS} FROM academic.curriculum_amendments WHERE version_id = $1 ORDER BY amended_at DESC, id DESC`, [versionId]);
  return rows.map(mapAmendment);
}
