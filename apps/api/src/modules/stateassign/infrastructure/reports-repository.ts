/**
 * Lectures de suivi (tableau de bord, états de contrôle et de rapprochement) et formats d'export.
 * Agrégats calculés en SQL sur des entiers (`bigint` en `::text`) ; aucune valeur n'est recalculée côté client.
 */
import type { Tx } from "@ecoledigitale/database";
import { translating } from "./db-errors";
import { EXPORT_FORMAT_COLS, controlCols, controlOf, exportFormatOf } from "./rows";
import type { AssignmentStatus, ControlKind, ControlRecord, ControlStatus, ExportDataset, ExportFormatRecord, IsoDate, ReconciliationStatus, Uuid } from "../domain/types";

export interface SummaryRaw {
  assignmentsByStatus: Record<string, number>;
  declaredState: number;
  declaredParent: number;
  currency: string;
  controls: { pending: number; overdue: number; anomalies: number };
  reconciliation: { never: number; balanced: number; discrepancy: number };
}

const FOLLOWED: readonly AssignmentStatus[] = ["VERIFIED", "ACTIVE", "SUSPENDED", "ENDED", "TRANSFERRED"];

/** Tableau de bord : dossiers par statut ; montants déclarés des dossiers vérifiés ou après ; contrôles ; rapprochement des dossiers actifs. */
export async function summary(tx: Tx, f: { institutionId?: Uuid | undefined; academicYearId?: Uuid | undefined; today: IsoDate }): Promise<SummaryRaw> {
  const p = [f.institutionId ?? null, f.academicYearId ?? null];
  const where = `($1::uuid IS NULL OR institution_id = $1) AND ($2::uuid IS NULL OR academic_year_id = $2)`;
  const byStatus = await tx.many<{ status: string; n: string }>(`SELECT status, count(*)::text AS n FROM stateassign.assignments WHERE ${where} GROUP BY status`, p);
  const sums = await tx.queryOne<{ s: string; p: string; c: string | null }>(
    `SELECT coalesce(sum(declared_state_amount), 0)::text AS s, coalesce(sum(declared_parent_amount), 0)::text AS p, min(currency) AS c
       FROM stateassign.assignments WHERE ${where} AND status = ANY($3::text[])`,
    [...p, [...FOLLOWED]],
  );
  const recon = await tx.many<{ s: string; n: string }>(
    `SELECT reconciliation_status AS s, count(*)::text AS n FROM stateassign.assignments WHERE ${where} AND status NOT IN ('REJECTED','SUPERSEDED') GROUP BY 1`,
    p,
  );
  const ctrl = await tx.queryOne<{ pending: string; overdue: string; anomalies: string }>(
    `SELECT count(*) FILTER (WHERE c.status = 'PENDING')::text AS pending,
            count(*) FILTER (WHERE c.status = 'PENDING' AND c.due_on < $3::date)::text AS overdue,
            count(*) FILTER (WHERE c.status = 'ANOMALY')::text AS anomalies
       FROM stateassign.controls c JOIN stateassign.assignments a ON a.tenant_id = c.tenant_id AND a.id = c.assignment_id
      WHERE ($1::uuid IS NULL OR a.institution_id = $1) AND ($2::uuid IS NULL OR a.academic_year_id = $2)`,
    [...p, f.today],
  );
  const rc = (key: string): number => Number(recon.find((r) => r.s === key)?.n ?? 0);
  return {
    assignmentsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
    declaredState: Number(sums?.s ?? 0),
    declaredParent: Number(sums?.p ?? 0),
    currency: sums?.c ?? "XOF",
    controls: { pending: Number(ctrl?.pending ?? 0), overdue: Number(ctrl?.overdue ?? 0), anomalies: Number(ctrl?.anomalies ?? 0) },
    reconciliation: { never: rc("NEVER"), balanced: rc("BALANCED"), discrepancy: rc("DISCREPANCY") },
  };
}

export async function reconciliationCounts(tx: Tx, f: { institutionId?: Uuid | undefined; academicYearId?: Uuid | undefined }): Promise<{ never: number; balanced: number; discrepancy: number }> {
  const rows = await tx.many<{ s: ReconciliationStatus; n: string }>(
    `SELECT reconciliation_status AS s, count(*)::text AS n FROM stateassign.assignments
      WHERE ($1::uuid IS NULL OR institution_id = $1) AND ($2::uuid IS NULL OR academic_year_id = $2) AND status NOT IN ('REJECTED','SUPERSEDED')
      GROUP BY 1`,
    [f.institutionId ?? null, f.academicYearId ?? null],
  );
  const n = (k: ReconciliationStatus): number => Number(rows.find((r) => r.s === k)?.n ?? 0);
  return { never: n("NEVER"), balanced: n("BALANCED"), discrepancy: n("DISCREPANCY") };
}

export interface ControlReportFilter {
  institutionId?: Uuid | undefined;
  academicYearId?: Uuid | undefined;
  status?: ControlStatus | undefined;
  kind?: ControlKind | undefined;
  overdueOnly?: boolean | undefined;
  today: IsoDate;
  limit: number;
  offset: number;
}

export interface ControlReportRow {
  readonly control: ControlRecord;
  readonly assignmentReference: string;
  readonly assignmentStatus: AssignmentStatus;
  readonly studentId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
}

const CTRL_WHERE = `($1::uuid IS NULL OR a.institution_id = $1) AND ($2::uuid IS NULL OR a.academic_year_id = $2) AND ($3::text IS NULL OR c.status = $3)
  AND ($4::text IS NULL OR c.kind = $4) AND (NOT $5::boolean OR (c.status = 'PENDING' AND c.due_on < $6::date))`;

export async function controlsReport(tx: Tx, f: ControlReportFilter): Promise<{ items: ControlReportRow[]; total: number }> {
  const p = [f.institutionId ?? null, f.academicYearId ?? null, f.status ?? null, f.kind ?? null, f.overdueOnly === true, f.today];
  const rows = await tx.many(
    `SELECT ${controlCols("c.")}, a.assignment_reference AS "assignmentReference", a.status AS "assignmentStatus", a.student_id AS "studentId",
            a.institution_id AS "institutionId", a.academic_year_id AS "academicYearId"
       FROM stateassign.controls c JOIN stateassign.assignments a ON a.tenant_id = c.tenant_id AND a.id = c.assignment_id
      WHERE ${CTRL_WHERE} ORDER BY c.due_on, c.id LIMIT $7 OFFSET $8`,
    [...p, f.limit, f.offset],
  );
  const count = await tx.queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM stateassign.controls c JOIN stateassign.assignments a ON a.tenant_id = c.tenant_id AND a.id = c.assignment_id WHERE ${CTRL_WHERE}`,
    p,
  );
  return {
    items: rows.map((r) => ({
      control: controlOf(r),
      assignmentReference: r.assignmentReference,
      assignmentStatus: r.assignmentStatus,
      studentId: r.studentId,
      institutionId: r.institutionId,
      academicYearId: r.academicYearId,
    })),
    total: Number(count?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Formats d'export
// ---------------------------------------------------------------------------

export async function insertExportFormat(
  tx: Tx,
  tenantId: Uuid,
  f: { id: Uuid; institutionId: Uuid; code: string; label: string; dataset: ExportDataset; columns: ReadonlyArray<{ key: string; header: string }>; delimiter: string; includeBom: boolean },
): Promise<ExportFormatRecord> {
  return translating(async () => {
    const row = await tx.queryOne(
      `INSERT INTO stateassign.export_formats (id, tenant_id, institution_id, code, label, dataset, columns, delimiter, include_bom)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING ${EXPORT_FORMAT_COLS}`,
      [f.id, tenantId, f.institutionId, f.code, f.label, f.dataset, JSON.stringify(f.columns), f.delimiter, f.includeBom],
    );
    return exportFormatOf(row!);
  });
}

export async function getExportFormat(tx: Tx, id: Uuid): Promise<ExportFormatRecord | null> {
  const row = await tx.queryOne(`SELECT ${EXPORT_FORMAT_COLS} FROM stateassign.export_formats WHERE id = $1`, [id]);
  return row ? exportFormatOf(row) : null;
}

export async function listExportFormats(tx: Tx, f: { institutionId?: Uuid | undefined; dataset?: ExportDataset | undefined }): Promise<ExportFormatRecord[]> {
  const rows = await tx.many(
    `SELECT ${EXPORT_FORMAT_COLS} FROM stateassign.export_formats WHERE ($1::uuid IS NULL OR institution_id = $1) AND ($2::text IS NULL OR dataset = $2) ORDER BY dataset, code`,
    [f.institutionId ?? null, f.dataset ?? null],
  );
  return rows.map(exportFormatOf);
}

export async function patchExportFormat(
  tx: Tx,
  id: Uuid,
  patch: { label?: string; columns?: ReadonlyArray<{ key: string; header: string }>; delimiter?: string; includeBom?: boolean; active?: boolean },
): Promise<ExportFormatRecord | null> {
  const sets: string[] = [];
  const p: unknown[] = [id];
  const add = (sql: string, v: unknown): void => {
    p.push(v);
    sets.push(sql.replace("?", `$${p.length}`));
  };
  if (patch.label !== undefined) add("label = ?", patch.label);
  if (patch.columns !== undefined) add("columns = ?::jsonb", JSON.stringify(patch.columns));
  if (patch.delimiter !== undefined) add("delimiter = ?", patch.delimiter);
  if (patch.includeBom !== undefined) add("include_bom = ?", patch.includeBom);
  if (patch.active !== undefined) add("active = ?", patch.active);
  if (sets.length === 0) return getExportFormat(tx, id);
  return translating(async () => {
    const row = await tx.queryOne(`UPDATE stateassign.export_formats SET ${sets.join(", ")} WHERE id = $1 RETURNING ${EXPORT_FORMAT_COLS}`, p);
    return row ? exportFormatOf(row) : null;
  });
}
