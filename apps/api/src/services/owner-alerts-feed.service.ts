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

  /* ---------------- Argent : trésorerie, caisse, impayés anciens ------------ */

  /**
   * Impayés de plus de 90 jours, tous moteurs confondus, en FCFA.
   *
   * Distinct du seuil de 60 jours ci-dessus : au-delà de 90 jours la probabilité
   * de recouvrement s'effondre, ce n'est plus une relance mais un arbitrage
   * (échéancier négocié, blocage d'accès aux examens, passage en perte).
   */
  const overdue90Amount = await countMetric(
    client,
    `WITH pro_paid AS (
       SELECT p.order_id, SUM(p.montant)::float8 AS paid
       FROM professional_payments p
       WHERE p.tenant_id = $1::uuid AND p.statut = 'confirme'
       GROUP BY p.order_id
     ),
     pro AS (
       SELECT GREATEST(0, LEAST(
                i.montant::float8,
                SUM(i.montant::float8) OVER (
                  PARTITION BY i.order_id ORDER BY i.due_date, i.rang
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) - COALESCE(pp.paid, 0)
              )) AS unpaid,
              i.due_date
       FROM professional_order_installments i
       JOIN professional_orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
       LEFT JOIN pro_paid pp ON pp.order_id = i.order_id
       WHERE i.tenant_id = $1::uuid AND o.statut <> 'annulee'
     )
     SELECT (
       COALESCE((SELECT SUM(GREATEST(0, amount - amount_paid))
                   FROM student_tuition_installments
                  WHERE tenant_id = $1::uuid
                    AND status IN ('pending'::installment_status,
                                   'partial'::installment_status,
                                   'overdue'::installment_status)
                    AND due_date < CURRENT_DATE - INTERVAL '90 days'), 0)
     + COALESCE((SELECT SUM(unpaid) FROM pro
                  WHERE due_date < CURRENT_DATE - INTERVAL '90 days'), 0)
     )::text AS v`,
    [tenantId],
    log,
    "overdue90Amount"
  );

  /**
   * Couverture de la paie du mois par les encaissements du mois.
   *
   * Renvoie l'écart MANQUANT en FCFA (0 si la paie est couverte). C'est le seul
   * indicateur du lot qui annonce une rupture de trésorerie avant qu'elle arrive.
   */
  const payrollGap = await countMetric(
    client,
    `WITH encaisse AS (
       SELECT (
         COALESCE((SELECT SUM(amount) FROM payment_transactions
                    WHERE tenant_id = $1::uuid
                      AND status = 'completed'::transaction_status
                      AND date_trunc('month', COALESCE(processed_at, created_at))
                          = date_trunc('month', CURRENT_DATE)), 0)
       + COALESCE((SELECT SUM(montant) FROM professional_payments
                    WHERE tenant_id = $1::uuid AND statut = 'confirme'
                      AND date_trunc('month', COALESCE(paid_at, created_at))
                          = date_trunc('month', CURRENT_DATE)), 0)
       )::float8 AS v
     ),
     paie AS (
       SELECT COALESCE(SUM(total_amount), 0)::float8 AS v
       FROM teacher_payments
       WHERE tenant_id = $1::uuid
         AND status IN ('calculated'::payment_status,
                        'approved'::payment_status,
                        'paid'::payment_status)
         AND date_trunc('month', COALESCE(calculated_at, created_at))
             = date_trunc('month', CURRENT_DATE)
     )
     SELECT GREATEST(0, paie.v - encaisse.v)::text AS v FROM paie, encaisse`,
    [tenantId],
    log,
    "payrollGap"
  );

  /** Commandes marquées « payée » sans aucune ligne de paiement : écart de caisse. */
  const ordersPaidWithoutPayment = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
       FROM professional_orders o
      WHERE o.tenant_id = $1::uuid
        AND o.statut = 'payee'
        AND NOT EXISTS (SELECT 1 FROM professional_payments p
                         WHERE p.order_id = o.id AND p.tenant_id = o.tenant_id)`,
    [tenantId],
    log,
    "ordersPaidWithoutPayment"
  );

  /** Encaissements de plus de 48 h sans numéro de reçu : contentieux en préparation. */
  const paymentsWithoutReceipt = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
       FROM professional_payments p
      WHERE p.tenant_id = $1::uuid
        AND p.statut = 'confirme'
        AND (p.receipt_number IS NULL OR TRIM(p.receipt_number) = '')
        AND COALESCE(p.paid_at, p.created_at) < now() - INTERVAL '48 hours'`,
    [tenantId],
    log,
    "paymentsWithoutReceipt"
  );

  /**
   * Filières sous 50 % de recouvrement sur un effectif significatif.
   *
   * Complète `weakRecoveryFilieres` (seuil 60 %) : en dessous de 50 % avec au
   * moins 10 étudiants, ce n'est plus un retard de campagne, c'est une filière
   * qui ne se paie pas.
   */
  const criticalRecoveryFilieres = await countMetric(
    client,
    `WITH paid_per_order AS (
       SELECT p.order_id, SUM(p.montant)::float8 AS paid
       FROM professional_payments p
       WHERE p.tenant_id = $1::uuid AND p.statut = 'confirme'
       GROUP BY p.order_id
     ),
     share AS (
       SELECT en.order_id, u.filiere_id,
              SUM(en.prix_unitaire)::float8 AS part,
              COUNT(DISTINCT en.student_id) AS n_students
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
          AND SUM(sh.n_students) >= 10
          AND SUM(COALESCE(pp.paid, 0) * sh.part / NULLIF(t.total, 0)) / SUM(sh.part) < 0.5
     ) x`,
    [tenantId],
    log,
    "criticalRecoveryFilieres"
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

  /* ---------------- Qualité pédagogique et risque ---------------- */

  /**
   * Fenêtre d'observation de l'assiduité : les 30 derniers jours, recalés sur
   * la dernière séance connue si le semestre est clos. Sans ce recalage, un
   * établissement entre deux sessions verrait toutes ses règles d'assiduité
   * s'éteindre silencieusement — ce qui se lit comme « tout va bien ».
   */
  // Sous-requête scalaire évaluée par PostgreSQL : pas d'aller-retour par un
  // timestamp, donc pas de décalage de fuseau sur la borne de fenêtre.
  const windowEndSql = `(SELECT COALESCE(
      LEAST(CURRENT_DATE, GREATEST(
        (SELECT MAX(date) FROM professional_ecue_seances
          WHERE tenant_id = $1::uuid AND date <= CURRENT_DATE),
        CURRENT_DATE - 29
      )),
      CURRENT_DATE
    ))`;

  /**
   * Chute de la présence : la semaine écoulée décroche de plus de 10 points par
   * rapport au mois. C'est le signal précoce d'un décrochage collectif — une UE
   * qui se vide, un enseignant absent, un conflit d'emploi du temps.
   */
  const presenceDrop = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v FROM (
       SELECT u.filiere_id
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN professional_ue_sessions s ON s.id = se.ue_session_id AND s.tenant_id = se.tenant_id
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       WHERE a.tenant_id = $1::uuid
         AND se.date > ${windowEndSql} - 30
         AND se.date <= ${windowEndSql}
       GROUP BY u.filiere_id
       HAVING COUNT(*) FILTER (WHERE se.date > ${windowEndSql} - 7) >= 10
          AND 100.0 * COUNT(*) FILTER (WHERE se.date > ${windowEndSql} - 7
                                         AND a.statut IN ('present','retard'))
              / NULLIF(COUNT(*) FILTER (WHERE se.date > ${windowEndSql} - 7), 0)
            < 100.0 * COUNT(*) FILTER (WHERE a.statut IN ('present','retard'))
              / NULLIF(COUNT(*), 0) - 10
     ) x`,
    [tenantId],
    log,
    "presenceDrop"
  );

  /**
   * Enseignants qui ne font pas l'appel. Sans appel, aucune donnée d'assiduité
   * n'est fiable — et tout le reste du pilotage pédagogique en dépend.
   * Seuil de 5 séances passées : en dessous, le taux ne veut rien dire.
   */
  const teachersNotCalling = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v FROM (
       SELECT se.enseignant_id
       FROM professional_ecue_seances se
       WHERE se.tenant_id = $1::uuid
         AND se.enseignant_id IS NOT NULL
         AND se.date > ${windowEndSql} - 30
         AND se.date <= ${windowEndSql}
       GROUP BY se.enseignant_id
       HAVING COUNT(*) >= 5
          AND 100.0 * COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM professional_ecue_attendance a
                 WHERE a.seance_id = se.id AND a.tenant_id = se.tenant_id
              )) / COUNT(*) < 60
     ) x`,
    [tenantId],
    log,
    "teachersNotCalling"
  );

  /**
   * Conduites manquantes sur un semestre dont toutes les cohortes sont closes.
   * Une seule conduite absente bloque le calcul des bulletins de TOUT le
   * semestre : c'est le goulot d'étranglement le moins visible du module.
   */
  const missingConduite = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v FROM (
       SELECT sem.id
       FROM professional_semestres sem
       JOIN professional_semestre_ue su ON su.semestre_id = sem.id AND su.tenant_id = sem.tenant_id
       JOIN professional_ue_sessions s ON s.ue_id = su.ue_id AND s.tenant_id = sem.tenant_id
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
       JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
       JOIN professional_enrollments en
         ON en.ue_session_id = s.id AND en.tenant_id = s.tenant_id
        AND en.statut IN ('confirmee', 'terminee')
       WHERE sem.tenant_id = $1::uuid
         AND (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
         AND (s.statut = 'termine' OR s.date_fin < CURRENT_DATE)
         AND NOT EXISTS (
           SELECT 1 FROM professional_ecue_notes n
            WHERE n.tenant_id = sem.tenant_id
              AND n.ecue_id = e.id
              AND n.ue_session_id = s.id
              AND n.student_id = en.student_id
              AND n.nature = 'examen'
         )
       GROUP BY sem.id
     ) x`,
    [tenantId],
    log,
    "missingConduite"
  );

  /**
   * Notes d'examen jamais saisies 15 jours après la fin d'une cohorte.
   * Au-delà, la promotion attend ses bulletins et les réinscriptions bloquent.
   */
  const missingNotes = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v FROM (
       SELECT s.id, l.ecue_id
       FROM professional_ue_sessions s
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
       JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
       WHERE s.tenant_id = $1::uuid
         AND s.date_fin < CURRENT_DATE - 15
         AND s.statut <> 'annule'
         AND NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
         AND EXISTS (
           SELECT 1 FROM professional_enrollments en
            WHERE en.ue_session_id = s.id AND en.tenant_id = s.tenant_id
              AND en.statut IN ('confirmee', 'terminee')
         )
         AND NOT EXISTS (
           SELECT 1 FROM professional_ecue_notes n
            WHERE n.tenant_id = s.tenant_id
              AND n.ue_session_id = s.id
              AND n.ecue_id = l.ecue_id
              AND n.nature = 'examen'
         )
       GROUP BY s.id, l.ecue_id
     ) x`,
    [tenantId],
    log,
    "missingNotes"
  );

  /* ---------------- Remplissage : cohortes et planning ---------------- */

  /**
   * Cohortes qui démarrent dans les 7 jours sans aucun inscrit.
   *
   * C'est la décision go / no-go : passé la date de début, la salle est
   * réservée, l'enseignant est engagé, et la cohorte ne se remplira plus.
   */
  const emptyCohortsSoon = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
       FROM professional_ue_sessions s
      WHERE s.tenant_id = $1::uuid
        AND s.statut IN ('ouvert', 'complet', 'en_cours')
        AND s.date_debut BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
        AND NOT EXISTS (
          SELECT 1 FROM professional_enrollments pe
           WHERE pe.ue_session_id = s.id
             AND pe.tenant_id = s.tenant_id
             AND pe.statut <> 'annulee'
        )`,
    [tenantId],
    log,
    "emptyCohortsSoon"
  );

  /**
   * Cohortes qui démarrent dans les 7 jours sous 50 % de remplissage.
   *
   * Les cohortes sans `capacite_max` sont exclues : sans capacité déclarée il
   * n'y a pas de taux, et compter une donnée manquante comme un échec
   * commercial ferait sonner l'alerte pour rien.
   */
  const underfilledCohortsSoon = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
       FROM professional_ue_sessions s
      WHERE s.tenant_id = $1::uuid
        AND s.statut IN ('ouvert', 'complet', 'en_cours')
        AND s.date_debut BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
        AND s.capacite_max IS NOT NULL AND s.capacite_max > 0
        AND (
          SELECT COUNT(*) FROM professional_enrollments pe
           WHERE pe.ue_session_id = s.id
             AND pe.tenant_id = s.tenant_id
             AND pe.statut <> 'annulee'
        )::float8 / s.capacite_max < 0.5`,
    [tenantId],
    log,
    "underfilledCohortsSoon"
  );

  /**
   * Conflits de planning : même salle ou même enseignant sur deux créneaux qui
   * se chevauchent le même jour, sur des périodes qui se recouvrent.
   *
   * Rien ne les détecte à la saisie : sans cette règle, le conflit se découvre
   * en salle, devant les étudiants.
   */
  const planningConflicts = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
       FROM professional_emploi_temps a
       JOIN professional_emploi_temps b
         ON b.tenant_id = a.tenant_id
        AND b.id > a.id
        AND b.jour = a.jour
        AND a.heure_debut < b.heure_fin
        AND b.heure_debut < a.heure_fin
        AND COALESCE(a.date_debut, '-infinity'::date) <= COALESCE(b.date_fin, 'infinity'::date)
        AND COALESCE(b.date_debut, '-infinity'::date) <= COALESCE(a.date_fin, 'infinity'::date)
        AND (
          (a.classroom_id IS NOT NULL AND a.classroom_id = b.classroom_id)
          OR (a.enseignant_id IS NOT NULL AND a.enseignant_id = b.enseignant_id)
        )
      WHERE a.tenant_id = $1::uuid`,
    [tenantId],
    log,
    "planningConflicts"
  );

  /**
   * ECUE obligatoires sans enseignant sur une cohorte qui démarre sous 7 jours.
   *
   * Variante urgente de `ecueWithoutTeacher` : un cours non assuré au premier
   * jour, c'est un remboursement possible et une réputation entamée.
   */
  const ecueWithoutTeacherSoon = await countMetric(
    client,
    `SELECT COUNT(*)::text AS v
       FROM professional_ue_sessions s
       JOIN professional_ue_ecue l
         ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id AND l.est_obligatoire
      WHERE s.tenant_id = $1::uuid
        AND s.statut IN ('ouvert', 'complet', 'en_cours')
        AND s.date_debut BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
        AND NOT EXISTS (
          SELECT 1 FROM professional_session_ecue_teachers st
           WHERE st.ue_session_id = s.id
             AND st.ecue_id = l.ecue_id
             AND st.tenant_id = s.tenant_id
        )`,
    [tenantId],
    log,
    "ecueWithoutTeacherSoon"
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

  const fcfa = (v: number) => `${new Intl.NumberFormat("fr-FR").format(Math.round(v))} FCFA`;

  /**
   * `href` : sans lien vers l'écran d'action, une alerte n'est qu'un constat.
   * Chaque règle pointe l'endroit où la corriger.
   */
  const inserts: Array<{ domain: string; severity: string; message: string; href: string }> = [];

  if (payrollGap > 0) {
    inserts.push({
      domain: "auto_cash_below_payroll",
      severity: "high",
      message: `Trésorerie du mois insuffisante pour couvrir la paie : il manque ${fcfa(payrollGap)}.`,
      href: "/owner/finances/tresorerie",
    });
  }
  if (overdue90Amount > 0) {
    inserts.push({
      domain: "auto_overdue_90d",
      severity: "high",
      message: `${fcfa(overdue90Amount)} d'impayés dus depuis plus de 90 jours, tous moteurs confondus.`,
      href: "/owner/finances/tresorerie",
    });
  }
  if (criticalRecoveryFilieres > 0) {
    inserts.push({
      domain: "auto_pro_critical_recovery",
      severity: "high",
      message: `${criticalRecoveryFilieres} filière(s) sous 50 % de recouvrement sur au moins 10 étudiants.`,
      href: "/owner/finances/professionnel",
    });
  }
  if (ordersPaidWithoutPayment > 0) {
    inserts.push({
      domain: "auto_order_paid_no_payment",
      severity: "high",
      message: `${ordersPaidWithoutPayment} commande(s) marquée(s) « payée » sans aucune ligne de paiement : encaissement fantôme ou erreur de saisie.`,
      href: "/owner/finances/tresorerie",
    });
  }
  if (paymentsWithoutReceipt > 0) {
    inserts.push({
      domain: "auto_payment_no_receipt",
      severity: "high",
      message: `${paymentsWithoutReceipt} encaissement(s) sans numéro de reçu depuis plus de 48 heures.`,
      href: "/owner/finances/tresorerie",
    });
  }

  if (presenceDrop > 0) {
    inserts.push({
      domain: "auto_presence_drop",
      severity: "high",
      message: `${presenceDrop} filière(s) dont la présence de la dernière semaine décroche de plus de 10 points par rapport au mois.`,
      href: "/owner/risque",
    });
  }
  if (teachersNotCalling > 0) {
    inserts.push({
      domain: "auto_teachers_not_calling",
      severity: "medium",
      message: `${teachersNotCalling} enseignant(s) font l'appel sur moins de 60 % de leurs séances : les données d'assiduité deviennent inexploitables.`,
      href: "/owner/risque",
    });
  }
  if (missingConduite > 0) {
    inserts.push({
      domain: "auto_missing_conduite",
      severity: "high",
      message: `${missingConduite} semestre(s) clos dont il manque au moins une note de conduite : le calcul des bulletins est bloqué.`,
      href: "/professionnel/admin/conduite",
    });
  }
  if (missingNotes > 0) {
    inserts.push({
      domain: "auto_missing_notes",
      severity: "high",
      message: `${missingNotes} ECUE de cohortes closes depuis plus de 15 jours n'ont aucune note d'examen saisie.`,
      href: "/owner/risque",
    });
  }
  if (ecueWithoutTeacherSoon > 0) {
    inserts.push({
      domain: "auto_pro_ecue_no_teacher_soon",
      severity: "high",
      message: `${ecueWithoutTeacherSoon} ECUE obligatoire(s) sans enseignant sur une cohorte qui démarre sous 7 jours.`,
      href: "/owner/remplissage",
    });
  }
  if (emptyCohortsSoon > 0) {
    inserts.push({
      domain: "auto_pro_empty_cohort_soon",
      severity: "high",
      message: `${emptyCohortsSoon} cohorte(s) démarrent sous 7 jours sans aucun inscrit : à fermer ou à promouvoir maintenant.`,
      href: "/owner/remplissage",
    });
  }
  if (underfilledCohortsSoon > 0) {
    inserts.push({
      domain: "auto_pro_underfilled_cohort_soon",
      severity: "medium",
      message: `${underfilledCohortsSoon} cohorte(s) démarrent sous 7 jours à moins de 50 % de remplissage.`,
      href: "/owner/remplissage",
    });
  }
  if (planningConflicts > 0) {
    inserts.push({
      domain: "auto_planning_conflict",
      severity: "medium",
      message: `${planningConflicts} conflit(s) de planning : même salle ou même enseignant sur deux créneaux qui se chevauchent.`,
      href: "/owner/remplissage",
    });
  }

  if (tuitionOverdue > 0) {
    inserts.push({
      domain: "auto_tuition_overdue",
      severity: "high",
      message: `${tuitionOverdue} impayé(s) scolarité en retard de plus de 60 jours (élèves distincts).`,
      href: "/owner/finances/tresorerie",
    });
  }
  if (coursesGap > 0) {
    inserts.push({
      domain: "auto_courses_unassigned",
      severity: "medium",
      message: `${coursesGap} cours (références distinctes) sans enseignant titulaire actif sur des classes.`,
      href: "/owner/academique",
    });
  }
  if (payrollPending > 0) {
    inserts.push({
      domain: "auto_payroll_pending",
      severity: "medium",
      message: `${payrollPending} fiche(s) de rémunération enseignant en attente de validation.`,
      href: "/owner/staff",
    });
  }
  if (weakRecoveryFilieres > 0) {
    inserts.push({
      domain: "auto_pro_weak_recovery",
      severity: "high",
      message: `${weakRecoveryFilieres} filière(s) du module professionnel sous 60 % de recouvrement.`,
      href: "/owner/finances/professionnel",
    });
  }
  if (failingEcue > 0) {
    inserts.push({
      domain: "auto_pro_failing_ecue",
      severity: "high",
      message: `${failingEcue} ECUE avec plus de 50 % d'échecs sur au moins 10 résultats notés.`,
      href: "/owner/pedagogie",
    });
  }
  if (missedCallsRate > 30) {
    inserts.push({
      domain: "auto_pro_missed_calls",
      severity: "medium",
      message: `${missedCallsRate} % des séances passées des 30 derniers jours n'ont fait l'objet d'aucun appel.`,
      href: "/owner/assiduite",
    });
  }
  if (ecueWithoutTeacher > 0) {
    inserts.push({
      domain: "auto_pro_ecue_no_teacher",
      severity: "high",
      message: `${ecueWithoutTeacher} ECUE obligatoire(s) sans enseignant affecté sur une session ouverte.`,
      href: "/owner/assiduite",
    });
  }
  if (semestresWithoutBulletin > 0) {
    inserts.push({
      domain: "auto_pro_missing_bulletins",
      severity: "medium",
      message: `${semestresWithoutBulletin} semestre(s) clos depuis plus de 15 jours sans aucun bulletin généré.`,
      href: "/owner/pedagogie",
    });
  }
  if (ueCreditMismatch > 0) {
    inserts.push({
      domain: "auto_pro_ue_credit_mismatch",
      severity: "low",
      message: `${ueCreditMismatch} UE dont le nombre d'UV déclaré diffère de la somme des crédits de ses ECUE.`,
      href: "/owner/referentiel",
    });
  }

  for (const row of inserts) {
    try {
      await client.query(
        `INSERT INTO owner_pilotage_alerts (tenant_id, severity, message, domain, href)
         SELECT $1::uuid, $2::varchar(10), $3::text, $4::varchar(64), $5::text
         WHERE NOT EXISTS (
           SELECT 1 FROM owner_pilotage_alerts a
           WHERE a.tenant_id = $1::uuid
             AND a.domain = $4::varchar(64)
             AND a.acknowledged_at IS NULL
             AND a.resolved_at IS NULL
         )`,
        [tenantId, row.severity, row.message, row.domain, row.href]
      );
    } catch (e) {
      log.warn({ err: e, domain: row.domain }, "owner pilotage alert insert skipped");
    }
  }

  /**
   * Auto-résolution : toute alerte automatique encore ouverte dont la condition
   * n'est plus vraie est refermée.
   *
   * Sans cela, une alerte survivait à sa cause jusqu'à ce qu'un humain
   * l'acquitte : la liste se remplissait de constats périmés et les vraies
   * urgences s'y noyaient. `resolved_at` est distinct d'`acknowledged_at` — l'un
   * dit « le problème a disparu », l'autre « quelqu'un s'en est occupé ».
   *
   * Portée volontairement limitée aux domaines `auto_%` : une alerte créée à la
   * main n'a pas de condition à réévaluer.
   */
  try {
    const stillTrue = inserts.map((r) => r.domain);
    await client.query(
      `UPDATE owner_pilotage_alerts
          SET resolved_at = now()
        WHERE tenant_id = $1::uuid
          AND domain LIKE 'auto\\_%'
          AND acknowledged_at IS NULL
          AND resolved_at IS NULL
          AND NOT (domain = ANY($2::text[]))`,
      [tenantId, stillTrue]
    );
  } catch (e) {
    log.warn({ err: e }, "owner pilotage alerts auto-resolution skipped");
  }
}
