/**
 * Jeu d'essai « payés / impayés » — période Janvier 2026.
 *
 *   node scripts/parcours-paie-janvier-2026.js
 *
 * DONNÉES DE DÉMONSTRATION. À ne pas jouer sur une base de production : les
 * séances créées ici n'ont pas eu lieu.
 *
 * OBJECTIF. Obtenir les deux issues de l'archivage sur une même période :
 *   - enseignants AVEC heures  -> bulletin > 0 -> « payé » une fois archivé ;
 *   - enseignants SANS heures  -> bulletin à 0 -> « impayé » une fois archivé.
 *
 * La moitié des enseignants reçoit donc des séances, l'autre non — au lieu de
 * n'en donner à personne ou à tout le monde, qui ne produirait qu'un seul des
 * deux statuts.
 *
 * L'ARCHIVAGE N'EST PAS FAIT : les bulletins restent au plan de travail, le
 * bouton « Archiver » est laissé à l'utilisateur.
 */

const { connect } = require("./lib/api-client");

const PERIODE = { name: "Janvier 2026", periodStart: "2026-01-01", periodEnd: "2026-01-31" };
const SEANCES_PAR_ENSEIGNANT = 3;
const CRENEAU = { heure_debut: "08:00", heure_fin: "10:00" }; // 2 h
/** Part des enseignants qui recevront des heures. Le reste sortira à zéro. */
const PART_AVEC_HEURES = 0.5;

/** Jours ouvrés de janvier 2026. */
function joursOuvres() {
  const jours = [];
  for (let j = 1; j <= 31; j++) {
    const jour = new Date(Date.UTC(2026, 0, j)).getUTCDay();
    if (jour !== 0 && jour !== 6) jours.push(`2026-01-${String(j).padStart(2, "0")}`);
  }
  return jours;
}

(async () => {
  const s = await connect({ tenantSlug: "ecoledigitale" });
  const P = "/api/v1/professional";

  /* --- Qui a déjà des heures collectables sur janvier 2026 ? --- */
  const tous = await s.sql(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                     TRIM(t.first_name || ' ' || t.last_name)) AS nom,
            EXISTS (SELECT 1 FROM professional_ecue_seances se
                     WHERE se.enseignant_id = t.id AND se.tenant_id = t.tenant_id
                       AND se.date BETWEEN $2::date AND $3::date
                       AND se.statut = 'realisee' AND se.validated_at IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM payment_hour_details phd
                                         JOIN teacher_payments tp ON tp.id = phd.payment_id
                                        WHERE phd.seance_id = se.id AND tp.status <> 'cancelled')
                   ) AS a_des_heures
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
      WHERE t.tenant_id = $1 AND t.status = 'active'
        AND EXISTS (SELECT 1 FROM teacher_payment_configs c
                     WHERE c.teacher_id = t.id AND c.tenant_id = t.tenant_id)
      ORDER BY 2`,
    [s.tenant.id, PERIODE.periodStart, PERIODE.periodEnd]
  );

  const dejaServis = tous.rows.filter((t) => t.a_des_heures);
  const sansHeures = tous.rows.filter((t) => !t.a_des_heures);
  const cible = Math.round(tous.rowCount * PART_AVEC_HEURES);
  const aServir = sansHeures.slice(0, Math.max(0, cible - dejaServis.length));
  const resteronsVides = sansHeures.slice(aServir.length);

  console.log(`enseignants configures : ${tous.rowCount}`);
  console.log(`   ont deja des heures en janvier 2026 : ${dejaServis.length}`);
  console.log(`   recevront des seances de demo       : ${aServir.length}`);
  console.log(`   resteront SANS heures (-> impayes)  : ${resteronsVides.length}`);

  /* --- Couples (session, ECUE) actifs en janvier 2026 --- */
  const couples = await s.sql(
    `SELECT us.id AS session_id, ec.id AS ecue_id, ec.code
       FROM professional_ue_sessions us
       JOIN professional_ue_ecue ue ON ue.ue_id = us.ue_id AND ue.tenant_id = us.tenant_id
       JOIN professional_ecue ec ON ec.id = ue.ecue_id AND ec.tenant_id = us.tenant_id
      WHERE us.tenant_id = $1 AND us.date_debut <= $3::date AND us.date_fin >= $2::date
      ORDER BY ec.code`,
    [s.tenant.id, PERIODE.periodStart, PERIODE.periodEnd]
  );
  if (couples.rowCount === 0) throw new Error("Aucune session active en janvier 2026.");
  console.log(`couples (session, ECUE) disponibles : ${couples.rowCount}`);

  /* --- Création des séances, statut réalisée, puis validation --- */
  const jours = joursOuvres();
  const creees = [];
  for (const [i, t] of aServir.entries()) {
    const couple = couples.rows[i % couples.rowCount];
    for (let k = 0; k < SEANCES_PAR_ENSEIGNANT; k++) {
      const date = jours[(i * SEANCES_PAR_ENSEIGNANT + k) % jours.length];
      const c = await s.api("POST", `${P}/ue-sessions/${couple.session_id}/seances`, {
        ecue_id: couple.ecue_id,
        date,
        ...CRENEAU,
        enseignant_id: t.id,
        libelle: `Séance de démonstration — ${couple.code}`,
      });
      if (!c.ok) continue;
      const id = c.body?.id ?? c.brut?.data?.id;
      const st = await s.api("PATCH", `${P}/remuneration/seances/${id}/statut`, { statut: "realisee" });
      if (st.ok) creees.push(id);
    }
  }
  console.log(`seances creees et passees en realisee : ${creees.length}`);

  for (let i = 0; i < creees.length; i += 50) {
    await s.api("POST", `${P}/remuneration/seances/validate`, {
      seanceIds: creees.slice(i, i + 50),
      validated: true,
    });
  }
  console.log(`seances validees : ${creees.length}`);

  /* --- Période puis calcul --- */
  console.log(`\nperiode « ${PERIODE.name} » (${PERIODE.periodStart} -> ${PERIODE.periodEnd})`);
  const creation = await s.api("POST", "/api/v1/payment-periods", PERIODE);
  if (!creation.ok) throw new Error(`creation refusee : ${JSON.stringify(creation.brut).slice(0, 300)}`);
  const periodId = creation.body?.id ?? creation.brut?.data?.id;
  console.log(`   creee — id ${periodId}`);

  const calc = await s.api("POST", "/api/v1/teacher-payments/calculate", {
    periodId,
    recalculate: true,
    scope: "all",
  });
  const c = calc.body ?? {};
  console.log(`   calcules ${c.calculated} | ecartes ${c.skipped} | erreurs ${c.errors}`);

  /* --- Ce que l'archivage produira --- */
  const bilan = await s.sql(
    `SELECT count(*)::int AS bulletins,
            count(*) FILTER (WHERE total_amount > 0)::int AS futurs_payes,
            count(*) FILTER (WHERE total_amount <= 0)::int AS futurs_impayes,
            sum(total_amount)::float8 AS total,
            count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archives
       FROM teacher_payments WHERE payment_period_id = $1`,
    [periodId]
  );
  const b = bilan.rows[0];
  console.log(`\nbulletins : ${b.bulletins} | total ${new Intl.NumberFormat("fr-FR").format(Math.round(b.total))} XOF`);
  console.log(`   deviendront PAYE   a l'archivage : ${b.futurs_payes}`);
  console.log(`   deviendront IMPAYE a l'archivage : ${b.futurs_impayes}`);
  console.log(`   archives maintenant : ${b.archives} (doit rester 0)`);

  await s.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
