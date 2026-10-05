/**
 * Tableaux de bord de recrutement : entonnoir par statut canonique, délais, capacité, SLA, canaux, motifs. Aucun nom, aucune
 * donnée personnelle : comptes et libellés de référence seulement. Reprend les indicateurs du legacy (`owner-recrutement`) :
 * reçues, traitées, délai moyen de traitement, séries hebdomadaires, tranches de délai, motifs de refus, répartition par niveau.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AdmissionStatus } from "@ecoledigitale/contracts/src/v2/admissions";
import { ADMISSION_STATUSES } from "@ecoledigitale/contracts/src/v2/admissions";

export async function statusCounts(tx: Tx, campaignId: string, grade?: string): Promise<Array<{ status: AdmissionStatus; count: number }>> {
  const params: unknown[] = [campaignId];
  let gradeSql = "";
  if (grade) {
    params.push(grade);
    gradeSql = "AND desired_grade_level_code = $2";
  }
  const rows = await tx.many<{ status: AdmissionStatus; count: number }>(`SELECT status, count(*)::int AS count FROM admissions.applications WHERE campaign_id = $1 ${gradeSql} GROUP BY status`, params);
  const byStatus = new Map(rows.map((r) => [r.status, r.count]));
  return ADMISSION_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 }));
}

export async function gradeStatusCounts(tx: Tx, campaignId: string): Promise<Array<{ grade: string; status: AdmissionStatus; count: number }>> {
  return tx.many(`SELECT desired_grade_level_code AS grade, status, count(*)::int AS count FROM admissions.applications WHERE campaign_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [campaignId]);
}

/** Dossiers ayant ATTEINT chaque statut au moins une fois (taux de passage). */
export async function reachedCounts(tx: Tx, campaignId: string, grade?: string): Promise<Map<string, number>> {
  const params: unknown[] = [campaignId];
  let gradeSql = "";
  if (grade) {
    params.push(grade);
    gradeSql = "AND a.desired_grade_level_code = $2";
  }
  const rows = await tx.many<{ status: string; n: number }>(
    `SELECT t.to_status AS status, count(DISTINCT t.application_id)::int AS n
       FROM admissions.transitions t JOIN admissions.applications a ON a.tenant_id = t.tenant_id AND a.id = t.application_id
      WHERE a.campaign_id = $1 ${gradeSql} GROUP BY t.to_status`,
    params,
  );
  return new Map(rows.map((r) => [r.status, r.n]));
}

export async function processingStats(tx: Tx, campaignId: string, grade?: string): Promise<{ received: number; processed: number; averageHours: number | null; buckets: Array<{ bucket: "LT_24H" | "D1_3" | "D3_7" | "GT_7D"; count: number }> }> {
  const params: unknown[] = [campaignId];
  let gradeSql = "";
  if (grade) {
    params.push(grade);
    gradeSql = "AND desired_grade_level_code = $2";
  }
  const r = await tx.queryOne<{ received: number; processed: number; avg: string | null; lt24: number; d13: number; d37: number; gt7: number }>(
    `SELECT count(*) FILTER (WHERE submitted_at IS NOT NULL)::int AS received,
            count(*) FILTER (WHERE decided_at IS NOT NULL)::int AS processed,
            (avg(extract(epoch FROM (decided_at - submitted_at)) / 3600.0) FILTER (WHERE decided_at IS NOT NULL AND submitted_at IS NOT NULL))::text AS avg,
            count(*) FILTER (WHERE decided_at IS NOT NULL AND submitted_at IS NOT NULL AND decided_at - submitted_at < interval '24 hours')::int AS lt24,
            count(*) FILTER (WHERE decided_at IS NOT NULL AND submitted_at IS NOT NULL AND decided_at - submitted_at >= interval '24 hours' AND decided_at - submitted_at < interval '3 days')::int AS d13,
            count(*) FILTER (WHERE decided_at IS NOT NULL AND submitted_at IS NOT NULL AND decided_at - submitted_at >= interval '3 days' AND decided_at - submitted_at < interval '7 days')::int AS d37,
            count(*) FILTER (WHERE decided_at IS NOT NULL AND submitted_at IS NOT NULL AND decided_at - submitted_at >= interval '7 days')::int AS gt7
       FROM admissions.applications WHERE campaign_id = $1 ${gradeSql}`,
    params,
  );
  return {
    received: r?.received ?? 0,
    processed: r?.processed ?? 0,
    averageHours: r?.avg == null ? null : Math.round(Number(r.avg) * 10) / 10,
    buckets: [
      { bucket: "LT_24H", count: r?.lt24 ?? 0 },
      { bucket: "D1_3", count: r?.d13 ?? 0 },
      { bucket: "D3_7", count: r?.d37 ?? 0 },
      { bucket: "GT_7D", count: r?.gt7 ?? 0 },
    ],
  };
}

export async function weeklyReceived(tx: Tx, campaignId: string, grade?: string): Promise<Array<{ weekStart: string; received: number }>> {
  const params: unknown[] = [campaignId];
  let gradeSql = "";
  if (grade) {
    params.push(grade);
    gradeSql = "AND desired_grade_level_code = $2";
  }
  return tx.many(
    `SELECT to_char(date_trunc('week', submitted_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "weekStart", count(*)::int AS received
       FROM admissions.applications WHERE campaign_id = $1 AND submitted_at IS NOT NULL ${gradeSql} GROUP BY 1 ORDER BY 1`,
    params,
  );
}

export async function capacityRows(tx: Tx, campaignId: string): Promise<Array<{ gradeLevelCode: string; seats: number | null; seatsLeft: number | null; waitlist: number; held: number; configured: boolean }>> {
  return tx.many(
    `WITH grades AS (
       SELECT grade_level_code AS g FROM admissions.intake_capacities WHERE campaign_id = $1
       UNION SELECT desired_grade_level_code FROM admissions.applications WHERE campaign_id = $1)
     SELECT g AS "gradeLevelCode",
            (SELECT c.seats FROM admissions.intake_capacities c WHERE c.campaign_id = $1 AND c.grade_level_code = g AND c.program_id IS NULL) AS seats,
            admissions.seats_left($1, g, NULL) AS "seatsLeft",
            (SELECT count(*)::int FROM admissions.applications a WHERE a.campaign_id = $1 AND a.desired_grade_level_code = g AND a.status = 'WAITLISTED') AS waitlist,
            (SELECT count(*)::int FROM admissions.applications a JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
              WHERE a.campaign_id = $1 AND a.desired_grade_level_code = g AND s.holds_seat) AS held,
            EXISTS (SELECT 1 FROM admissions.intake_capacities c WHERE c.campaign_id = $1 AND c.grade_level_code = g) AS configured
       FROM grades ORDER BY g`,
    [campaignId],
  );
}

export async function slaRows(tx: Tx, campaignId: string, now: string): Promise<Array<{ stageCode: string; stageLabel: string; slaHours: number | null; inStage: number; overdue: number; averageHours: number | null }>> {
  const rows = await tx.many<{ stageCode: string; stageLabel: string; slaHours: number | null; inStage: number; overdue: number; avg: string | null }>(
    `WITH app_stage AS (
       SELECT a.id, a.stage_id,
              (SELECT max(t.occurred_at) FROM admissions.transitions t WHERE t.tenant_id = a.tenant_id AND t.application_id = a.id AND t.to_stage_id = a.stage_id) AS entered_at
         FROM admissions.applications a WHERE a.campaign_id = $1),
     visits AS (
       SELECT t.to_stage_id AS stage_id, extract(epoch FROM (lead(t.occurred_at) OVER (PARTITION BY t.application_id ORDER BY t.occurred_at, t.id) - t.occurred_at)) / 3600.0 AS hours
         FROM admissions.transitions t JOIN admissions.applications a ON a.tenant_id = t.tenant_id AND a.id = t.application_id WHERE a.campaign_id = $1)
     SELECT s.code AS "stageCode", s.label AS "stageLabel", s.sla_hours AS "slaHours",
            (SELECT count(*)::int FROM app_stage x WHERE x.stage_id = s.id) AS "inStage",
            (SELECT count(*)::int FROM app_stage x WHERE x.stage_id = s.id AND s.sla_hours IS NOT NULL AND NOT s.is_terminal AND x.entered_at IS NOT NULL
                AND x.entered_at + (s.sla_hours * interval '1 hour') < $2::timestamptz) AS overdue,
            (SELECT avg(v.hours)::text FROM visits v WHERE v.stage_id = s.id AND v.hours IS NOT NULL) AS avg
       FROM admissions.workflow_stages s WHERE s.workflow_id = (SELECT workflow_id FROM admissions.campaigns WHERE id = $1) ORDER BY s.ordinal`,
    [campaignId, now],
  );
  return rows.map((r) => ({ stageCode: r.stageCode, stageLabel: r.stageLabel, slaHours: r.slaHours, inStage: r.inStage, overdue: r.overdue, averageHours: r.avg == null ? null : Math.round(Number(r.avg) * 10) / 10 }));
}

export async function sourceRows(tx: Tx, campaignId: string): Promise<Array<{ sourceChannel: string; received: number; enrolled: number }>> {
  return tx.many(
    `SELECT source_channel AS "sourceChannel", count(*)::int AS received, count(*) FILTER (WHERE status = 'ENROLLED')::int AS enrolled
       FROM admissions.applications WHERE campaign_id = $1 GROUP BY 1 ORDER BY received DESC, 1`,
    [campaignId],
  );
}

export async function rejectionRows(tx: Tx, campaignId: string): Promise<Array<{ reasonCode: string | null; label: string | null; count: number }>> {
  return tx.many(
    `SELECT d.reason_code AS "reasonCode", r.label, count(*)::int AS count
       FROM admissions.decisions d JOIN admissions.applications a ON a.tenant_id = d.tenant_id AND a.id = d.application_id
       LEFT JOIN admissions.decision_reasons r ON r.tenant_id = d.tenant_id AND r.institution_id = a.institution_id AND r.code = d.reason_code
      WHERE a.campaign_id = $1 AND d.kind IN ('REJECT', 'WITHDRAW') GROUP BY d.reason_code, r.label ORDER BY count DESC, 1`,
    [campaignId],
  );
}

export interface WaitlistEntryRow {
  readonly queuePosition: number;
  readonly applicationId: string;
  readonly priorityRank: number | null;
  readonly waitlistEnteredAt: string;
  /** Rang décidé par la direction ; `null` = « à classer ». */
  readonly manualRank: number | null;
}

/** Liste d'attente dans l'ordre décidé (rang manuel), puis les dossiers à classer par date d'entrée (affichage seulement). */
export async function waitlistEntries(tx: Tx, campaignId: string, grade: string): Promise<WaitlistEntryRow[]> {
  return tx.many(
    `SELECT w.queue_position AS "queuePosition", w.application_id AS "applicationId",
            CASE WHEN w.priority_rank = 2147483647 THEN NULL ELSE w.priority_rank END AS "priorityRank",
            to_char(w.waitlist_entered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "waitlistEnteredAt",
            w.manual_rank AS "manualRank"
       FROM admissions.waitlist_order($1, $2) w ORDER BY w.queue_position`,
    [campaignId, grade],
  );
}

/** Verrouille (FOR UPDATE, ordre stable) les dossiers en liste d'attente d'un niveau : sérialise les réordonnancements. */
export async function lockWaitlist(tx: Tx, campaignId: string, grade: string): Promise<Array<{ applicationId: string; manualRank: number | null }>> {
  return tx.many(
    `SELECT id AS "applicationId", waitlist_rank AS "manualRank"
       FROM admissions.applications WHERE campaign_id = $1 AND desired_grade_level_code = $2 AND status = 'WAITLISTED'
      ORDER BY id FOR UPDATE`,
    [campaignId, grade],
  );
}

export async function setWaitlistRank(tx: Tx, applicationId: string, rank: number): Promise<void> {
  await tx.query(`UPDATE admissions.applications SET waitlist_rank = $2, updated_at = now() WHERE id = $1 AND status = 'WAITLISTED'`, [applicationId, rank]);
}

export interface WaitlistRankChangeRow {
  readonly id: string;
  readonly applicationId: string;
  readonly kind: "RANKED" | "MOVED";
  readonly fromRank: number | null;
  readonly toRank: number | null;
  readonly reason: string | null;
  readonly actorId: string | null;
  readonly occurredAt: string;
}

export async function insertWaitlistRankChange(
  tx: Tx,
  input: { id: string; tenantId: string; applicationId: string; campaignId: string; grade: string; kind: "RANKED" | "MOVED"; fromRank: number | null; toRank: number; reason: string | null; actorId: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO admissions.waitlist_rank_changes (id, tenant_id, application_id, campaign_id, grade_level_code, kind, from_rank, to_rank, reason, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [input.id, input.tenantId, input.applicationId, input.campaignId, input.grade, input.kind, input.fromRank, input.toRank, input.reason, input.actorId],
  );
}

export async function listWaitlistRankChanges(tx: Tx, campaignId: string, grade: string, limit: number): Promise<WaitlistRankChangeRow[]> {
  return tx.many(
    `SELECT id, application_id AS "applicationId", kind, from_rank AS "fromRank", to_rank AS "toRank", reason, actor_id AS "actorId",
            to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt"
       FROM admissions.waitlist_rank_changes WHERE campaign_id = $1 AND grade_level_code = $2
      ORDER BY occurred_at DESC, id DESC LIMIT $3`,
    [campaignId, grade, limit],
  );
}
