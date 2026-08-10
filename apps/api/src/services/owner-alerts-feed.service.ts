import type { PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";

async function countMetric(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<number> {
  try {
    const r = await client.query<{ v: string | null }>(sql, params);
    const raw = r.rows[0]?.v;
    return Math.round(parseFloat(raw != null ? String(raw) : "0") || 0);
  } catch (e) {
    log.warn({ err: e, label }, "owner alerts feed metric skipped");
    return 0;
  }
}

/**
 * Règles métier simples : insère au plus une alerte non acquittée par domaine `auto_*`
 * si la condition est vraie (tant qu’une alerte du même domaine reste ouverte, pas de doublon).
 */
export async function syncOwnerPilotageAlerts(
  client: PoolClient,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<void> {
  const tuitionOverdue = await countMetric(
    client,
    `SELECT COUNT(DISTINCT student_id)::text AS v
     FROM student_tuition_installments
     WHERE tenant_id = $1::uuid
       AND status = 'overdue'::installment_status
       AND due_date < (CURRENT_DATE - INTERVAL '60 days')`,
    [tenantId],
    log,
    "tuitionOverdue"
  );

  const coursesGap = await countMetric(
    client,
    `SELECT COUNT(DISTINCT cc.course_id)::text AS v
     FROM class_courses cc
     LEFT JOIN teacher_assignments ta
       ON ta.class_course_id = cc.id AND ta.tenant_id = cc.tenant_id AND ta.status = 'active'::assignment_status
     WHERE cc.tenant_id = $1::uuid AND ta.id IS NULL`,
    [tenantId],
    log,
    "coursesGap"
  );

  const payrollPending = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
     FROM teacher_payments
     WHERE tenant_id = $1::uuid
       AND status = 'calculated'::payment_status
       AND approved_at IS NULL`,
    [tenantId],
    log,
    "payrollPending"
  );

  /* ---------------- Module professionnel (LMD) ---------------- */

  /**
   * Filières dont le recouvrement est sous le seuil.
   *
   * L'attendu est réparti au prorata des inscriptions : une commande peut porter
   * des UE de plusieurs filières, on ne peut pas l'affecter en bloc. Les paiements
   * sont agrégés par commande AVANT jointure, sinon le montant serait multiplié
   * par le nombre d'inscriptions du lot.
   */
  const weakRecoveryFilieres = await countMetric(
    client,
    `WITH paid_per_order AS (
       SELECT p.order_id, SUM(p.montant)::float8 AS paid
       FROM professional_payments p
       WHERE p.tenant_id = $1::uuid
         AND p.statut = 'confirme'
       GROUP BY p.order_id
     ),
     share AS (
       SELECT en.order_id, u.filiere_id, SUM(en.prix_unitaire)::float8 AS part
       FROM professional_enrollments en
       JOIN professional_orders o
         ON o.id = en.order_id AND o.tenant_id = en.tenant_id AND o.statut <> 'annulee'
       JOIN professional_ue_sessions s
         ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee'
       GROUP BY en.order_id, u.filiere_id
     ),
     order_total AS (
       SELECT order_id, SUM(part) AS total FROM share GROUP BY order_id
     )
     SELECT COUNT(*)::text AS v FROM (
       SELECT sh.filiere_id
       FROM share sh
       JOIN order_total t ON t.order_id = sh.order_id
       LEFT JOIN paid_per_order pp ON pp.order_id = sh.order_id
       GROUP BY sh.filiere_id
       HAVING SUM(sh.part) > 0
          AND SUM(COALESCE(pp.paid, 0) * sh.part / NULLIF(t.total, 0)) / SUM(sh.part) < 0.6
     ) x`,
    [tenantId],
    log,
    "weakRecoveryFilieres"
  );

  /**
   * ECUE dont plus de la moitié des résultats notés sont en échec, sur un effectif
   * suffisant pour que le chiffre veuille dire quelque chose. La « Conduite » est
   * exclue, comme partout dans les statistiques de résultats.
   */
  const failingEcue = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v FROM (
       SELECT r.ecue_id
       FROM professional_ecue_results r
       JOIN professional_ecue e ON e.id = r.ecue_id AND e.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1::uuid
         AND NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
         -- Une ECUE sans note d'examen est en cours, pas échouée.
         AND r.moyenne IS NOT NULL
       GROUP BY r.ecue_id
       HAVING COUNT(*) >= 10
          AND COUNT(*) FILTER (WHERE r.validee = false)::float8 / COUNT(*) > 0.5
     ) x`,
    [tenantId],
    log,
    "failingEcue"
  );

  /** Part des séances passées des 30 derniers jours sans aucun pointage, en %. */
  const missedCallsRate = await countMetric(
    client,
    `SELECT CASE WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(100.0 * COUNT(*) FILTER (
              WHERE NOT EXISTS (
                SELECT 1 FROM professional_ecue_attendance a
                WHERE a.seance_id = s.id AND a.tenant_id = s.tenant_id
              )
            ) / COUNT(*)) END::text AS v
     FROM professional_ecue_seances s
     WHERE s.tenant_id = $1::uuid
       AND s.date < CURRENT_DATE
       AND s.date >= CURRENT_DATE - INTERVAL '30 days'`,
    [tenantId],
    log,
    "missedCallsRate"
  );

  /** ECUE obligatoires sans enseignant affecté sur une session ouverte. */
  const ecueWithoutTeacher = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
     FROM professional_ue_sessions s
     JOIN professional_ue_ecue l
       ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id AND l.est_obligatoire
     WHERE s.tenant_id = $1::uuid
       AND s.statut = 'ouvert'
       AND NOT EXISTS (
         SELECT 1 FROM professional_session_ecue_teachers st
         WHERE st.ue_session_id = s.id
           AND st.ecue_id = l.ecue_id
           AND st.tenant_id = s.tenant_id
       )`,
    [tenantId],
    log,
    "ecueWithoutTeacher"
  );

  /**
   * Semestres entièrement terminés depuis plus de 15 jours et sans aucun bulletin.
   * Le double chemin semestre → sessions est parcouru dans les deux sens : par
   * session (legacy) et par UE (courant).
   */
  const semestresWithoutBulletin = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
     FROM professional_semestres sem
     WHERE sem.tenant_id = $1::uuid
       AND EXISTS (
         SELECT 1 FROM professional_ue_sessions s
         WHERE s.tenant_id = sem.tenant_id
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
           )
       )
       -- Aucune session encore ouverte ni close depuis moins de 15 jours.
       AND NOT EXISTS (
         SELECT 1 FROM professional_ue_sessions s
         WHERE s.tenant_id = sem.tenant_id
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
           )
           AND (s.statut <> 'termine' OR s.date_fin > CURRENT_DATE - INTERVAL '15 days')
       )
       AND NOT EXISTS (
         SELECT 1 FROM professional_bulletins b
         WHERE b.semestre_id = sem.id AND b.tenant_id = sem.tenant_id
       )`,
    [tenantId],
    log,
    "semestresWithoutBulletin"
  );

  /**
   * UE dont le nombre d'UV déclaré diverge de la somme des crédits de ses ECUE.
   * C'est la pondération par crédits qui fait foi dans le calcul des bulletins :
   * un écart signale un référentiel trompeur (cf. migrations correctives 0083-0085).
   */
  const ueCreditMismatch = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
     FROM professional_ue u
     WHERE u.tenant_id = $1::uuid
       AND u.statut = 'actif'
       AND EXISTS (
         SELECT 1 FROM professional_ue_ecue l
         WHERE l.ue_id = u.id AND l.tenant_id = u.tenant_id
       )
       AND u.nb_uv <> COALESCE((
         SELECT SUM(e.credits)
         FROM professional_ue_ecue l
         JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
         WHERE l.ue_id = u.id AND l.tenant_id = u.tenant_id
       ), 0)`,
    [tenantId],
    log,
    "ueCreditMismatch"
  );

  const inserts: Array<{ domain: string; severity: string; message: string }> = [];
  if (tuitionOverdue > 0) {
    inserts.push({
      domain: "auto_tuition_overdue",
      severity: "high",
      message: `${tuitionOverdue} impayé(s) scolarité en retard de plus de 60 jours (élèves distincts).`,
    });
  }
  if (coursesGap > 0) {
    inserts.push({
      domain: "auto_courses_unassigned",
      severity: "medium",
      message: `${coursesGap} cours (références distinctes) sans enseignant titulaire actif sur des classes.`,
    });
  }
  if (payrollPending > 0) {
    inserts.push({
      domain: "auto_payroll_pending",
      severity: "medium",
      message: `${payrollPending} fiche(s) de rémunération enseignant en attente de validation.`,
    });
  }
  if (weakRecoveryFilieres > 0) {
    inserts.push({
      domain: "auto_pro_weak_recovery",
      severity: "high",
      message: `${weakRecoveryFilieres} filière(s) du module professionnel sous 60 % de recouvrement.`,
    });
  }
  if (failingEcue > 0) {
    inserts.push({
      domain: "auto_pro_failing_ecue",
      severity: "high",
      message: `${failingEcue} ECUE avec plus de 50 % d'échecs sur au moins 10 résultats notés.`,
    });
  }
  if (missedCallsRate > 30) {
    inserts.push({
      domain: "auto_pro_missed_calls",
      severity: "medium",
      message: `${missedCallsRate} % des séances passées des 30 derniers jours n'ont fait l'objet d'aucun appel.`,
    });
  }
  if (ecueWithoutTeacher > 0) {
    inserts.push({
      domain: "auto_pro_ecue_no_teacher",
      severity: "high",
      message: `${ecueWithoutTeacher} ECUE obligatoire(s) sans enseignant affecté sur une session ouverte.`,
    });
  }
  if (semestresWithoutBulletin > 0) {
    inserts.push({
      domain: "auto_pro_missing_bulletins",
      severity: "medium",
      message: `${semestresWithoutBulletin} semestre(s) clos depuis plus de 15 jours sans aucun bulletin généré.`,
    });
  }
  if (ueCreditMismatch > 0) {
    inserts.push({
      domain: "auto_pro_ue_credit_mismatch",
      severity: "low",
      message: `${ueCreditMismatch} UE dont le nombre d'UV déclaré diffère de la somme des crédits de ses ECUE.`,
    });
  }

  for (const row of inserts) {
    try {
      await client.query(
        `INSERT INTO owner_pilotage_alerts (tenant_id, severity, message, domain)
         SELECT $1::uuid, $2::varchar(10), $3::text, $4::varchar(64)
         WHERE NOT EXISTS (
           SELECT 1 FROM owner_pilotage_alerts a
           WHERE a.tenant_id = $1::uuid
             AND a.domain = $4::varchar(64)
             AND a.acknowledged_at IS NULL
         )`,
        [tenantId, row.severity, row.message, row.domain]
      );
    } catch (e) {
      log.warn({ err: e, domain: row.domain }, "owner pilotage alert insert skipped");
    }
  }
}
