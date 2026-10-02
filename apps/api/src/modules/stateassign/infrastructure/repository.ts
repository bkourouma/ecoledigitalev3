/**
 * Dépôts SQL de stateassign : réglages, dossiers, historique, contrôles, documents. Une fonction par requête, SQL paramétré,
 * `Tx` reçu en paramètre (RLS : aucun filtre de tenant n'est nécessaire, `tenant_id` n'est écrit qu'à l'insertion).
 *
 * Les gardes de la base (2301) imposent l'acteur humain, les transitions, la séparation des tâches ; ces fonctions n'essaient pas
 * de les contourner. Les refus de la base sont traduits par `translating` (db-errors).
 */
import type { Tx } from "@ecoledigitale/database";
import type { Money } from "@ecoledigitale/kernel";
import { translating } from "./db-errors";
import {
  ASSIGNMENT_COLS,
  ASSIGNMENT_EVENT_COLS,
  CONTROL_COLS,
  controlCols,
  DOCUMENT_COLS,
  SETTINGS_COLS,
  assignmentEventOf,
  assignmentOf,
  controlOf,
  documentOf,
  settingsOf,
} from "./rows";
import {
  DEFAULT_SETTINGS,
  type AssignmentEventRecord,
  type AssignmentRecord,
  type AssignmentSource,
  type AssignmentStatus,
  type ControlKind,
  type ControlRecord,
  type DocumentRecord,
  type IsoDate,
  type ReconciliationStatus,
  type SettingsRecord,
  type Uuid,
} from "../domain/types";

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export async function getSettings(tx: Tx, institutionId: Uuid): Promise<SettingsRecord> {
  const row = await tx.queryOne(`SELECT ${SETTINGS_COLS} FROM stateassign.settings WHERE institution_id = $1`, [institutionId]);
  return row ? settingsOf(row) : DEFAULT_SETTINGS(institutionId);
}

export async function upsertSettings(
  tx: Tx,
  tenantId: Uuid,
  institutionId: Uuid,
  s: { requireSeparateVerifier: boolean; reconciliationTolerance: number; requiredControlKinds: readonly ControlKind[]; controlDueOffsetDays: number | null; receivableGraceDays: number },
): Promise<SettingsRecord> {
  return translating(async () => {
    const row = await tx.queryOne(
      `INSERT INTO stateassign.settings (tenant_id, institution_id, require_separate_verifier, reconciliation_tolerance, required_control_kinds, control_due_offset_days, receivable_grace_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, institution_id) DO UPDATE SET require_separate_verifier = EXCLUDED.require_separate_verifier,
         reconciliation_tolerance = EXCLUDED.reconciliation_tolerance, required_control_kinds = EXCLUDED.required_control_kinds,
         control_due_offset_days = EXCLUDED.control_due_offset_days, receivable_grace_days = EXCLUDED.receivable_grace_days
       RETURNING ${SETTINGS_COLS}`,
      [tenantId, institutionId, s.requireSeparateVerifier, s.reconciliationTolerance, [...s.requiredControlKinds], s.controlDueOffsetDays, s.receivableGraceDays],
    );
    return settingsOf(row!);
  });
}

// ---------------------------------------------------------------------------
// Dossiers
// ---------------------------------------------------------------------------

export interface NewAssignment {
  readonly id: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly version: number;
  readonly supersedesId: Uuid | null;
  readonly reference: string;
  readonly issuedOn: IsoDate | null;
  readonly issuingAuthority: string | null;
  readonly source: AssignmentSource;
  readonly externalRef: string | null;
  readonly externalPayloadHash: string | null;
  readonly declaredState: Money | null;
  readonly declaredParent: Money | null;
  readonly currency: string;
  readonly receivedBy: Uuid | null;
  readonly notes: string | null;
}

export async function insertAssignment(tx: Tx, tenantId: Uuid, a: NewAssignment): Promise<AssignmentRecord> {
  return translating(async () => {
    const row = await tx.queryOne(
      `INSERT INTO stateassign.assignments (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, version, supersedes_id,
         assignment_reference, issued_on, issuing_authority, source, external_ref, external_payload_hash, declared_state_amount,
         declared_parent_amount, currency, received_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING ${ASSIGNMENT_COLS}`,
      [
        a.id, tenantId, a.institutionId, a.academicYearId, a.enrollmentId, a.studentId, a.version, a.supersedesId, a.reference, a.issuedOn,
        a.issuingAuthority, a.source, a.externalRef, a.externalPayloadHash, a.declaredState?.amount ?? null, a.declaredParent?.amount ?? null,
        a.currency, a.receivedBy, a.notes,
      ],
    );
    return assignmentOf(row!);
  });
}

export async function getAssignment(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<AssignmentRecord | null> {
  const row = await tx.queryOne(`SELECT ${ASSIGNMENT_COLS} FROM stateassign.assignments WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? assignmentOf(row) : null;
}

export async function getLiveAssignmentOfEnrollment(tx: Tx, enrollmentId: Uuid): Promise<AssignmentRecord | null> {
  const row = await tx.queryOne(
    `SELECT ${ASSIGNMENT_COLS} FROM stateassign.assignments WHERE enrollment_id = $1 AND status IN ('RECEIVED','VERIFIED','ACTIVE','SUSPENDED')`,
    [enrollmentId],
  );
  return row ? assignmentOf(row) : null;
}

/** Dossier de référence d'une inscription : le plus récent version vérifiée ou après, sinon le vivant (créances, rapprochement). */
export async function getCurrentAssignmentOfEnrollment(tx: Tx, enrollmentId: Uuid): Promise<AssignmentRecord | null> {
  const row = await tx.queryOne(
    `SELECT ${ASSIGNMENT_COLS} FROM stateassign.assignments
      WHERE enrollment_id = $1 AND status IN ('VERIFIED','ACTIVE','SUSPENDED','ENDED','TRANSFERRED')
      ORDER BY version DESC LIMIT 1`,
    [enrollmentId],
  );
  return row ? assignmentOf(row) : null;
}

export async function listVersionsOfEnrollment(tx: Tx, enrollmentId: Uuid): Promise<AssignmentRecord[]> {
  const rows = await tx.many(`SELECT ${ASSIGNMENT_COLS} FROM stateassign.assignments WHERE enrollment_id = $1 ORDER BY version, created_at`, [enrollmentId]);
  return rows.map(assignmentOf);
}

export interface AssignmentFilter {
  institutionId?: Uuid | undefined;
  academicYearId?: Uuid | undefined;
  studentId?: Uuid | undefined;
  enrollmentId?: Uuid | undefined;
  status?: AssignmentStatus | undefined;
  reconciliationStatus?: ReconciliationStatus | undefined;
  q?: string | undefined;
  includeHistory?: boolean | undefined;
  limit: number;
  offset: number;
}

const FILTER_WHERE = `($1::uuid IS NULL OR institution_id = $1) AND ($2::uuid IS NULL OR academic_year_id = $2)
  AND ($3::uuid IS NULL OR student_id = $3) AND ($4::uuid IS NULL OR enrollment_id = $4) AND ($5::text IS NULL OR status = $5)
  AND ($6::text IS NULL OR reconciliation_status = $6) AND ($7::text IS NULL OR assignment_reference ILIKE $7 ESCAPE '\\')
  AND ($8::boolean OR status NOT IN ('REJECTED','SUPERSEDED') OR $5::text IS NOT NULL)`;

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const filterParams = (f: AssignmentFilter): unknown[] => [
  f.institutionId ?? null, f.academicYearId ?? null, f.studentId ?? null, f.enrollmentId ?? null, f.status ?? null,
  f.reconciliationStatus ?? null, f.q ? `%${escapeLike(f.q)}%` : null, f.includeHistory === true,
];

export async function listAssignments(tx: Tx, f: AssignmentFilter): Promise<{ items: AssignmentRecord[]; total: number }> {
  const params = filterParams(f);
  const rows = await tx.many(
    `SELECT ${ASSIGNMENT_COLS} FROM stateassign.assignments WHERE ${FILTER_WHERE} ORDER BY received_at DESC, id DESC LIMIT $9 OFFSET $10`,
    [...params, f.limit, f.offset],
  );
  const count = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM stateassign.assignments WHERE ${FILTER_WHERE}`, params);
  return { items: rows.map(assignmentOf), total: Number(count?.n ?? 0) };
}

export interface AssignmentPatch {
  reference?: string;
  issuedOn?: IsoDate | null;
  issuingAuthority?: string | null;
  declaredState?: Money | null;
  declaredParent?: Money | null;
  notes?: string | null;
}

/** Correction d'un dossier RECEIVED (la base fige le fond dès la vérification). `expectedRowVersion` : concurrence optimiste. */
export async function patchAssignment(tx: Tx, id: Uuid, patch: AssignmentPatch, expectedRowVersion: number | null): Promise<AssignmentRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [id, expectedRowVersion];
  const add = (col: string, value: unknown): void => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.reference !== undefined) add("assignment_reference", patch.reference);
  if (patch.issuedOn !== undefined) add("issued_on", patch.issuedOn);
  if (patch.issuingAuthority !== undefined) add("issuing_authority", patch.issuingAuthority);
  if (patch.declaredState !== undefined) add("declared_state_amount", patch.declaredState?.amount ?? null);
  if (patch.declaredParent !== undefined) add("declared_parent_amount", patch.declaredParent?.amount ?? null);
  if (patch.notes !== undefined) add("notes", patch.notes);
  if (sets.length === 0) return getAssignment(tx, id);
  return translating(async () => {
    const row = await tx.queryOne(
      `UPDATE stateassign.assignments SET ${sets.join(", ")} WHERE id = $1 AND ($2::int IS NULL OR row_version = $2) RETURNING ${ASSIGNMENT_COLS}`,
      params,
    );
    return row ? assignmentOf(row) : null;
  });
}

export type TransitionPatch =
  | { to: "VERIFIED"; note: string | null }
  | { to: "REJECTED"; reason: string }
  | { to: "ACTIVE" }
  | { to: "SUSPENDED"; reason: string }
  | { to: "ENDED" | "TRANSFERRED" | "SUPERSEDED"; endedOn: IsoDate; reason: string };

/** Change le statut (la base impose l'acteur humain, la transition et les champs de motif). `null` : conflit de version. */
export async function transitionAssignment(tx: Tx, id: Uuid, patch: TransitionPatch, expectedRowVersion: number | null): Promise<AssignmentRecord | null> {
  const sets = ["status = $3"];
  const params: unknown[] = [id, expectedRowVersion, patch.to];
  const add = (col: string, value: unknown): void => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.to === "VERIFIED") add("verification_note", patch.note);
  if (patch.to === "REJECTED") add("rejection_reason", patch.reason);
  if (patch.to === "SUSPENDED") add("suspension_reason", patch.reason);
  if (patch.to === "ENDED" || patch.to === "TRANSFERRED" || patch.to === "SUPERSEDED") {
    add("ended_on", patch.endedOn);
    add("end_reason", patch.reason);
  }
  return translating(async () => {
    const row = await tx.queryOne(
      `UPDATE stateassign.assignments SET ${sets.join(", ")} WHERE id = $1 AND ($2::int IS NULL OR row_version = $2) RETURNING ${ASSIGNMENT_COLS}`,
      params,
    );
    return row ? assignmentOf(row) : null;
  });
}

/** Écrit le rapprochement : écarts et date ; le STATUT est calculé par la base (un statut saisi serait ignoré). */
export async function writeReconciliation(
  tx: Tx,
  id: Uuid,
  r: { stateDelta: Money; parentDelta: Money; scholarshipId: Uuid | null; stateInvoiceId: Uuid | null; parentInvoiceId: Uuid | null },
): Promise<AssignmentRecord> {
  return translating(async () => {
    const row = await tx.queryOne(
      `UPDATE stateassign.assignments SET last_reconciled_at = now(), reconciled_state_delta = $2, reconciled_parent_delta = $3,
         finance_scholarship_id = $4, finance_state_invoice_id = $5, finance_parent_invoice_id = $6
       WHERE id = $1 RETURNING ${ASSIGNMENT_COLS}`,
      [id, r.stateDelta.amount, r.parentDelta.amount, r.scholarshipId, r.stateInvoiceId, r.parentInvoiceId],
    );
    return assignmentOf(row!);
  });
}

export async function listAssignmentEvents(tx: Tx, assignmentIds: readonly Uuid[]): Promise<AssignmentEventRecord[]> {
  if (assignmentIds.length === 0) return [];
  const rows = await tx.many(
    `SELECT ${ASSIGNMENT_EVENT_COLS} FROM stateassign.assignment_events WHERE assignment_id = ANY($1::uuid[]) ORDER BY occurred_at, id`,
    [[...assignmentIds]],
  );
  return rows.map(assignmentEventOf);
}

/** Dossiers à rapprocher (job) : vivants vérifiés ou après, ou terminés avec une créance encore ouverte. */
export async function listAssignmentsToReconcile(tx: Tx, limit: number, afterId: Uuid | null): Promise<AssignmentRecord[]> {
  const rows = await tx.many(
    `SELECT ${ASSIGNMENT_COLS} FROM stateassign.assignments a
      WHERE ($2::uuid IS NULL OR a.id > $2)
        AND (a.status IN ('ACTIVE','SUSPENDED')
             OR (a.status IN ('VERIFIED','ENDED','TRANSFERRED') AND EXISTS (
                  SELECT 1 FROM stateassign.receivables r WHERE r.tenant_id = a.tenant_id AND r.enrollment_id = a.enrollment_id
                    AND r.status IN ('OPEN','PARTIALLY_RECEIVED'))))
        AND a.version = (SELECT max(b.version) FROM stateassign.assignments b WHERE b.tenant_id = a.tenant_id AND b.enrollment_id = a.enrollment_id
                          AND b.status IN ('VERIFIED','ACTIVE','SUSPENDED','ENDED','TRANSFERRED'))
      ORDER BY a.id LIMIT $1`,
    [limit, afterId],
  );
  return rows.map(assignmentOf);
}

/** Dossiers vivants avec un contrôle à planifier (job `plan-controls`) : actifs ou suspendus. */
export async function listAssignmentsForControlPlanning(tx: Tx, limit: number, afterId: Uuid | null): Promise<AssignmentRecord[]> {
  const rows = await tx.many(
    `SELECT ${ASSIGNMENT_COLS} FROM stateassign.assignments WHERE status IN ('VERIFIED','ACTIVE','SUSPENDED') AND ($2::uuid IS NULL OR id > $2) ORDER BY id LIMIT $1`,
    [limit, afterId],
  );
  return rows.map(assignmentOf);
}

// ---------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------

export async function insertControl(
  tx: Tx,
  tenantId: Uuid,
  c: { id: Uuid; assignmentId: Uuid; kind: ControlKind; academicPeriodId: Uuid | null; dueOn: IsoDate; createdBy: Uuid | null },
): Promise<ControlRecord> {
  return translating(async () => {
    const row = await tx.queryOne(
      `INSERT INTO stateassign.controls (id, tenant_id, assignment_id, kind, academic_period_id, due_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${CONTROL_COLS}`,
      [c.id, tenantId, c.assignmentId, c.kind, c.academicPeriodId, c.dueOn, c.createdBy],
    );
    return controlOf(row!);
  });
}

export async function getControl(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<ControlRecord | null> {
  const row = await tx.queryOne(`SELECT ${CONTROL_COLS} FROM stateassign.controls WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? controlOf(row) : null;
}

export async function listControlsOfAssignments(tx: Tx, assignmentIds: readonly Uuid[]): Promise<ControlRecord[]> {
  if (assignmentIds.length === 0) return [];
  const rows = await tx.many(`SELECT ${CONTROL_COLS} FROM stateassign.controls WHERE assignment_id = ANY($1::uuid[]) ORDER BY due_on, id`, [[...assignmentIds]]);
  return rows.map(controlOf);
}

export async function listControlKeysOfAssignment(tx: Tx, assignmentId: Uuid): Promise<Array<{ kind: ControlKind; academicPeriodId: Uuid | null }>> {
  const rows = await tx.many<{ kind: ControlKind; academicPeriodId: Uuid | null }>(
    `SELECT kind, academic_period_id AS "academicPeriodId" FROM stateassign.controls WHERE assignment_id = $1`,
    [assignmentId],
  );
  return rows;
}

export async function resolveControl(
  tx: Tx,
  id: Uuid,
  patch:
    | { status: "OK" | "ANOMALY"; findings: string | null; evidence: Record<string, unknown> }
    | { status: "WAIVED"; findings: string }
    | { status: "OK"; resolution: string; findings?: undefined },
): Promise<ControlRecord> {
  return translating(async () => {
    let row;
    if ("resolution" in patch) {
      row = await tx.queryOne(`UPDATE stateassign.controls SET status = 'OK', anomaly_resolution = $2 WHERE id = $1 RETURNING ${CONTROL_COLS}`, [id, patch.resolution]);
    } else if (patch.status === "WAIVED") {
      row = await tx.queryOne(`UPDATE stateassign.controls SET status = 'WAIVED', findings = $2 WHERE id = $1 RETURNING ${CONTROL_COLS}`, [id, patch.findings]);
    } else {
      row = await tx.queryOne(
        `UPDATE stateassign.controls SET status = $2, findings = $3, evidence = $4::jsonb WHERE id = $1 RETURNING ${CONTROL_COLS}`,
        [id, patch.status, patch.findings, JSON.stringify(patch.evidence)],
      );
    }
    return controlOf(row!);
  });
}

export async function markControlDueNotified(tx: Tx, id: Uuid): Promise<boolean> {
  const r = await tx.query(`UPDATE stateassign.controls SET due_notified_at = now() WHERE id = $1 AND due_notified_at IS NULL AND status = 'PENDING'`, [id]);
  return r.rowCount === 1;
}

/** Contrôles à faire dont l'échéance est atteinte et jamais signalés (job). */
export async function listControlsDueUnnotified(tx: Tx, today: IsoDate, limit: number): Promise<Array<ControlRecord & { enrollmentId: Uuid; studentId: Uuid; institutionId: Uuid }>> {
  const rows = await tx.many(
    `SELECT ${controlCols("c.")}, a.enrollment_id AS "enrollmentId", a.student_id AS "studentId", a.institution_id AS "institutionId"
       FROM stateassign.controls c JOIN stateassign.assignments a ON a.tenant_id = c.tenant_id AND a.id = c.assignment_id
      WHERE c.status = 'PENDING' AND c.due_notified_at IS NULL AND c.due_on <= $1::date ORDER BY c.due_on, c.id LIMIT $2`,
    [today, limit],
  );
  return rows.map((r) => ({ ...controlOf(r), enrollmentId: r.enrollmentId, studentId: r.studentId, institutionId: r.institutionId }));
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function insertDocument(
  tx: Tx,
  tenantId: Uuid,
  d: { id: Uuid; assignmentId: Uuid; kind: string; documentRef: Uuid; label: string | null; receivedOn: IsoDate | null; addedBy: Uuid },
): Promise<DocumentRecord> {
  return translating(async () => {
    const row = await tx.queryOne(
      `INSERT INTO stateassign.documents (id, tenant_id, assignment_id, kind, document_ref, label, received_on, added_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${DOCUMENT_COLS}`,
      [d.id, tenantId, d.assignmentId, d.kind, d.documentRef, d.label, d.receivedOn, d.addedBy],
    );
    return documentOf(row!);
  });
}

export async function getDocumentRow(tx: Tx, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<DocumentRecord | null> {
  const row = await tx.queryOne(`SELECT ${DOCUMENT_COLS} FROM stateassign.documents WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? documentOf(row) : null;
}

export async function listDocumentsOfAssignments(tx: Tx, assignmentIds: readonly Uuid[]): Promise<DocumentRecord[]> {
  if (assignmentIds.length === 0) return [];
  const rows = await tx.many(`SELECT ${DOCUMENT_COLS} FROM stateassign.documents WHERE assignment_id = ANY($1::uuid[]) ORDER BY created_at, id`, [[...assignmentIds]]);
  return rows.map(documentOf);
}

export async function withdrawDocument(tx: Tx, id: Uuid, reason: string): Promise<DocumentRecord> {
  return translating(async () => {
    const row = await tx.queryOne(`UPDATE stateassign.documents SET status = 'WITHDRAWN', withdrawn_reason = $2 WHERE id = $1 RETURNING ${DOCUMENT_COLS}`, [id, reason]);
    return documentOf(row!);
  });
}
