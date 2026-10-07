/** Historique automatique (alimenté par la base, ajout seul), journal des lectures confidentielles, tableaux de bord. */
import type { Tx } from "@ecoledigitale/database";
import type { ConfidentialReadRow, LifeEventRow } from "./rows";

/**
 * Événements d'un élève. Un incident n'a pas de colonne `student_id` (les élèves sont dans ses implications) : son événement est
 * journalisé sans élève ; on le rattache ici par les identifiants d'incidents déjà visibles de l'appelant (QA C-08-06).
 */
export const listLifeEventsOfStudent = (tx: Tx, studentId: string, limit: number, incidentIds: readonly string[] = []): Promise<LifeEventRow[]> =>
  tx.many<LifeEventRow>(
    `SELECT id, entity_kind AS "entityKind", entity_id AS "entityId", student_id AS "studentId", action, from_status AS "fromStatus", to_status AS "toStatus",
            actor_id AS "actorId", actor_kind AS "actorKind", reason, occurred_at AS "occurredAt"
       FROM schoollife.life_events
      WHERE student_id = $1 OR (entity_kind = 'INCIDENT' AND entity_id = ANY($3::uuid[]))
      ORDER BY occurred_at DESC, id LIMIT $2`,
    [studentId, limit, [...incidentIds]],
  );

export const listLifeEventsOfEntity = (tx: Tx, entityKind: string, entityId: string): Promise<LifeEventRow[]> =>
  tx.many<LifeEventRow>(
    `SELECT id, entity_kind AS "entityKind", entity_id AS "entityId", student_id AS "studentId", action, from_status AS "fromStatus", to_status AS "toStatus",
            actor_id AS "actorId", actor_kind AS "actorKind", reason, occurred_at AS "occurredAt"
       FROM schoollife.life_events WHERE entity_kind = $1 AND entity_id = $2 ORDER BY occurred_at, id`,
    [entityKind, entityId],
  );

/** Journalise la lecture d'un élément confidentiel AVANT que son contenu soit renvoyé (lecteur = utilisateur de la session, posé par la base). */
export async function insertConfidentialRead(tx: Tx, v: { id: string; tenantId: string; entityKind: string; entityId: string; readerUserId: string; purpose: string }): Promise<void> {
  await tx.query(`INSERT INTO schoollife.confidential_reads (id, tenant_id, entity_kind, entity_id, reader_user_id, purpose) VALUES ($1,$2,$3,$4,$5,$6)`, [v.id, v.tenantId, v.entityKind, v.entityId, v.readerUserId, v.purpose]);
}

export async function listConfidentialReads(tx: Tx, f: { entityKind?: string | undefined; entityId?: string | undefined; limit: number; offset: number }): Promise<ConfidentialReadRow[]> {
  return tx.many<ConfidentialReadRow>(
    `SELECT id, entity_kind AS "entityKind", entity_id AS "entityId", reader_user_id AS "readerUserId", purpose, occurred_at AS "occurredAt"
       FROM schoollife.confidential_reads WHERE ($1::text IS NULL OR entity_kind = $1) AND ($2::uuid IS NULL OR entity_id = $2)
      ORDER BY occurred_at DESC, id LIMIT $3 OFFSET $4`,
    [f.entityKind ?? null, f.entityId ?? null, f.limit, f.offset],
  );
}

export interface DashboardCounts {
  openIncidents: number;
  measuresToValidate: number;
  activeExclusions: number;
  convocationsToHold: number;
  effectsAwaitingHuman: number;
}

/** Comptages du tableau de bord, déjà bornés par l'habilitation (`audience_may_see`). */
export async function dashboardCounts(tx: Tx, audience: string, institutionId: string | null, today: string, now: Date): Promise<DashboardCounts> {
  const row = await tx.queryOne<DashboardCounts>(
    `SELECT
       (SELECT count(*)::int FROM schoollife.incidents i WHERE i.status IN ('DECLARED','UNDER_REVIEW') AND ($2::uuid IS NULL OR i.institution_id = $2)
          AND schoollife.audience_may_see($1, 'INCIDENT', i.confidentiality, true, i.status, NULL)) AS "openIncidents",
       (SELECT count(*)::int FROM schoollife.measures m WHERE m.status = 'PROPOSED' AND ($2::uuid IS NULL OR m.institution_id = $2)
          AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)) AS "measuresToValidate",
       (SELECT count(*)::int FROM schoollife.measures m WHERE m.kind = 'TEMP_EXCLUSION' AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED')
          AND m.starts_on <= $3::date AND m.ends_on >= $3::date AND ($2::uuid IS NULL OR m.institution_id = $2)
          AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)) AS "activeExclusions",
       (SELECT count(*)::int FROM schoollife.convocations c WHERE c.status IN ('SENT','ACKNOWLEDGED') AND c.scheduled_at >= $4 AND ($2::uuid IS NULL OR c.institution_id = $2)
          AND schoollife.audience_may_see($1, 'CONVOCATION', c.confidentiality, true, c.status, NULL)) AS "convocationsToHold",
       (SELECT count(*)::int FROM schoollife.measure_effects e WHERE e.status IN ('AWAITING_HUMAN','FAILED')) AS "effectsAwaitingHuman"`,
    [audience, institutionId, today, now],
  );
  return row ?? { openIncidents: 0, measuresToValidate: 0, activeExclusions: 0, convocationsToHold: 0, effectsAwaitingHuman: 0 };
}

export interface ClassCounts {
  enrollmentId: string;
  incidents: number;
  measures: number;
  warnings: number;
  encouragements: number;
  observations: number;
}

/** Comptages par inscription pour une classe (aucun texte libre : la synthèse reste partageable avec la direction des études). */
export async function classroomCounts(tx: Tx, audience: string, enrollmentIds: readonly string[]): Promise<ClassCounts[]> {
  if (enrollmentIds.length === 0) return [];
  return tx.many<ClassCounts>(
    `WITH ids AS (SELECT unnest($2::uuid[]) AS enrollment_id)
     SELECT ids.enrollment_id AS "enrollmentId",
       (SELECT count(DISTINCT i.id)::int FROM schoollife.incident_involvements v JOIN schoollife.incidents i ON i.tenant_id = v.tenant_id AND i.id = v.incident_id
          WHERE v.enrollment_id = ids.enrollment_id AND v.role = 'AUTHOR' AND schoollife.audience_may_see($1, 'INCIDENT', i.confidentiality, true, i.status, NULL)) AS incidents,
       (SELECT count(*)::int FROM schoollife.measures m WHERE m.enrollment_id = ids.enrollment_id AND m.kind IN ('SANCTION','TEMP_EXCLUSION') AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED')
          AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)) AS measures,
       (SELECT count(*)::int FROM schoollife.measures m WHERE m.enrollment_id = ids.enrollment_id AND m.kind = 'WARNING' AND m.status IN ('VALIDATED','NOTIFIED','EXECUTED','APPEALED')
          AND schoollife.audience_may_see($1, 'MEASURE', m.confidentiality, m.visible_to_guardians, m.status, NULL)) AS warnings,
       (SELECT count(*)::int FROM schoollife.notes n WHERE n.enrollment_id = ids.enrollment_id AND n.kind = 'ENCOURAGEMENT' AND n.status = 'ACTIVE'
          AND schoollife.audience_may_see($1, 'NOTE', n.confidentiality, true, n.status, n.visibility)) AS encouragements,
       (SELECT count(*)::int FROM schoollife.notes n WHERE n.enrollment_id = ids.enrollment_id AND n.kind = 'OBSERVATION' AND n.status = 'ACTIVE'
          AND schoollife.audience_may_see($1, 'NOTE', n.confidentiality, true, n.status, n.visibility)) AS observations
       FROM ids`,
    [audience, enrollmentIds],
  );
}
