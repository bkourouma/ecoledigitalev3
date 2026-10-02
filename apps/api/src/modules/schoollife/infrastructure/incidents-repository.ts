/**
 * Incidents et implications. Les lectures filtrent par la règle SQL UNIQUE `schoollife.audience_may_see` (paramètre
 * `audience`) : aucune règle de visibilité n'est répliquée ici. Les écritures passent par les déclencheurs de la base
 * (acteur humain, machine à états, confidentialité jamais abaissée).
 */
import type { Tx } from "@ecoledigitale/database";
import type { IncidentRow, InvolvementRow } from "./rows";

const COLS = `i.id, i.institution_id AS "institutionId", i.academic_year_id AS "academicYearId", i.type_id AS "typeId", i.severity_code AS "severityCode",
  i.occurred_at AS "occurredAt", i.location, i.description, i.context_note AS "contextNote", i.status, i.confidentiality, i.reported_by AS "reportedBy",
  i.reported_by_name AS "reportedByName", i.assigned_to AS "assignedTo", i.resolution_note AS "resolutionNote", i.created_at AS "createdAt", i.closed_at AS "closedAt"`;

export interface NewIncident {
  id: string;
  tenantId: string;
  institutionId: string;
  academicYearId: string;
  typeId: string;
  severityCode: string | null;
  occurredAt: Date;
  location: string | null;
  description: string;
  contextNote: string | null;
  confidentiality: string;
  reportedBy: string;
  reportedByName: string;
  attendanceSessionId: string | null;
  clientKey?: string | null;
  clientFingerprint?: string | null;
}

export async function insertIncident(tx: Tx, i: NewIncident): Promise<void> {
  await tx.query(
    `INSERT INTO schoollife.incidents (id, tenant_id, institution_id, academic_year_id, type_id, severity_code, occurred_at, location, description, context_note,
        confidentiality, reported_by, reported_by_name, attendance_session_id, client_key, client_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [i.id, i.tenantId, i.institutionId, i.academicYearId, i.typeId, i.severityCode, i.occurredAt, i.location, i.description, i.contextNote, i.confidentiality, i.reportedBy, i.reportedByName, i.attendanceSessionId, i.clientKey ?? null, i.clientFingerprint ?? null],
  );
}

/** Incident déjà créé par ce déclarant avec cette clé de saisie (rejeu), avec l'empreinte de son contenu. */
export async function findIncidentByClientKey(tx: Tx, reportedBy: string, clientKey: string): Promise<{ id: string; fingerprint: string } | null> {
  return tx.queryOne<{ id: string; fingerprint: string }>(
    `SELECT id, client_fingerprint AS fingerprint FROM schoollife.incidents WHERE reported_by = $1 AND client_key = $2`,
    [reportedBy, clientKey],
  );
}

export async function insertInvolvement(tx: Tx, v: { id: string; tenantId: string; incidentId: string; enrollmentId: string; studentId: string; role: string; statement: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO schoollife.incident_involvements (id, tenant_id, incident_id, enrollment_id, student_id, role, statement) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [v.id, v.tenantId, v.incidentId, v.enrollmentId, v.studentId, v.role, v.statement],
  );
}

/** Incident (verrouillé en écriture si `lock`) ; sans filtre d'audience : l'appelant décide de l'accès. */
export async function getIncident(tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<IncidentRow | null> {
  return tx.queryOne<IncidentRow>(`SELECT ${COLS} FROM schoollife.incidents i WHERE i.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);
}

export async function listInvolvements(tx: Tx, incidentIds: readonly string[]): Promise<InvolvementRow[]> {
  if (incidentIds.length === 0) return [];
  return tx.many<InvolvementRow>(
    `SELECT id, incident_id AS "incidentId", enrollment_id AS "enrollmentId", student_id AS "studentId", role, statement
       FROM schoollife.incident_involvements WHERE incident_id = ANY($1::uuid[]) ORDER BY created_at, id`,
    [incidentIds],
  );
}

export interface IncidentFilter {
  audience: string;
  status?: string | undefined;
  studentId?: string | undefined;
  enrollmentIds?: readonly string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Restreint aux incidents déclarés par cet utilisateur (enseignant sans portée générale). */
  reportedBy?: string | undefined;
  openOnly?: boolean | undefined;
  limit: number;
  offset: number;
}

export async function listIncidents(tx: Tx, f: IncidentFilter): Promise<IncidentRow[]> {
  const where: string[] = [`schoollife.audience_may_see($1, 'INCIDENT', i.confidentiality, true, i.status, NULL)`];
  const params: unknown[] = [f.audience];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status) add("i.status = ?", f.status);
  if (f.openOnly) where.push(`i.status IN ('DECLARED', 'UNDER_REVIEW')`);
  if (f.reportedBy) add("i.reported_by = ?", f.reportedBy);
  if (f.from) add("i.occurred_at >= (?::date)::timestamptz", f.from);
  if (f.to) add("i.occurred_at < ((?::date) + 1)::timestamptz", f.to);
  if (f.studentId) add("EXISTS (SELECT 1 FROM schoollife.incident_involvements v WHERE v.tenant_id = i.tenant_id AND v.incident_id = i.id AND v.student_id = ?::uuid)", f.studentId);
  if (f.enrollmentIds) add("EXISTS (SELECT 1 FROM schoollife.incident_involvements v WHERE v.tenant_id = i.tenant_id AND v.incident_id = i.id AND v.enrollment_id = ANY(?::uuid[]))", f.enrollmentIds);
  params.push(f.limit, f.offset);
  return tx.many<IncidentRow>(
    `SELECT ${COLS} FROM schoollife.incidents i WHERE ${where.join(" AND ")} ORDER BY i.occurred_at DESC, i.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export interface IncidentUpdate {
  status?: string;
  assignedTo?: string | null;
  resolutionNote?: string | null;
  confidentiality?: string;
}

export async function updateIncident(tx: Tx, id: string, u: IncidentUpdate): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown): void => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (u.status !== undefined) set("status", u.status);
  if (u.assignedTo !== undefined) set("assigned_to", u.assignedTo);
  if (u.resolutionNote !== undefined) set("resolution_note", u.resolutionNote);
  if (u.confidentiality !== undefined) set("confidentiality", u.confidentiality);
  if (sets.length === 0) return;
  await tx.query(`UPDATE schoollife.incidents SET ${sets.join(", ")} WHERE id = $1`, params);
}
