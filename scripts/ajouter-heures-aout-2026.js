/**
 * Étoffe la cohorte d'août 2026 : plus d'intervenants, heures VALIDÉES.
 *
 *   node scripts/ajouter-heures-aout-2026.js
 *
 * DONNÉES DE DÉMONSTRATION. À ne pas jouer sur une base de production.
 *
 * S'arrête AVANT la génération des bulletins : la période reste en attente de
 * calcul, le bouton « Générer les bulletins de cette période » est laissé à
 * l'utilisateur. C'est le geste qu'il s'agit d'essayer.
 *
 * CHOIX DES CRÉNEAUX. Chaque séance est placée sur un couple (jour, créneau)
 * que l'enseignant a réellement libre, vérifié contre TOUTES ses séances —
 * y compris celles d'autres cohortes. Un créneau simplement « propre à
 * l'intervenant » ne suffisait pas : un enseignant peut avoir cours ailleurs au
 * même moment, et l'écran signale alors « payé deux fois ».
 */

const { connect } = require("./lib/api-client");

const COHORTE = "Cohorte Août 2026 — rattrapage";
const DEBUT = "2026-08-01";
const FIN = "2026-08-31";
const SEANCES_PAR_ENSEIGNANT = 4;
const CIBLE_INTERVENANTS = 22;
/** Créée en fin de script s'il n'y en a pas déjà une en attente. */
const PERIODE = { name: "Août 2026 — complément", periodStart: DEBUT, periodEnd: FIN };

const CRENEAUX = [
  { heure_debut: "08:00", heure_fin: "10:00" },
  { heure_debut: "10:15", heure_fin: "12:15" },
  { heure_debut: "14:00", heure_fin: "16:00" },
  { heure_debut: "16:15", heure_fin: "18:15" },
];

/** Jours ouvrés d'août 2026 déjà passés — on ne paie pas du futur. */
function joursOuvres() {
  const jours = [];
  for (let j = 3; j <= 19; j++) {
    const jour = new Date(Date.UTC(2026, 7, j)).getUTCDay();
    if (jour !== 0 && jour !== 6) jours.push(`2026-08-${String(j).padStart(2, "0")}`);
  }
  return jours;
}

(async () => {
  const s = await connect({ tenantSlug: "ecoledigitale" });
  const P = "/api/v1/professional";

  const coh = await s.sql(
    `SELECT id FROM professional_ue_sessions WHERE tenant_id = $1 AND libelle = $2`,
    [s.tenant.id, COHORTE]
  );
  if (coh.rowCount === 0) throw new Error(`cohorte « ${COHORTE} » introuvable`);
  const sessionId = coh.rows[0].id;

  const ecues = await s.sql(
    `SELECT DISTINCT ec.id, ec.code, ec.libelle
       FROM professional_ue_sessions us
       JOIN professional_ue_ecue uee ON uee.ue_id = us.ue_id AND uee.tenant_id = us.tenant_id
       JOIN professional_ecue ec ON ec.id = uee.ecue_id AND ec.tenant_id = us.tenant_id
      WHERE us.id = $1 ORDER BY ec.code`,
    [sessionId]
  );

  /* Enseignants horaires SANS heure sur la période : ceux qu'on ajoute. */
  const candidats = await s.sql(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                     TRIM(t.first_name || ' ' || t.last_name)) AS nom
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
      WHERE t.tenant_id = $1 AND t.status = 'active'
        AND EXISTS (SELECT 1 FROM teacher_payment_configs c
                     WHERE c.teacher_id = t.id AND c.tenant_id = t.tenant_id
                       AND c.config_type = 'hourly')
        AND NOT EXISTS (SELECT 1 FROM professional_ecue_seances se
                         WHERE se.enseignant_id = t.id AND se.tenant_id = t.tenant_id
                           AND se.date BETWEEN $2::date AND $3::date)
      ORDER BY 2`,
    [s.tenant.id, DEBUT, FIN]
  );

  const dejaEnPlace = await s.sql(
    `SELECT count(DISTINCT enseignant_id)::int n FROM professional_ecue_seances
      WHERE tenant_id = $1 AND date BETWEEN $2::date AND $3::date`,
    [s.tenant.id, DEBUT, FIN]
  );
  const aAjouter = Math.max(0, CIBLE_INTERVENANTS - dejaEnPlace.rows[0].n);
  const retenus = candidats.rows.slice(0, aAjouter);

  console.log(`intervenants deja sur aout 2026 : ${dejaEnPlace.rows[0].n}`);
  console.log(`intervenants ajoutes            : ${retenus.length}`);

  const jours = joursOuvres();
  const creees = [];

  for (const [i, t] of retenus.entries()) {
    /* Ce que cet enseignant a déjà, toutes cohortes confondues. */
    const occupe = await s.sql(
      `SELECT se.date::text AS d, se.heure_debut::text AS hd, se.heure_fin::text AS hf
         FROM professional_ecue_seances se
        WHERE se.tenant_id = $1 AND se.enseignant_id = $2
          AND se.date BETWEEN $3::date AND $4::date`,
      [s.tenant.id, t.id, DEBUT, FIN]
    );
    const pris = occupe.rows.map((r) => ({ d: r.d, hd: r.hd.slice(0, 5), hf: r.hf.slice(0, 5) }));
    const chevauche = (d, c) =>
      pris.some((p) => p.d === d && p.hd < c.heure_fin && c.heure_debut < p.hf);

    let poses = 0;
    /* On balaie les créneaux en décalant par enseignant : les séances se
       répartissent sur la semaine au lieu de s'empiler le même jour. */
    for (let k = 0; k < jours.length * CRENEAUX.length && poses < SEANCES_PAR_ENSEIGNANT; k++) {
      const date = jours[(i + k) % jours.length];
      const creneau = CRENEAUX[Math.floor((i + k) / jours.length) % CRENEAUX.length];
      if (chevauche(date, creneau)) continue;

      const ecue = ecues.rows[(i + poses) % ecues.rowCount];
      const c = await s.api("POST", `${P}/ue-sessions/${sessionId}/seances`, {
        ecue_id: ecue.id,
        date,
        ...creneau,
        enseignant_id: t.id,
        libelle: `${ecue.libelle} — intervenant`,
      });
      if (!c.ok) continue;
      const id = c.body?.id ?? c.brut?.data?.id;
      const st = await s.api("PATCH", `${P}/remuneration/seances/${id}/statut`, {
        statut: "realisee",
      });
      if (!st.ok) continue;

      pris.push({ d: date, hd: creneau.heure_debut, hf: creneau.heure_fin });
      creees.push(id);
      poses++;
    }
    if (poses < SEANCES_PAR_ENSEIGNANT) {
      console.log(`   ${t.nom} : ${poses}/${SEANCES_PAR_ENSEIGNANT} seance(s) seulement`);
    }
  }
  console.log(`seances creees et passees en « realisee » : ${creees.length}`);

  /* --- Validation : c'est elle qui rend les heures payables --- */
  const aValider = await s.sql(
    `SELECT id FROM professional_ecue_seances
      WHERE tenant_id = $1 AND date BETWEEN $2::date AND $3::date
        AND statut = 'realisee' AND validated_at IS NULL AND enseignant_id IS NOT NULL`,
    [s.tenant.id, DEBUT, FIN]
  );
  let validees = 0;
  const ids = aValider.rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 50) {
    const lot = ids.slice(i, i + 50);
    const v = await s.api("POST", `${P}/remuneration/seances/validate`, {
      seanceIds: lot,
      validated: true,
    });
    if (v.ok) validees += v.body?.updated ?? lot.length;
    else console.log(`   ECHEC validation : ${JSON.stringify(v.brut).slice(0, 200)}`);
  }
  console.log(`seances validees : ${validees}`);

  /* --- Contrôles --- */
  const ov = await s.api(
    "GET",
    `${P}/remuneration/seances/overlaps?fromDate=${DEBUT}&toDate=${FIN}`
  );
  console.log(`chevauchements signales : ${Array.isArray(ov.body) ? ov.body.length : 0} (attendu 0)`);

  /* --- La période, si aucune n'attend déjà son calcul ---
     Le verrou d'unicité l'interdirait, et surtout : deux périodes ouvertes
     laisseraient le gestionnaire sans savoir laquelle alimente quoi. */
  const attente = await s.api("GET", `${P}/remuneration/bulletins/periode-en-attente`);
  if (attente.body?.periode) {
    console.log(`\nperiode deja en attente : « ${attente.body.periode.nom} » — aucune creation`);
  } else {
    const cr = await s.api("POST", "/api/v1/payment-periods", PERIODE);
    if (!cr.ok) throw new Error(`creation refusee : ${JSON.stringify(cr.brut).slice(0, 300)}`);
    console.log(`\nperiode creee : « ${PERIODE.name} » (${DEBUT} -> ${FIN})`);
  }

  const o = await s.api("GET", `${P}/remuneration/bulletins/enseignants`);
  const b = o.body ?? {};
  const avecHeures = (b.items ?? []).filter((e) => e.heures.nb_seances > 0);
  console.log(`periode courante : ${b.periode_courante ? b.periode_courante.nom : "AUCUNE"}`);
  console.log(`enseignants avec heures a payer : ${avecHeures.length}`);
  console.table(
    avecHeures.map((e) => ({
      nom: e.nom,
      seances: e.heures.nb_seances,
      heures: e.heures.totales,
      mode: e.config?.config_type ?? "—",
    }))
  );
  console.log(`bulletins deja generes : ${(b.items ?? []).filter((e) => e.bulletin).length} (attendu 0)`);

  await s.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
