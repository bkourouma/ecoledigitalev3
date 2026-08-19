/**
 * Ajoute des séances de démonstration en décembre 2025 pour les enseignants qui
 * n'en ont aucune, puis recalcule la période — afin que TOUS les enseignants
 * configurés reçoivent un bulletin.
 *
 *   node scripts/ajouter-seances-decembre-2025.js
 *
 * DONNÉES DE DÉMONSTRATION. À ne pas jouer sur une base de production : ces
 * séances n'ont pas eu lieu.
 *
 * POURQUOI CES SÉANCES SONT COHÉRENTES
 * Aucune affectation `professional_session_ecue_teachers` n'est créée : il n'en
 * reste que 16 de libres, toutes sur des sessions 2027-2029, hors de décembre
 * 2025. On renseigne donc `enseignant_id` directement sur la séance — c'est
 * l'INTERVENANT RÉEL, remplacement compris, et c'est précisément ce que lit le
 * collecteur d'heures (cf. professional-hour-collector.ts). Les séances sont
 * rattachées aux 4 sessions réellement actives en décembre 2025.
 *
 * Le parcours complet est respecté, rien n'est écrit en base directement :
 *   création (planifiée) -> passage en réalisée -> validation en lot -> calcul.
 */

const { connect } = require("./lib/api-client");

const DEBUT = "2025-12-01";
const FIN = "2025-12-31";
const SEANCES_PAR_ENSEIGNANT = 4;
const CRENEAU = { heure_debut: "08:00", heure_fin: "10:00" }; // 2 h par séance

/** Jours ouvrés de décembre 2025, au format YYYY-MM-DD. */
function joursOuvres() {
  const jours = [];
  for (let j = 1; j <= 31; j++) {
    const d = new Date(Date.UTC(2025, 11, j));
    const jour = d.getUTCDay();
    if (jour !== 0 && jour !== 6) jours.push(`2025-12-${String(j).padStart(2, "0")}`);
  }
  return jours;
}

(async () => {
  const s = await connect({ tenantSlug: "ecoledigitale" });
  const P = "/api/v1/professional";

  /* --- Enseignants configurés SANS séance collectable en décembre 2025 --- */
  const cibles = await s.sql(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                     TRIM(t.first_name || ' ' || t.last_name)) AS nom
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
      WHERE t.tenant_id = $1 AND t.status = 'active'
        AND EXISTS (SELECT 1 FROM teacher_payment_configs c
                     WHERE c.teacher_id = t.id AND c.tenant_id = t.tenant_id)
        AND NOT EXISTS (
              SELECT 1 FROM professional_ecue_seances se
               WHERE se.enseignant_id = t.id AND se.tenant_id = t.tenant_id
                 AND se.date BETWEEN $2::date AND $3::date
                 AND se.statut = 'realisee' AND se.validated_at IS NOT NULL)
      ORDER BY 2`,
    [s.tenant.id, DEBUT, FIN]
  );
  console.log(`enseignants sans seance en decembre 2025 : ${cibles.rowCount}`);

  /* --- Couples (session, ECUE) des sessions actives en décembre 2025 --- */
  const couples = await s.sql(
    `SELECT us.id AS session_id, ec.id AS ecue_id, ec.code
       FROM professional_ue_sessions us
       JOIN professional_ue_ecue ue ON ue.ue_id = us.ue_id AND ue.tenant_id = us.tenant_id
       JOIN professional_ecue ec ON ec.id = ue.ecue_id AND ec.tenant_id = us.tenant_id
      WHERE us.tenant_id = $1 AND us.date_debut <= $3::date AND us.date_fin >= $2::date
      ORDER BY ec.code`,
    [s.tenant.id, DEBUT, FIN]
  );
  console.log(`couples (session, ECUE) disponibles : ${couples.rowCount}`);
  if (couples.rowCount === 0) throw new Error("Aucune session active en decembre 2025.");

  const jours = joursOuvres();
  const creees = [];
  let echecs = 0;

  for (const [i, t] of cibles.rows.entries()) {
    const couple = couples.rows[i % couples.rowCount];
    for (let k = 0; k < SEANCES_PAR_ENSEIGNANT; k++) {
      // Dates distinctes par enseignant : pas de chevauchement avec soi-même.
      const date = jours[(i * SEANCES_PAR_ENSEIGNANT + k) % jours.length];

      const c = await s.api("POST", `${P}/ue-sessions/${couple.session_id}/seances`, {
        ecue_id: couple.ecue_id,
        date,
        ...CRENEAU,
        enseignant_id: t.id,
        libelle: `Séance de démonstration — ${couple.code}`,
      });
      if (!c.ok) {
        echecs++;
        if (echecs <= 3) console.log(`   ECHEC creation ${t.nom} ${date} : ${c.status} ${JSON.stringify(c.brut).slice(0, 160)}`);
        continue;
      }
      const id = c.body?.id ?? c.brut?.data?.id;

      // Une séance naît « planifiée » : la passer en réalisée est le constat.
      const st = await s.api("PATCH", `${P}/remuneration/seances/${id}/statut`, {
        statut: "realisee",
      });
      if (!st.ok) {
        echecs++;
        if (echecs <= 3) console.log(`   ECHEC statut ${t.nom} : ${st.status} ${JSON.stringify(st.brut).slice(0, 160)}`);
        continue;
      }
      creees.push(id);
    }
  }
  console.log(`seances creees et passees en realisee : ${creees.length} (echecs : ${echecs})`);
  if (creees.length === 0) { await s.close(); return; }

  /* --- Validation en lot : c'est elle qui les rend payables --- */
  const lots = [];
  for (let i = 0; i < creees.length; i += 50) lots.push(creees.slice(i, i + 50));
  let validees = 0;
  for (const lot of lots) {
    const v = await s.api("POST", `${P}/remuneration/seances/validate`, {
      seanceIds: lot,
      validated: true,
    });
    if (v.ok) validees += lot.length;
    else console.log(`   ECHEC validation : ${v.status} ${JSON.stringify(v.brut).slice(0, 200)}`);
  }
  console.log(`seances validees : ${validees}`);

  /* --- Recalcul de la période en cours --- */
  const p = await s.sql(
    `SELECT id, name FROM payment_periods
      WHERE tenant_id = $1 AND status <> 'archived'
      ORDER BY created_at DESC LIMIT 1`,
    [s.tenant.id]
  );
  if (p.rowCount === 0) throw new Error("Aucune periode ouverte a recalculer.");
  console.log(`\nrecalcul de « ${p.rows[0].name} »`);
  const calc = await s.api("POST", "/api/v1/teacher-payments/calculate", {
    periodId: p.rows[0].id,
    recalculate: true,
    scope: "all",
  });
  const c = calc.body ?? {};
  console.log(`   calcules ${c.calculated} | ecartes ${c.skipped} | erreurs ${c.errors}`);
  const motifs = {};
  for (const r of c.results ?? []) {
    if (r.status !== "calculated") motifs[r.skipReason ?? r.status] = (motifs[r.skipReason ?? r.status] ?? 0) + 1;
  }
  for (const [m, n] of Object.entries(motifs)) console.log(`      ${m} : ${n}`);

  const bul = await s.sql(
    `SELECT count(*)::int AS bulletins, sum(total_amount)::float8 AS total,
            count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archives
       FROM teacher_payments WHERE payment_period_id = $1`,
    [p.rows[0].id]
  );
  console.log(`\nbulletins : ${bul.rows[0].bulletins} | total ${new Intl.NumberFormat("fr-FR").format(Math.round(bul.rows[0].total))} XOF | archives ${bul.rows[0].archives}`);

  await s.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
