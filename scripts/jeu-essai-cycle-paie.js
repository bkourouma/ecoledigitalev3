/**
 * Jeu d'essai du CYCLE DE PAIE complet — période « Février 2026 ».
 *
 *   node scripts/jeu-essai-cycle-paie.js
 *
 * DONNÉES DE DÉMONSTRATION. À ne pas jouer sur une base de production : les
 * séances créées ici n'ont pas eu lieu.
 *
 * OBJECTIF : poser sur un même écran les quatre situations que le cycle doit
 * savoir distinguer, pour qu'elles se comparent d'un coup d'œil.
 *
 *   A. heures validées          -> bulletin généré, à archiver puis verser
 *   B. séances faites NON validées -> AUCUN bulletin, mais l'écran le signale
 *   C. ni séance ni heure       -> aucun bulletin, silence normal
 *   D. salaire fixe             -> bulletin même sans heure
 *
 * Le script s'arrête APRÈS la génération : l'archivage et le versement sont
 * laissés à l'utilisateur, ce sont eux qu'il s'agit d'essayer.
 */

const { connect } = require("./lib/api-client");

const PERIODE = { name: "Février 2026", periodStart: "2026-02-01", periodEnd: "2026-02-28" };
const CRENEAU = { heure_debut: "08:00", heure_fin: "10:00" }; // 2 h
const AVEC_HEURES = 8; // groupe A
const NON_VALIDEES = 4; // groupe B
const SEANCES_PAR_ENSEIGNANT = 3;

function joursOuvres() {
  const jours = [];
  for (let j = 1; j <= 28; j++) {
    const jour = new Date(Date.UTC(2026, 1, j)).getUTCDay();
    if (jour !== 0 && jour !== 6) jours.push(`2026-02-${String(j).padStart(2, "0")}`);
  }
  return jours;
}

(async () => {
  const s = await connect({ tenantSlug: "ecoledigitale" });
  const P = "/api/v1/professional";

  /* --- Nettoyage : une seule période ouverte à la fois --- */
  const ouvertes = await s.sql(
    `SELECT id, name FROM payment_periods
      WHERE tenant_id = $1 AND status <> 'archived'
        AND EXISTS (SELECT 1 FROM teacher_payments tp
                     WHERE tp.payment_period_id = payment_periods.id
                       AND tp.archived_at IS NULL)`,
    [s.tenant.id]
  );
  if (ouvertes.rowCount > 0) {
    console.log(`periode(s) encore au plan de travail : ${ouvertes.rows.map((r) => r.name).join(", ")}`);
    console.log("   -> archivez-les depuis l'ecran avant de rejouer ce script.");
    await s.close();
    return;
  }

  /* --- Répartition des enseignants configurés --- */
  const tous = await s.sql(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                     TRIM(t.first_name || ' ' || t.last_name)) AS nom,
            c.config_type::text AS mode
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
       JOIN LATERAL (SELECT config_type FROM teacher_payment_configs c2
                      WHERE c2.teacher_id = t.id AND c2.tenant_id = t.tenant_id LIMIT 1) c ON TRUE
      WHERE t.tenant_id = $1 AND t.status = 'active'
      ORDER BY (c.config_type::text = 'hourly') DESC, 2`,
    [s.tenant.id]
  );
  const horaires = tous.rows.filter((t) => t.mode === "hourly");
  const groupeA = horaires.slice(0, AVEC_HEURES);
  const groupeB = horaires.slice(AVEC_HEURES, AVEC_HEURES + NON_VALIDEES);
  const groupeC = horaires.slice(AVEC_HEURES + NON_VALIDEES);
  const groupeD = tous.rows.filter((t) => t.mode !== "hourly");

  console.log(`enseignants : ${tous.rowCount}`);
  console.log(`   A. avec heures validees        : ${groupeA.length}`);
  console.log(`   B. seances NON validees        : ${groupeB.length}  <- alerte attendue`);
  console.log(`   C. rien du tout                : ${groupeC.length}  <- aucun bulletin`);
  console.log(`   D. salaire fixe / mixte        : ${groupeD.length}  <- bulletin sans heure`);

  /* --- Couples (session, ECUE) actifs sur la période --- */
  const couples = await s.sql(
    `SELECT us.id AS session_id, ec.id AS ecue_id, ec.code
       FROM professional_ue_sessions us
       JOIN professional_ue_ecue ue ON ue.ue_id = us.ue_id AND ue.tenant_id = us.tenant_id
       JOIN professional_ecue ec ON ec.id = ue.ecue_id AND ec.tenant_id = us.tenant_id
      WHERE us.tenant_id = $1 AND us.date_debut <= $3::date AND us.date_fin >= $2::date
      ORDER BY ec.code`,
    [s.tenant.id, PERIODE.periodStart, PERIODE.periodEnd]
  );
  if (couples.rowCount === 0) throw new Error("aucune session active en fevrier 2026");

  const jours = joursOuvres();

  /** Crée des séances réalisées ; les valide seulement si demandé. */
  async function poser(groupe, valider, decalage) {
    const ids = [];
    for (const [i, t] of groupe.entries()) {
      const couple = couples.rows[(i + decalage) % couples.rowCount];
      for (let k = 0; k < SEANCES_PAR_ENSEIGNANT; k++) {
        const date = jours[((i + decalage) * SEANCES_PAR_ENSEIGNANT + k) % jours.length];
        const c = await s.api("POST", `${P}/ue-sessions/${couple.session_id}/seances`, {
          ecue_id: couple.ecue_id,
          date,
          ...CRENEAU,
          enseignant_id: t.id,
          libelle: `Séance de démonstration — ${couple.code}`,
        });
        if (!c.ok) continue;
        const id = c.body?.id ?? c.brut?.data?.id;
        const st = await s.api("PATCH", `${P}/remuneration/seances/${id}/statut`, {
          statut: "realisee",
        });
        if (st.ok) ids.push(id);
      }
    }
    if (valider) {
      for (let i = 0; i < ids.length; i += 50) {
        await s.api("POST", `${P}/remuneration/seances/validate`, {
          seanceIds: ids.slice(i, i + 50),
          validated: true,
        });
      }
    }
    return ids.length;
  }

  const nbA = await poser(groupeA, true, 0);
  console.log(`\nA. ${nbA} seances creees et VALIDEES`);
  const nbB = await poser(groupeB, false, groupeA.length);
  console.log(`B. ${nbB} seances creees, LAISSEES NON VALIDEES`);

  /* --- Période puis génération --- */
  const creation = await s.api("POST", "/api/v1/payment-periods", PERIODE);
  if (!creation.ok) throw new Error(`creation refusee : ${JSON.stringify(creation.brut).slice(0, 300)}`);
  const periodId = creation.body?.id ?? creation.brut?.data?.id;
  console.log(`\nperiode « ${PERIODE.name} » creee — ${periodId}`);

  const calc = await s.api("POST", "/api/v1/teacher-payments/calculate", {
    periodId,
    recalculate: true,
    scope: "all",
  });
  const c = calc.body ?? {};
  console.log(`generation : calcules ${c.calculated} | ecartes ${c.skipped} | erreurs ${c.errors}`);
  const motifs = {};
  for (const r of c.results ?? []) {
    if (r.status !== "calculated") motifs[r.skipReason ?? r.status] = (motifs[r.skipReason ?? r.status] ?? 0) + 1;
  }
  for (const [m, n] of Object.entries(motifs)) console.log(`   ${m} : ${n}`);

  /* --- Ce qui attend l'utilisateur --- */
  const bilan = await s.sql(
    `SELECT count(*)::int AS bulletins, sum(total_amount)::float8 AS total,
            count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archives
       FROM teacher_payments WHERE payment_period_id = $1`,
    [periodId]
  );
  const global = await s.sql(
    `SELECT status::text AS statut, count(*)::int AS n
       FROM teacher_payments WHERE tenant_id = $1 GROUP BY 1 ORDER BY 2 DESC`,
    [s.tenant.id]
  );
  const b = bilan.rows[0];
  console.log(
    `\nA ESSAYER : ${b.bulletins} bulletin(s) au plan de travail, ` +
      `${new Intl.NumberFormat("fr-FR").format(Math.round(b.total))} XOF, ${b.archives} archive(s)`
  );
  console.log("etat global des bulletins :");
  console.table(global.rows);

  await s.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
