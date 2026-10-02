/**
 * Dépôt SQL des données de référence : types d'examens, séries, épreuves, pièces exigées, centres, salles, formats d'export
 * et d'import. SQL paramétré uniquement, via le `Tx` d'un `TenantDb.run` ; la RLS isole par tenant.
 */
import type { Tx } from "@ecoledigitale/database";
import type {
  CenterRow,
  DocumentRequirementRow,
  ExamPaperRow,
  ExamTrackRow,
  ExamTypeRow,
  ExportColumn,
  ExportFormatRow,
  FormatStatus,
  ImportColumn,
  ImportFormatRow,
  RoomRow,
  SourceKind,
} from "../domain/types";

// ------------------------------------------------------------------ types d'examens

const TYPE_COLS = `id, code, label, education_level_code, grade_level_code, result_contract_id, candidate_number_pattern, source_kind, source_reference, status, created_at, updated_at`;

interface TypeSql {
  id: string; code: string; label: string; education_level_code: string; grade_level_code: string | null; result_contract_id: string;
  candidate_number_pattern: string; source_kind: SourceKind; source_reference: string | null; status: "ACTIVE" | "ARCHIVED"; created_at: Date; updated_at: Date;
}
const toType = (r: TypeSql): ExamTypeRow => ({
  id: r.id, code: r.code, label: r.label, educationLevelCode: r.education_level_code, gradeLevelCode: r.grade_level_code, resultContractId: r.result_contract_id,
  candidateNumberPattern: r.candidate_number_pattern, sourceKind: r.source_kind, sourceReference: r.source_reference, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function listTypes(tx: Tx, filter: { status?: "ACTIVE" | "ARCHIVED" } = {}): Promise<ExamTypeRow[]> {
  const rows = await tx.many<TypeSql>(`SELECT ${TYPE_COLS} FROM examinations.exam_types WHERE ($1::text IS NULL OR status = $1) ORDER BY code`, [filter.status ?? null]);
  return rows.map(toType);
}

export async function getType(tx: Tx, id: string): Promise<ExamTypeRow | null> {
  const r = await tx.queryOne<TypeSql>(`SELECT ${TYPE_COLS} FROM examinations.exam_types WHERE id = $1`, [id]);
  return r ? toType(r) : null;
}

export async function getTypeByCode(tx: Tx, code: string): Promise<ExamTypeRow | null> {
  const r = await tx.queryOne<TypeSql>(`SELECT ${TYPE_COLS} FROM examinations.exam_types WHERE code = $1`, [code]);
  return r ? toType(r) : null;
}

export async function insertType(tx: Tx, tenantId: string, t: Omit<ExamTypeRow, "createdAt" | "updatedAt" | "status"> & { status?: "ACTIVE" | "ARCHIVED" }): Promise<ExamTypeRow> {
  const r = await tx.queryOne<TypeSql>(
    `INSERT INTO examinations.exam_types (id, tenant_id, code, label, education_level_code, grade_level_code, result_contract_id, candidate_number_pattern, source_kind, source_reference, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${TYPE_COLS}`,
    [t.id, tenantId, t.code, t.label, t.educationLevelCode, t.gradeLevelCode, t.resultContractId, t.candidateNumberPattern, t.sourceKind, t.sourceReference, t.status ?? "ACTIVE"],
  );
  return toType(r as TypeSql);
}

export async function updateType(tx: Tx, id: string, patch: { label?: string; gradeLevelCode?: string | null; candidateNumberPattern?: string; sourceReference?: string | null; status?: "ACTIVE" | "ARCHIVED" }): Promise<ExamTypeRow | null> {
  const r = await tx.queryOne<TypeSql>(
    `UPDATE examinations.exam_types SET
       label = COALESCE($2, label),
       grade_level_code = CASE WHEN $3::boolean THEN $4 ELSE grade_level_code END,
       candidate_number_pattern = COALESCE($5, candidate_number_pattern),
       source_reference = CASE WHEN $6::boolean THEN $7 ELSE source_reference END,
       status = COALESCE($8, status),
       updated_at = now()
     WHERE id = $1 RETURNING ${TYPE_COLS}`,
    [id, patch.label ?? null, "gradeLevelCode" in patch, patch.gradeLevelCode ?? null, patch.candidateNumberPattern ?? null, "sourceReference" in patch, patch.sourceReference ?? null, patch.status ?? null],
  );
  return r ? toType(r) : null;
}

// ------------------------------------------------------------------ séries

interface TrackSql { id: string; exam_type_id: string; code: string; label: string; source_kind: SourceKind; active: boolean }
const toTrack = (r: TrackSql): ExamTrackRow => ({ id: r.id, examTypeId: r.exam_type_id, code: r.code, label: r.label, sourceKind: r.source_kind, active: r.active });

export async function listTracks(tx: Tx, typeId: string): Promise<ExamTrackRow[]> {
  return (await tx.many<TrackSql>(`SELECT id, exam_type_id, code, label, source_kind, active FROM examinations.exam_tracks WHERE exam_type_id = $1 ORDER BY code`, [typeId])).map(toTrack);
}
export async function getTrack(tx: Tx, typeId: string, id: string): Promise<ExamTrackRow | null> {
  const r = await tx.queryOne<TrackSql>(`SELECT id, exam_type_id, code, label, source_kind, active FROM examinations.exam_tracks WHERE exam_type_id = $1 AND id = $2`, [typeId, id]);
  return r ? toTrack(r) : null;
}
export async function insertTrack(tx: Tx, tenantId: string, t: { id: string; examTypeId: string; code: string; label: string; sourceKind: SourceKind }): Promise<ExamTrackRow> {
  const r = await tx.queryOne<TrackSql>(
    `INSERT INTO examinations.exam_tracks (id, tenant_id, exam_type_id, code, label, source_kind) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, exam_type_id, code, label, source_kind, active`,
    [t.id, tenantId, t.examTypeId, t.code, t.label, t.sourceKind],
  );
  return toTrack(r as TrackSql);
}
export async function updateTrack(tx: Tx, typeId: string, id: string, patch: { label?: string; active?: boolean }): Promise<ExamTrackRow | null> {
  const r = await tx.queryOne<TrackSql>(
    `UPDATE examinations.exam_tracks SET label = COALESCE($3, label), active = COALESCE($4, active) WHERE exam_type_id = $1 AND id = $2 RETURNING id, exam_type_id, code, label, source_kind, active`,
    [typeId, id, patch.label ?? null, patch.active ?? null],
  );
  return r ? toTrack(r) : null;
}

// ------------------------------------------------------------------ épreuves

const PAPER_COLS = `id, exam_type_id, track_code, code, label, coefficient::text AS coefficient, scale_max::text AS scale_max, is_optional, ordinal, source_kind, active`;
interface PaperSql { id: string; exam_type_id: string; track_code: string | null; code: string; label: string; coefficient: string; scale_max: string; is_optional: boolean; ordinal: number; source_kind: SourceKind; active: boolean }
const toPaper = (r: PaperSql): ExamPaperRow => ({
  id: r.id, examTypeId: r.exam_type_id, trackCode: r.track_code, code: r.code, label: r.label, coefficient: r.coefficient, scaleMax: r.scale_max, isOptional: r.is_optional, ordinal: r.ordinal, sourceKind: r.source_kind, active: r.active,
});

export async function listPapers(tx: Tx, typeId: string): Promise<ExamPaperRow[]> {
  return (await tx.many<PaperSql>(`SELECT ${PAPER_COLS} FROM examinations.exam_papers WHERE exam_type_id = $1 ORDER BY ordinal, code`, [typeId])).map(toPaper);
}
export async function getPaper(tx: Tx, typeId: string, id: string): Promise<ExamPaperRow | null> {
  const r = await tx.queryOne<PaperSql>(`SELECT ${PAPER_COLS} FROM examinations.exam_papers WHERE exam_type_id = $1 AND id = $2`, [typeId, id]);
  return r ? toPaper(r) : null;
}
export async function insertPaper(tx: Tx, tenantId: string, p: Omit<ExamPaperRow, "active">): Promise<ExamPaperRow> {
  const r = await tx.queryOne<PaperSql>(
    `INSERT INTO examinations.exam_papers (id, tenant_id, exam_type_id, track_code, code, label, coefficient, scale_max, is_optional, ordinal, source_kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9, $10, $11) RETURNING ${PAPER_COLS}`,
    [p.id, tenantId, p.examTypeId, p.trackCode, p.code, p.label, p.coefficient, p.scaleMax, p.isOptional, p.ordinal, p.sourceKind],
  );
  return toPaper(r as PaperSql);
}
export async function updatePaper(tx: Tx, typeId: string, id: string, patch: { label?: string; coefficient?: string; scaleMax?: string; isOptional?: boolean; ordinal?: number; active?: boolean }): Promise<ExamPaperRow | null> {
  const r = await tx.queryOne<PaperSql>(
    `UPDATE examinations.exam_papers SET label = COALESCE($3, label), coefficient = COALESCE($4::numeric, coefficient), scale_max = COALESCE($5::numeric, scale_max),
       is_optional = COALESCE($6, is_optional), ordinal = COALESCE($7, ordinal), active = COALESCE($8, active)
     WHERE exam_type_id = $1 AND id = $2 RETURNING ${PAPER_COLS}`,
    [typeId, id, patch.label ?? null, patch.coefficient ?? null, patch.scaleMax ?? null, patch.isOptional ?? null, patch.ordinal ?? null, patch.active ?? null],
  );
  return r ? toPaper(r) : null;
}

// ------------------------------------------------------------------ pièces exigées

interface ReqSql { id: string; exam_type_id: string; code: string; label: string; required: boolean; sort_order: number; source_kind: SourceKind; active: boolean }
const toReq = (r: ReqSql): DocumentRequirementRow => ({ id: r.id, examTypeId: r.exam_type_id, code: r.code, label: r.label, required: r.required, sortOrder: r.sort_order, sourceKind: r.source_kind, active: r.active });
const REQ_COLS = `id, exam_type_id, code, label, required, sort_order, source_kind, active`;

export async function listRequirements(tx: Tx, typeId: string): Promise<DocumentRequirementRow[]> {
  return (await tx.many<ReqSql>(`SELECT ${REQ_COLS} FROM examinations.document_requirements WHERE exam_type_id = $1 ORDER BY sort_order, code`, [typeId])).map(toReq);
}
export async function getRequirement(tx: Tx, typeId: string, id: string): Promise<DocumentRequirementRow | null> {
  const r = await tx.queryOne<ReqSql>(`SELECT ${REQ_COLS} FROM examinations.document_requirements WHERE exam_type_id = $1 AND id = $2`, [typeId, id]);
  return r ? toReq(r) : null;
}
export async function insertRequirement(tx: Tx, tenantId: string, q: Omit<DocumentRequirementRow, "active">): Promise<DocumentRequirementRow> {
  const r = await tx.queryOne<ReqSql>(
    `INSERT INTO examinations.document_requirements (id, tenant_id, exam_type_id, code, label, required, sort_order, source_kind) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${REQ_COLS}`,
    [q.id, tenantId, q.examTypeId, q.code, q.label, q.required, q.sortOrder, q.sourceKind],
  );
  return toReq(r as ReqSql);
}
export async function updateRequirement(tx: Tx, typeId: string, id: string, patch: { label?: string; required?: boolean; sortOrder?: number; active?: boolean }): Promise<DocumentRequirementRow | null> {
  const r = await tx.queryOne<ReqSql>(
    `UPDATE examinations.document_requirements SET label = COALESCE($3, label), required = COALESCE($4, required), sort_order = COALESCE($5, sort_order), active = COALESCE($6, active)
     WHERE exam_type_id = $1 AND id = $2 RETURNING ${REQ_COLS}`,
    [typeId, id, patch.label ?? null, patch.required ?? null, patch.sortOrder ?? null, patch.active ?? null],
  );
  return r ? toReq(r) : null;
}

// ------------------------------------------------------------------ centres et salles

interface CenterSql { id: string; code: string; name: string; kind: "OWN" | "HOST"; authority_code: string | null; locality: string | null; status: "ACTIVE" | "INACTIVE" }
const toCenter = (r: CenterSql): CenterRow => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, authorityCode: r.authority_code, locality: r.locality, status: r.status });
const CENTER_COLS = `id, code, name, kind, authority_code, locality, status`;

export async function listCenters(tx: Tx): Promise<CenterRow[]> {
  return (await tx.many<CenterSql>(`SELECT ${CENTER_COLS} FROM examinations.centers ORDER BY code`)).map(toCenter);
}
export async function getCenter(tx: Tx, id: string): Promise<CenterRow | null> {
  const r = await tx.queryOne<CenterSql>(`SELECT ${CENTER_COLS} FROM examinations.centers WHERE id = $1`, [id]);
  return r ? toCenter(r) : null;
}
export async function insertCenter(tx: Tx, tenantId: string, c: Omit<CenterRow, "status">): Promise<CenterRow> {
  const r = await tx.queryOne<CenterSql>(
    `INSERT INTO examinations.centers (id, tenant_id, code, name, kind, authority_code, locality) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CENTER_COLS}`,
    [c.id, tenantId, c.code, c.name, c.kind, c.authorityCode, c.locality],
  );
  return toCenter(r as CenterSql);
}
export async function updateCenter(tx: Tx, id: string, patch: { name?: string; authorityCode?: string | null; locality?: string | null; status?: "ACTIVE" | "INACTIVE" }): Promise<CenterRow | null> {
  const r = await tx.queryOne<CenterSql>(
    `UPDATE examinations.centers SET name = COALESCE($2, name),
       authority_code = CASE WHEN $3::boolean THEN $4 ELSE authority_code END,
       locality = CASE WHEN $5::boolean THEN $6 ELSE locality END,
       status = COALESCE($7, status)
     WHERE id = $1 RETURNING ${CENTER_COLS}`,
    [id, patch.name ?? null, "authorityCode" in patch, patch.authorityCode ?? null, "locality" in patch, patch.locality ?? null, patch.status ?? null],
  );
  return r ? toCenter(r) : null;
}

interface RoomSql { id: string; center_id: string; code: string; label: string | null; capacity: number; active: boolean }
const toRoom = (r: RoomSql): RoomRow => ({ id: r.id, centerId: r.center_id, code: r.code, label: r.label, capacity: r.capacity, active: r.active });
const ROOM_COLS = `id, center_id, code, label, capacity, active`;

export async function listRooms(tx: Tx, centerId?: string): Promise<RoomRow[]> {
  return (await tx.many<RoomSql>(`SELECT ${ROOM_COLS} FROM examinations.rooms WHERE ($1::uuid IS NULL OR center_id = $1) ORDER BY center_id, code`, [centerId ?? null])).map(toRoom);
}
export async function getRoom(tx: Tx, id: string): Promise<RoomRow | null> {
  const r = await tx.queryOne<RoomSql>(`SELECT ${ROOM_COLS} FROM examinations.rooms WHERE id = $1`, [id]);
  return r ? toRoom(r) : null;
}
export async function insertRoom(tx: Tx, tenantId: string, room: Omit<RoomRow, "active">): Promise<RoomRow> {
  const r = await tx.queryOne<RoomSql>(`INSERT INTO examinations.rooms (id, tenant_id, center_id, code, label, capacity) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ROOM_COLS}`, [room.id, tenantId, room.centerId, room.code, room.label, room.capacity]);
  return toRoom(r as RoomSql);
}
export async function updateRoom(tx: Tx, id: string, patch: { label?: string | null; capacity?: number; active?: boolean }): Promise<RoomRow | null> {
  const r = await tx.queryOne<RoomSql>(
    `UPDATE examinations.rooms SET label = CASE WHEN $2::boolean THEN $3 ELSE label END, capacity = COALESCE($4, capacity), active = COALESCE($5, active) WHERE id = $1 RETURNING ${ROOM_COLS}`,
    [id, "label" in patch, patch.label ?? null, patch.capacity ?? null, patch.active ?? null],
  );
  return r ? toRoom(r) : null;
}

// ------------------------------------------------------------------ formats d'export

interface ExportFormatSql {
  id: string; code: string; version: number; label: string; exam_type_id: string | null; kind: ExportFormatRow["kind"]; file_format: ExportFormatRow["fileFormat"]; encoding: ExportFormatRow["encoding"];
  delimiter: string | null; columns: ExportColumn[]; status: FormatStatus; source_kind: SourceKind; source_reference: string | null; published_at: Date | null; created_at: Date;
}
const EXPORT_FORMAT_COLS = `id, code, version, label, exam_type_id, kind, file_format, encoding, delimiter, columns, status, source_kind, source_reference, published_at, created_at`;
const toExportFormat = (r: ExportFormatSql): ExportFormatRow => ({
  id: r.id, code: r.code, version: r.version, label: r.label, examTypeId: r.exam_type_id, kind: r.kind, fileFormat: r.file_format, encoding: r.encoding, delimiter: r.delimiter,
  columns: r.columns, status: r.status, sourceKind: r.source_kind, sourceReference: r.source_reference, publishedAt: r.published_at, createdAt: r.created_at,
});

export async function listExportFormats(tx: Tx, filter: { status?: FormatStatus; kind?: string } = {}): Promise<ExportFormatRow[]> {
  return (await tx.many<ExportFormatSql>(`SELECT ${EXPORT_FORMAT_COLS} FROM examinations.export_formats WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR kind = $2) ORDER BY code, version DESC`, [filter.status ?? null, filter.kind ?? null])).map(toExportFormat);
}
export async function getExportFormat(tx: Tx, id: string): Promise<ExportFormatRow | null> {
  const r = await tx.queryOne<ExportFormatSql>(`SELECT ${EXPORT_FORMAT_COLS} FROM examinations.export_formats WHERE id = $1`, [id]);
  return r ? toExportFormat(r) : null;
}
export async function maxExportFormatVersion(tx: Tx, code: string): Promise<number> {
  const r = await tx.queryOne<{ v: number | null }>(`SELECT max(version)::int AS v FROM examinations.export_formats WHERE code = $1`, [code]);
  return r?.v ?? 0;
}
export async function insertExportFormat(tx: Tx, tenantId: string, f: Omit<ExportFormatRow, "status" | "publishedAt" | "createdAt">): Promise<ExportFormatRow> {
  const r = await tx.queryOne<ExportFormatSql>(
    `INSERT INTO examinations.export_formats (id, tenant_id, code, version, label, exam_type_id, kind, file_format, encoding, delimiter, columns, source_kind, source_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13) RETURNING ${EXPORT_FORMAT_COLS}`,
    [f.id, tenantId, f.code, f.version, f.label, f.examTypeId, f.kind, f.fileFormat, f.encoding, f.delimiter, JSON.stringify(f.columns), f.sourceKind, f.sourceReference],
  );
  return toExportFormat(r as ExportFormatSql);
}
export async function updateExportFormatDraft(tx: Tx, id: string, f: Partial<Omit<ExportFormatRow, "id" | "code" | "version" | "status" | "publishedAt" | "createdAt">>): Promise<ExportFormatRow | null> {
  const r = await tx.queryOne<ExportFormatSql>(
    `UPDATE examinations.export_formats SET
       label = COALESCE($2, label),
       exam_type_id = CASE WHEN $3::boolean THEN $4::uuid ELSE exam_type_id END,
       kind = COALESCE($5, kind), file_format = COALESCE($6, file_format), encoding = COALESCE($7, encoding),
       delimiter = CASE WHEN $8::boolean THEN $9 ELSE delimiter END,
       columns = COALESCE($10::jsonb, columns), source_kind = COALESCE($11, source_kind),
       source_reference = CASE WHEN $12::boolean THEN $13 ELSE source_reference END
     WHERE id = $1 RETURNING ${EXPORT_FORMAT_COLS}`,
    [id, f.label ?? null, "examTypeId" in f, f.examTypeId ?? null, f.kind ?? null, f.fileFormat ?? null, f.encoding ?? null, "delimiter" in f, f.delimiter ?? null, f.columns ? JSON.stringify(f.columns) : null, f.sourceKind ?? null, "sourceReference" in f, f.sourceReference ?? null],
  );
  return r ? toExportFormat(r) : null;
}
export async function setExportFormatStatus(tx: Tx, id: string, status: "PUBLISHED" | "RETIRED"): Promise<ExportFormatRow | null> {
  const r = await tx.queryOne<ExportFormatSql>(
    `UPDATE examinations.export_formats SET status = $2, published_at = CASE WHEN $2 = 'PUBLISHED' THEN now() ELSE published_at END WHERE id = $1 RETURNING ${EXPORT_FORMAT_COLS}`,
    [id, status],
  );
  return r ? toExportFormat(r) : null;
}
/** Retire le format publié du même code (avant d'en publier un autre : un seul publié par code). */
export async function retirePublishedExportFormat(tx: Tx, code: string): Promise<void> {
  await tx.query(`UPDATE examinations.export_formats SET status = 'RETIRED' WHERE code = $1 AND status = 'PUBLISHED'`, [code]);
}

// ------------------------------------------------------------------ formats d'import

interface ImportFormatSql {
  id: string; code: string; version: number; label: string; exam_type_id: string | null; kind: ImportFormatRow["kind"]; encoding: ImportFormatRow["encoding"]; delimiter: string; decimal_separator: "." | ",";
  has_header: boolean; columns: ImportColumn[]; value_map: Record<string, Record<string, string>>; status: FormatStatus; source_kind: SourceKind; source_reference: string | null; published_at: Date | null; created_at: Date;
}
const IMPORT_FORMAT_COLS = `id, code, version, label, exam_type_id, kind, encoding, delimiter, decimal_separator, has_header, columns, value_map, status, source_kind, source_reference, published_at, created_at`;
const toImportFormat = (r: ImportFormatSql): ImportFormatRow => ({
  id: r.id, code: r.code, version: r.version, label: r.label, examTypeId: r.exam_type_id, kind: r.kind, encoding: r.encoding, delimiter: r.delimiter, decimalSeparator: r.decimal_separator,
  hasHeader: r.has_header, columns: r.columns, valueMap: r.value_map, status: r.status, sourceKind: r.source_kind, sourceReference: r.source_reference, publishedAt: r.published_at, createdAt: r.created_at,
});

export async function listImportFormats(tx: Tx, filter: { status?: FormatStatus; kind?: string } = {}): Promise<ImportFormatRow[]> {
  return (await tx.many<ImportFormatSql>(`SELECT ${IMPORT_FORMAT_COLS} FROM examinations.import_formats WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR kind = $2) ORDER BY code, version DESC`, [filter.status ?? null, filter.kind ?? null])).map(toImportFormat);
}
export async function getImportFormat(tx: Tx, id: string): Promise<ImportFormatRow | null> {
  const r = await tx.queryOne<ImportFormatSql>(`SELECT ${IMPORT_FORMAT_COLS} FROM examinations.import_formats WHERE id = $1`, [id]);
  return r ? toImportFormat(r) : null;
}
export async function getImportFormatByRef(tx: Tx, code: string, version: number): Promise<ImportFormatRow | null> {
  const r = await tx.queryOne<ImportFormatSql>(`SELECT ${IMPORT_FORMAT_COLS} FROM examinations.import_formats WHERE code = $1 AND version = $2`, [code, version]);
  return r ? toImportFormat(r) : null;
}
export async function maxImportFormatVersion(tx: Tx, code: string): Promise<number> {
  const r = await tx.queryOne<{ v: number | null }>(`SELECT max(version)::int AS v FROM examinations.import_formats WHERE code = $1`, [code]);
  return r?.v ?? 0;
}
export async function insertImportFormat(tx: Tx, tenantId: string, f: Omit<ImportFormatRow, "status" | "publishedAt" | "createdAt">): Promise<ImportFormatRow> {
  const r = await tx.queryOne<ImportFormatSql>(
    `INSERT INTO examinations.import_formats (id, tenant_id, code, version, label, exam_type_id, kind, encoding, delimiter, decimal_separator, has_header, columns, value_map, source_kind, source_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15) RETURNING ${IMPORT_FORMAT_COLS}`,
    [f.id, tenantId, f.code, f.version, f.label, f.examTypeId, f.kind, f.encoding, f.delimiter, f.decimalSeparator, f.hasHeader, JSON.stringify(f.columns), JSON.stringify(f.valueMap), f.sourceKind, f.sourceReference],
  );
  return toImportFormat(r as ImportFormatSql);
}
export async function updateImportFormatDraft(tx: Tx, id: string, f: Partial<Omit<ImportFormatRow, "id" | "code" | "version" | "status" | "publishedAt" | "createdAt">>): Promise<ImportFormatRow | null> {
  const r = await tx.queryOne<ImportFormatSql>(
    `UPDATE examinations.import_formats SET
       label = COALESCE($2, label),
       exam_type_id = CASE WHEN $3::boolean THEN $4::uuid ELSE exam_type_id END,
       kind = COALESCE($5, kind), encoding = COALESCE($6, encoding), delimiter = COALESCE($7, delimiter),
       decimal_separator = COALESCE($8, decimal_separator), has_header = COALESCE($9, has_header),
       columns = COALESCE($10::jsonb, columns), value_map = COALESCE($11::jsonb, value_map), source_kind = COALESCE($12, source_kind),
       source_reference = CASE WHEN $13::boolean THEN $14 ELSE source_reference END
     WHERE id = $1 RETURNING ${IMPORT_FORMAT_COLS}`,
    [id, f.label ?? null, "examTypeId" in f, f.examTypeId ?? null, f.kind ?? null, f.encoding ?? null, f.delimiter ?? null, f.decimalSeparator ?? null, f.hasHeader ?? null, f.columns ? JSON.stringify(f.columns) : null, f.valueMap ? JSON.stringify(f.valueMap) : null, f.sourceKind ?? null, "sourceReference" in f, f.sourceReference ?? null],
  );
  return r ? toImportFormat(r) : null;
}
export async function setImportFormatStatus(tx: Tx, id: string, status: "PUBLISHED" | "RETIRED"): Promise<ImportFormatRow | null> {
  const r = await tx.queryOne<ImportFormatSql>(
    `UPDATE examinations.import_formats SET status = $2, published_at = CASE WHEN $2 = 'PUBLISHED' THEN now() ELSE published_at END WHERE id = $1 RETURNING ${IMPORT_FORMAT_COLS}`,
    [id, status],
  );
  return r ? toImportFormat(r) : null;
}
export async function retirePublishedImportFormat(tx: Tx, code: string): Promise<void> {
  await tx.query(`UPDATE examinations.import_formats SET status = 'RETIRED' WHERE code = $1 AND status = 'PUBLISHED'`, [code]);
}
