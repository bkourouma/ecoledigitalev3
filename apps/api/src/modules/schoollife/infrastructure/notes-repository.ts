/** Encouragements et observations (notes de vie scolaire) : immuables, retirables avec motif. Visibilité : `audience_may_see`. */
import type { Tx } from "@ecoledigitale/database";
import type { NoteRow } from "./rows";

const COLS = `n.id, n.institution_id AS "institutionId", n.academic_year_id AS "academicYearId", n.enrollment_id AS "enrollmentId", n.student_id AS "studentId",
  n.type_id AS "typeId", n.kind, n.body, n.occurred_on::text AS "occurredOn", n.visibility, n.confidentiality, n.author_id AS "authorId", n.author_name AS "authorName",
  n.status, n.withdrawn_reason AS "withdrawnReason", n.created_at AS "createdAt"`;

export async function insertNote(
  tx: Tx,
  n: { id: string; tenantId: string; institutionId: string; academicYearId: string; enrollmentId: string; studentId: string; typeId: string; kind: string; body: string; occurredOn: string; visibility: string; confidentiality: string; authorId: string; authorName: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO schoollife.notes (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, kind, body, occurred_on, visibility, confidentiality, author_id, author_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13,$14)`,
    [n.id, n.tenantId, n.institutionId, n.academicYearId, n.enrollmentId, n.studentId, n.typeId, n.kind, n.body, n.occurredOn, n.visibility, n.confidentiality, n.authorId, n.authorName],
  );
}

export const getNote = (tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<NoteRow | null> =>
  tx.queryOne<NoteRow>(`SELECT ${COLS} FROM schoollife.notes n WHERE n.id = $1${options.lock ? " FOR UPDATE" : ""}`, [id]);

export interface NoteFilter {
  audience: string;
  studentId?: string | undefined;
  enrollmentIds?: readonly string[] | undefined;
  kind?: string | undefined;
  authorId?: string | undefined;
  /** Familles : seules les notes actives sont partageables, la règle SQL le dit ; le personnel voit aussi les notes retirées. */
  limit: number;
  offset: number;
}

export async function listNotes(tx: Tx, f: NoteFilter): Promise<NoteRow[]> {
  const where: string[] = [`schoollife.audience_may_see($1, 'NOTE', n.confidentiality, true, n.status, n.visibility)`];
  const params: unknown[] = [f.audience];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.studentId) add("n.student_id = ?", f.studentId);
  if (f.enrollmentIds) add("n.enrollment_id = ANY(?::uuid[])", f.enrollmentIds);
  if (f.kind) add("n.kind = ?", f.kind);
  if (f.authorId) add("n.author_id = ?", f.authorId);
  params.push(f.limit, f.offset);
  return tx.many<NoteRow>(
    `SELECT ${COLS} FROM schoollife.notes n WHERE ${where.join(" AND ")} ORDER BY n.occurred_on DESC, n.created_at DESC, n.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export async function withdrawNote(tx: Tx, id: string, reason: string): Promise<void> {
  await tx.query(`UPDATE schoollife.notes SET status = 'WITHDRAWN', withdrawn_reason = $2 WHERE id = $1`, [id, reason]);
}
