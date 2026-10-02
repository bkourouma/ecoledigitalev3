/**
 * Support des jobs planifiés : sujets échus (convocations à rappeler, bornes d'exclusion) et registre IDEMPOTENT des envois
 * automatiques (`schoollife.job_notifications`, clé unique (tenant, genre, sujet, occurrence)).
 *
 * Lectures seules sur `convocations` / `measures` (aucune écriture : ces tables sont réservées à l'acteur humain par la base).
 */
import type { Tx } from "@ecoledigitale/database";

export type JobNotificationKind = "CONVOCATION_REMINDER" | "EXCLUSION_STARTED" | "EXCLUSION_ENDED";

/** Tentatives maximales d'un envoi automatique en échec (borne technique, pas une règle métier). */
export const JOB_MAX_ATTEMPTS = 5;
/** Un envoi `PENDING` pris par une autre instance n'est repris qu'après ce délai (reprise après plantage). */
export const JOB_PENDING_LEASE_MINUTES = 10;

export interface DueConvocation {
  readonly id: string;
  readonly studentId: string;
  readonly guardianIds: readonly string[];
  readonly scheduledAt: Date;
  readonly location: string | null;
}

/** Convocations envoyées dont l'échéance tombe dans la fenêtre de rappel de leur établissement (réglage non vide). */
export async function listConvocationsToRemind(tx: Tx, now: Date, limit: number): Promise<DueConvocation[]> {
  return tx.many<DueConvocation>(
    `SELECT c.id, c.student_id AS "studentId", c.guardian_ids AS "guardianIds", c.scheduled_at AS "scheduledAt", c.location
       FROM schoollife.convocations c
       JOIN schoollife.settings s ON s.tenant_id = c.tenant_id AND s.institution_id = c.institution_id
      WHERE s.convocation_reminder_hours IS NOT NULL
        AND c.status IN ('SENT', 'ACKNOWLEDGED')
        AND c.scheduled_at > $1::timestamptz
        AND c.scheduled_at <= $1::timestamptz + make_interval(hours => s.convocation_reminder_hours)
        AND NOT EXISTS (
          SELECT 1 FROM schoollife.job_notifications j
           WHERE j.tenant_id = c.tenant_id AND j.kind = 'CONVOCATION_REMINDER' AND j.subject_id = c.id
             AND j.occurrence = to_char(c.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             AND (j.status IN ('SENT', 'SKIPPED') OR j.attempts >= ${JOB_MAX_ATTEMPTS}))
      ORDER BY c.scheduled_at
      LIMIT $2`,
    [now, limit],
  );
}

export interface DueExclusion {
  readonly id: string;
  readonly studentId: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

/** Fenêtre de rattrapage d'un job manqué : au-delà, la borne est considérée comme passée (pas d'avis tardif en rafale). */
export const BOUNDARY_CATCH_UP_DAYS = 3;

/**
 * Exclusions temporaires EN VIGUEUR (jamais révoquées ni rejetées) dont la borne `kind` est atteinte, pour les établissements
 * qui ont activé les avis, dont le type notifie les tuteurs, visibles des familles et non confidentielles (mêmes conditions que
 * la notification de la mesure : `notifyMeasure`).
 */
export async function listExclusionsAtBoundary(tx: Tx, today: string, kind: "EXCLUSION_STARTED" | "EXCLUSION_ENDED", limit: number): Promise<DueExclusion[]> {
  const bound = kind === "EXCLUSION_STARTED" ? "m.starts_on" : "m.ends_on";
  // Un début n'est annoncé que si l'exclusion court encore ; une fin l'est toujours (même rattrapée).
  const stillRunning = kind === "EXCLUSION_STARTED" ? "AND m.ends_on >= $1::date" : "";
  return tx.many<DueExclusion>(
    `SELECT m.id, m.student_id AS "studentId", to_char(m.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(m.ends_on, 'YYYY-MM-DD') AS "endsOn"
       FROM schoollife.measures m
       JOIN schoollife.event_types t ON t.tenant_id = m.tenant_id AND t.id = m.type_id
       JOIN schoollife.settings s ON s.tenant_id = m.tenant_id AND s.institution_id = m.institution_id
      WHERE m.kind = 'TEMP_EXCLUSION'
        AND m.status IN ('VALIDATED', 'NOTIFIED', 'EXECUTED', 'APPEALED')
        AND s.exclusion_boundary_notices
        AND t.notify_guardians AND m.visible_to_guardians AND m.confidentiality <> 'CONFIDENTIAL'
        AND ${bound} <= $1::date AND ${bound} > $1::date - ${BOUNDARY_CATCH_UP_DAYS} ${stillRunning}
        AND NOT EXISTS (
          SELECT 1 FROM schoollife.job_notifications j
           WHERE j.tenant_id = m.tenant_id AND j.kind = '${kind}' AND j.subject_id = m.id AND j.occurrence = to_char(${bound}, 'YYYY-MM-DD')
             AND (j.status IN ('SENT', 'SKIPPED') OR j.attempts >= ${JOB_MAX_ATTEMPTS}))
      ORDER BY ${bound}, m.id
      LIMIT $2`,
    [today, limit],
  );
}

/**
 * Réserve l'envoi (idempotent) : crée la ligne, ou reprend une ligne `FAILED` / `PENDING` périmée sous la borne de tentatives.
 * `null` : déjà envoyé, en cours chez une autre instance, ou borne de tentatives atteinte.
 */
export async function claimJobNotification(
  tx: Tx,
  input: { id: string; tenantId: string; kind: JobNotificationKind; subjectId: string; occurrence: string },
): Promise<{ id: string; attempts: number } | null> {
  return tx.queryOne<{ id: string; attempts: number }>(
    `INSERT INTO schoollife.job_notifications (id, tenant_id, kind, subject_id, occurrence)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, kind, subject_id, occurrence) DO UPDATE
        SET attempts = schoollife.job_notifications.attempts + 1, status = 'PENDING', updated_at = now()
      WHERE schoollife.job_notifications.attempts < ${JOB_MAX_ATTEMPTS}
        AND (schoollife.job_notifications.status = 'FAILED'
             OR (schoollife.job_notifications.status = 'PENDING' AND schoollife.job_notifications.updated_at < now() - make_interval(mins => ${JOB_PENDING_LEASE_MINUTES})))
     RETURNING id, attempts`,
    [input.id, input.tenantId, input.kind, input.subjectId, input.occurrence],
  );
}

export async function finishJobNotification(tx: Tx, id: string, outcome: { status: "SENT" | "FAILED" | "SKIPPED"; errorCode?: string | null }): Promise<void> {
  await tx.query(
    `UPDATE schoollife.job_notifications
        SET status = $2, error_code = $3, sent_at = CASE WHEN $2 = 'SENT' THEN now() ELSE sent_at END, updated_at = now()
      WHERE id = $1`,
    [id, outcome.status, outcome.errorCode ?? null],
  );
}
