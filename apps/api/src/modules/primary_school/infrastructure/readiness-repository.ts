/** État « prêt » d'une classe × période (décision Q-P18) : SQL via le `Tx` de TenantDb. Aucun contenu pédagogique n'y est lu. */
import type { Tx } from "@ecoledigitale/database";
import type { Uuid } from "../domain/types";

export interface PeriodReadiness {
  readonly classroomId: Uuid;
  readonly periodId: Uuid;
  readonly status: "READY" | "NOT_READY";
  readonly markedBy: Uuid;
  readonly markedAt: Date;
  readonly withdrawnBy: Uuid | null;
  readonly withdrawnAt: Date | null;
  readonly withdrawnReason: string | null;
  readonly rowVersion: number;
}

const COLUMNS = `classroom_id, academic_period_id, status, marked_by, marked_at, withdrawn_by, withdrawn_at, withdrawn_reason, row_version`;

function toReadiness(r: Record<string, any>): PeriodReadiness {
  return {
    classroomId: r.classroom_id,
    periodId: r.academic_period_id,
    status: r.status,
    markedBy: r.marked_by,
    markedAt: r.marked_at,
    withdrawnBy: r.withdrawn_by ?? null,
    withdrawnAt: r.withdrawn_at ?? null,
    withdrawnReason: r.withdrawn_reason ?? null,
    rowVersion: r.row_version,
  };
}

export async function getReadiness(tx: Tx, classroomId: Uuid, periodId: Uuid, forUpdate = false): Promise<PeriodReadiness | null> {
  const r = await tx.queryOne(`SELECT ${COLUMNS} FROM primary_school.period_readiness WHERE classroom_id = $1 AND academic_period_id = $2 ${forUpdate ? "FOR UPDATE" : ""}`, [classroomId, periodId]);
  return r ? toReadiness(r) : null;
}

export async function listReadinessOfClass(tx: Tx, classroomId: Uuid): Promise<PeriodReadiness[]> {
  const rows = await tx.many(`SELECT ${COLUMNS} FROM primary_school.period_readiness WHERE classroom_id = $1 ORDER BY academic_period_id`, [classroomId]);
  return rows.map(toReadiness);
}

/** Marque « prêts » (crée, ou rétablit après un retrait). */
export async function upsertReady(tx: Tx, p: { tenantId: Uuid; classroomId: Uuid; periodId: Uuid; by: Uuid; now: Date }): Promise<PeriodReadiness> {
  const r = await tx.queryOne(
    `INSERT INTO primary_school.period_readiness (tenant_id, classroom_id, academic_period_id, status, marked_by, marked_at)
     VALUES ($1,$2,$3,'READY',$4,$5)
     ON CONFLICT (tenant_id, classroom_id, academic_period_id) DO UPDATE
       SET status = 'READY', marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at,
           withdrawn_by = NULL, withdrawn_at = NULL, withdrawn_reason = NULL,
           row_version = primary_school.period_readiness.row_version + 1
     RETURNING ${COLUMNS}`,
    [p.tenantId, p.classroomId, p.periodId, p.by, p.now.toISOString()],
  );
  return toReadiness(r as Record<string, any>);
}

export async function withdrawReady(tx: Tx, p: { classroomId: Uuid; periodId: Uuid; by: Uuid; reason: string; now: Date }): Promise<PeriodReadiness> {
  const r = await tx.queryOne(
    `UPDATE primary_school.period_readiness
        SET status = 'NOT_READY', withdrawn_by = $3, withdrawn_at = $4, withdrawn_reason = $5, row_version = row_version + 1
      WHERE classroom_id = $1 AND academic_period_id = $2 AND status = 'READY'
      RETURNING ${COLUMNS}`,
    [p.classroomId, p.periodId, p.by, p.now.toISOString(), p.reason],
  );
  return toReadiness(r as Record<string, any>);
}

/** Périodes de la classe marquées « prêtes ». */
export async function readyPeriodIdsOfClass(tx: Tx, classroomId: Uuid): Promise<Uuid[]> {
  const rows = await tx.many(`SELECT academic_period_id FROM primary_school.period_readiness WHERE classroom_id = $1 AND status = 'READY'`, [classroomId]);
  return rows.map((r) => r.academic_period_id as Uuid);
}

/** Périodes de la classe dont la grille est VALIDÉE : au moins une ligne et plus aucun brouillon. */
export async function validatedPeriodIdsOfClass(tx: Tx, classroomId: Uuid): Promise<Uuid[]> {
  const rows = await tx.many(
    `SELECT academic_period_id FROM primary_school.competency_assessments WHERE classroom_id = $1
      GROUP BY academic_period_id HAVING count(*) FILTER (WHERE status = 'DRAFT') = 0`,
    [classroomId],
  );
  return rows.map((r) => r.academic_period_id as Uuid);
}

/**
 * Synthèse destinée à la FAMILLE : compteurs `{ domaine: { niveau: n } }`. Les lignes VALIDÉES comptent partout ; les brouillons ne
 * comptent QUE dans les périodes marquées « prêtes » (gelées par le déclencheur : la famille voit ce que l'enseignant a déclaré prêt).
 */
export async function summarizeForFamily(tx: Tx, enrollmentId: Uuid, periodIds: readonly Uuid[], readyPeriodIds: readonly Uuid[]): Promise<Record<string, Record<string, number>>> {
  const rows = await tx.many(
    `SELECT d.code AS domain_code, l.code AS level_code, count(*)::int AS n
       FROM primary_school.competency_assessments a
       JOIN primary_school.competencies c ON c.tenant_id = a.tenant_id AND c.id = a.competency_id
       JOIN primary_school.competency_domains d ON d.tenant_id = c.tenant_id AND d.id = c.domain_id
       JOIN primary_school.rating_levels l ON l.tenant_id = a.tenant_id AND l.id = a.rating_level_id
      WHERE a.enrollment_id = $1
        AND a.academic_period_id = ANY ($2::uuid[])
        AND (a.status = 'VALIDATED' OR a.academic_period_id = ANY ($3::uuid[]))
      GROUP BY d.code, l.code`,
    [enrollmentId, periodIds, readyPeriodIds],
  );
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.domain_code] ??= {})[r.level_code] = r.n;
  return out;
}
