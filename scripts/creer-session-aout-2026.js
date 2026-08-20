/**
 * Crée une SESSION neuve avec ses séances, prête pour le cycle de paie.
 *
 *   node scripts/creer-session-aout-2026.js
 *
 * DONNÉES DE DÉMONSTRATION. À ne pas jouer sur une base de production.
 *
 * CE QUI EST CRÉÉ
 *   - une cohorte (`professional_ue_sessions`) sur une UE existante ;
 *   - l'affectation d'un enseignant TITULAIRE à chacune de ses ECUE ;
 *   - des séances réparties sur août 2026, passées en « réalisée ».
 *
 * DEUX PRÉCAUTIONS TIRÉES DU JEU PRÉCÉDENT
 *
 *   1. UN CRÉNEAU PROPRE À CHAQUE ENSEIGNANT. Les scripts d'essai posaient tous
 *      08:00–10:00 : deux séances du même enseignant le même jour se
 *      recoupaient, et l'écran signalait « payé deux fois ». Ici chaque
 *      intervenant a son créneau, et jamais deux séances le même jour.
 *
 *   2. LES SÉANCES NE SONT PAS VALIDÉES. Valider engage la dépense : c'est un
 *      acte de gestion, il revient à l'utilisateur. Le parcours commence donc à
 *      sa première étape, « Validation des séances », comme en vrai.
 *
 * Quelques séances sont confiées à des REMPLAÇANTS : `enseignant_id` porte
 * l'intervenant réel, ce que lit le collecteur d'heures. Cela met plusieurs
 * enseignants sur la même cohorte sans inventer d'affectations.
 */

const { connect } = require("./lib/api-client");

const SESSION = {
  libelle: "Cohorte Août 2026 — rattrapage",
  date_debut: "2026-08-01",
  date_fin: "2026-08-31",
  inscription_ouverte_le: "2026-07-01",
  inscription_fermee_le: "2026-07-31",
  capacite_max: 40,
};

/** Un créneau par intervenant : deux séances ne peuvent pas se recouper. */
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

  /* --- UE d'accueil : celle qui porte le plus d'ECUE --- */
  const ue = await s.sql(
    `SELECT ue.id, ue.code, ue.libelle, count(DISTINCT ec.id)::int AS nb_ecue
       FROM professional_ue ue
       JOIN professional_ue_ecue uee ON uee.ue_id = ue.id AND uee.tenant_id = ue.tenant_id
       JOIN professional_ecue ec ON ec.id = uee.ecue_id AND ec.tenant_id = ue.tenant_id
      WHERE ue.tenant_id = $1
      GROUP BY 1,2,3 ORDER BY 4 DESC, 2 LIMIT 1`,
    [s.tenant.id]
  );
  if (ue.rowCount === 0) throw new Error("aucune UE disponible");
  const UE = ue.rows[0];
  console.log(`UE d'accueil : ${UE.code} — ${UE.libelle} (${UE.nb_ecue} ECUE)`);

  const ecues = await s.sql(
    `SELECT ec.id, ec.code, ec.libelle
       FROM professional_ue_ecue uee
       JOIN professional_ecue ec ON ec.id = uee.ecue_id AND ec.tenant_id = uee.tenant_id
      WHERE uee.ue_id = $1 AND uee.tenant_id = $2
      ORDER BY ec.code`,
    [UE.id, s.tenant.id]
  );

  /* --- Enseignants configurés : titulaires puis remplaçants --- */
  const ens = await s.sql(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                     TRIM(t.first_name || ' ' || t.last_name)) AS nom
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
      WHERE t.tenant_id = $1 AND t.status = 'active'
        AND EXISTS (SELECT 1 FROM teacher_payment_configs c
                     WHERE c.teacher_id = t.id AND c.tenant_id = t.tenant_id
                       AND c.config_type = 'hourly')
      ORDER BY 2 LIMIT 4`,
    [s.tenant.id]
  );
  if (ens.rowCount < 2) throw new Error("il faut au moins 2 enseignants horaires configures");
  const titulaires = ens.rows.slice(0, ecues.rowCount);
  const remplacants = ens.rows.slice(ecues.rowCount);

  /* --- Rejouable : on efface la cohorte d'un passage précédent --- */
  const ancienne = await s.sql(
    `SELECT id FROM professional_ue_sessions WHERE tenant_id = $1 AND libelle = $2`,
    [s.tenant.id, SESSION.libelle]
  );
  for (const a of ancienne.rows) {
    await s.sql(`DELETE FROM professional_session_ecue_teachers WHERE ue_session_id = $1`, [a.id]);
    await s.sql(`DELETE FROM professional_ecue_seances WHERE ue_session_id = $1`, [a.id]);
    await s.sql(`DELETE FROM professional_ue_sessions WHERE id = $1`, [a.id]);
    console.log(`ancienne cohorte supprimee : ${a.id}`);
  }

  /* --- La cohorte --- */
  const creation = await s.api("POST", `${P}/ue/${UE.id}/sessions`, SESSION);
  if (!creation.ok) throw new Error(`creation refusee : ${JSON.stringify(creation.brut).slice(0, 300)}`);
  const sessionId = creation.body?.id ?? creation.brut?.data?.id;
  console.log(`cohorte creee : « ${SESSION.libelle} » — ${sessionId}`);

  /* --- Un titulaire par ECUE : l'affectation, pas seulement la séance.
         PUT et non POST : la route pose l'affectation d'une ECUE, elle ne
         crée pas une ressource nouvelle à chaque appel. */
  for (const [i, ec] of ecues.rows.entries()) {
    const t = titulaires[i % titulaires.length];
    const a = await s.api("PUT", `${P}/ue-sessions/${sessionId}/ecue-teachers`, {
      ecue_id: ec.id,
      enseignant_id: t.id,
    });
    console.log(
      `   ${a.ok ? "affecte" : "ECHEC  "} ${ec.code} -> ${t.nom}` +
        (a.ok ? "" : ` (${a.status} ${JSON.stringify(a.brut).slice(0, 120)})`)
    );
  }

  /* --- Les séances --- */
  const jours = joursOuvres();
  /* Chaque intervenant reçoit son propre créneau ET ses propres jours : deux
     séances du même enseignant ne peuvent donc jamais se chevaucher. */
  const intervenants = [
    ...titulaires.map((t, i) => ({ ...t, ecue: ecues.rows[i], creneau: CRENEAUX[i], role: "titulaire" })),
    ...remplacants.map((t, i) => ({
      ...t,
      ecue: ecues.rows[i % ecues.rowCount],
      creneau: CRENEAUX[titulaires.length + i],
      role: "remplaçant",
    })),
  ];

  let creees = 0;
  for (const [i, p] of intervenants.entries()) {
    /* Dates DÉJÀ OCCUPÉES par cet enseignant, toutes cohortes confondues.
       Un créneau propre à l'intervenant ne suffit pas : il peut avoir un cours
       ailleurs au même moment, et l'écran signalerait « payé deux fois ». */
    const occupees = await s.sql(
      `SELECT DISTINCT se.date::text AS d
         FROM professional_ecue_seances se
        WHERE se.tenant_id = $1 AND se.enseignant_id = $2
          AND se.date BETWEEN $3::date AND $4::date
          AND se.heure_debut < $6::time AND $5::time < se.heure_fin`,
      [s.tenant.id, p.id, SESSION.date_debut, SESSION.date_fin, p.creneau.heure_debut, p.creneau.heure_fin]
    );
    const prises = new Set(occupees.rows.map((r) => r.d));
    const libres = jours.filter((j) => !prises.has(j));
    if (libres.length < 4) {
      console.log(`   ${p.nom} : seulement ${libres.length} jour(s) libre(s) sur ce creneau`);
    }

    for (let k = 0; k < Math.min(4, libres.length); k++) {
      /* `(i + k) % n` avec n >= 4 donne quatre dates distinctes, décalées d'un
         intervenant à l'autre pour ne pas les empiler toutes le même jour. */
      const date = libres[(i + k) % libres.length];
      const c = await s.api("POST", `${P}/ue-sessions/${sessionId}/seances`, {
        ecue_id: p.ecue.id,
        date,
        ...p.creneau,
        enseignant_id: p.id,
        libelle: `${p.ecue.libelle} — ${p.role}`,
      });
      if (!c.ok) {
        console.log(`   ECHEC seance ${p.nom} ${date} : ${JSON.stringify(c.brut).slice(0, 140)}`);
        continue;
      }
      const id = c.body?.id ?? c.brut?.data?.id;
      const st = await s.api("PATCH", `${P}/remuneration/seances/${id}/statut`, { statut: "realisee" });
      if (st.ok) creees++;
      prises.add(date);
    }
    console.log(`   ${p.nom} (${p.role}) — ${p.creneau.heure_debut}-${p.creneau.heure_fin} sur ${p.ecue.code}`);
  }
  console.log(`\nseances creees et passees en « realisee » : ${creees}`);

  /* --- Contrôle : aucun chevauchement, rien de validé --- */
  const ctrl = await s.sql(
    `SELECT
       (SELECT count(*)::int FROM professional_ecue_seances
         WHERE ue_session_id = $1 AND validated_at IS NOT NULL) AS deja_validees,
       (SELECT count(*)::int FROM professional_ecue_seances a
          JOIN professional_ecue_seances b
            ON b.tenant_id = a.tenant_id AND b.id <> a.id
           AND b.enseignant_id = a.enseignant_id AND b.date = a.date
           AND a.heure_debut < b.heure_fin AND b.heure_debut < a.heure_fin
        WHERE a.ue_session_id = $1) AS chevauchements`,
    [sessionId]
  );
  console.log("controle :", JSON.stringify(ctrl.rows[0]), "(attendu 0 / 0)");

  const parEns = await s.sql(
    `SELECT COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                     TRIM(t.first_name || ' ' || t.last_name)) AS nom,
            count(*)::int AS seances,
            sum(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0)::float8 AS heures
       FROM professional_ecue_seances se
       JOIN teachers t ON t.id = se.enseignant_id
       LEFT JOIN users u ON u.id = t.user_id
      WHERE se.ue_session_id = $1
      GROUP BY 1 ORDER BY 1`,
    [sessionId]
  );
  console.log("\na valider depuis l'ecran « Validation des seances » :");
  console.table(parEns.rows);

  await s.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
