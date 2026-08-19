#!/usr/bin/env node

/**
 * Rattrapage des seances attendues a l'emploi du temps mais jamais
 * enregistrees — feature 031.
 *
 * CE QUE FAIT LE SCRIPT
 *   1. recense les creneaux attendus sans seance correspondante ;
 *   2. cree la seance manquante (API : elle nait 'realisee' + saisie_comptable) ;
 *   3. valide toutes les seances realisees non validees.
 *
 * BORNE AU PASSE. Les creneaux a venir ne sont pas crees : declarer 'realisee'
 * un cours de 2029 reviendrait a affirmer qu'il a eu lieu, et a le payer.
 *
 * PASSE PAR L'API, jamais par des INSERT directs : les regles de payabilite,
 * les verrous de paiement et la tracabilite (qui a saisi, qui a valide) vivent
 * dans les services. Un INSERT les contournerait tous, et l'ecran afficherait
 * des seances que le calcul refuserait.
 *
 * Usage :
 *   node scripts/traiter-seances-manquantes.js            (simulation)
 *   node scripts/traiter-seances-manquantes.js --apply
 */

const { connect } = require("./lib/api-client");

const BASE = "/api/v1/professional/remuneration";
/** L'API plafonne un lot de validation a 500 identifiants. */
const LOT_VALIDATION = 500;

/**
 * Creneaux attendus sans seance, bornes a aujourd'hui.
 *
 * Reprend la logique de `findSeancesManquantes` mais SANS son LIMIT 500 :
 * l'endpoint est fait pour alimenter un bandeau, pas pour piloter un
 * rattrapage de masse. La borne haute est CURRENT_DATE.
 */
const SQL_MANQUANTES = `
  WITH attendus AS (
    SELECT et.ue_session_id, et.ecue_id, et.enseignant_id,
           et.heure_debut, et.heure_fin, d::date AS date
      FROM professional_emploi_temps et
      JOIN professional_ue_sessions s
        ON s.id = et.ue_session_id AND s.tenant_id = et.tenant_id
      CROSS JOIN LATERAL generate_series(s.date_debut, s.date_fin, INTERVAL '1 day') AS d
     WHERE et.tenant_id = $1
       AND s.statut <> 'annule'
       AND EXTRACT(ISODOW FROM d) = et.jour
  )
  SELECT a.ue_session_id, a.ecue_id, a.enseignant_id, a.date::text AS date,
         a.heure_debut::text AS heure_debut, a.heure_fin::text AS heure_fin,
         ec.libelle AS ecue_libelle
    FROM attendus a
    JOIN professional_ecue ec ON ec.id = a.ecue_id AND ec.tenant_id = $1
   WHERE a.date <= CURRENT_DATE
     AND a.enseignant_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM professional_ecue_seances se
        WHERE se.tenant_id     = $1
          AND se.ue_session_id = a.ue_session_id
          AND se.ecue_id       = a.ecue_id
          AND se.date          = a.date)
   ORDER BY a.date, a.heure_debut`;

async function main() {
  const apply = process.argv.includes("--apply");
  const ctx = await connect();

  try {
    const { rows: manquantes } = await ctx.sql(SQL_MANQUANTES, [ctx.tenant.id]);
    console.log(`Tenant           : ${ctx.tenant.slug}`);
    console.log(`Creneaux a creer : ${manquantes.length} (dates passees uniquement)`);

    const { rows: sansSeance } = await ctx.sql(
      `SELECT count(*)::int AS n FROM professional_ecue_seances
        WHERE tenant_id = $1 AND statut = 'realisee' AND validated_at IS NULL`,
      [ctx.tenant.id]
    );
    console.log(`Deja realisees non validees : ${sansSeance[0].n}`);

    if (!apply) {
      console.log("\nSimulation. Relancer avec --apply pour ecrire.");
      if (manquantes.length > 0) {
        console.log("\nApercu des 5 premiers creneaux :");
        for (const m of manquantes.slice(0, 5)) {
          console.log(`  ${m.date} ${m.heure_debut}-${m.heure_fin}  ${m.ecue_libelle}`);
        }
      }
      return;
    }

    /* ---------------------- 1. Creation ------------------------------- */
    let crees = 0;
    const echecs = [];
    for (const [idx, m] of manquantes.entries()) {
      const r = await ctx.api("POST", `${BASE}/seances`, {
        ue_session_id: m.ue_session_id,
        ecue_id: m.ecue_id,
        enseignant_id: m.enseignant_id,
        date: m.date,
        heure_debut: m.heure_debut,
        heure_fin: m.heure_fin,
        libelle: `Rattrapage — ${m.ecue_libelle}`.slice(0, 300),
      });
      if (r.status === 201 || r.ok) crees++;
      else echecs.push({ date: m.date, ecue: m.ecue_libelle, status: r.status, msg: r.brut?.message });

      if ((idx + 1) % 100 === 0) {
        console.log(`  ... ${idx + 1}/${manquantes.length} traites (${crees} crees)`);
      }
    }
    console.log(`\nSeances creees : ${crees} / ${manquantes.length}`);
    if (echecs.length > 0) {
      console.log(`Echecs : ${echecs.length}`);
      for (const e of echecs.slice(0, 10)) {
        console.log(`  ${e.date} ${e.ecue} -> HTTP ${e.status} ${e.msg ?? ""}`);
      }
    }

    /* ---------------------- 2. Validation ------------------------------ */
    // On revalide TOUT ce qui est realise et non valide : les seances qu'on
    // vient de creer, mais aussi celles qui trainaient deja.
    const { rows: aValider } = await ctx.sql(
      `SELECT id FROM professional_ecue_seances
        WHERE tenant_id = $1 AND statut = 'realisee' AND validated_at IS NULL
        ORDER BY date`,
      [ctx.tenant.id]
    );
    console.log(`\nA valider : ${aValider.length} seance(s)`);

    let valides = 0;
    const rejets = {};
    for (let i = 0; i < aValider.length; i += LOT_VALIDATION) {
      const lot = aValider.slice(i, i + LOT_VALIDATION).map((s) => s.id);
      const r = await ctx.api("POST", `${BASE}/seances/validate`, {
        seanceIds: lot,
        validated: true,
      });
      if (!r.ok) {
        console.log(`  lot ${i / LOT_VALIDATION + 1} refuse : HTTP ${r.status} ${r.brut?.message ?? ""}`);
        continue;
      }
      valides += r.body.updated ?? 0;
      for (const rj of r.body.rejected ?? []) rejets[rj.reason] = (rejets[rj.reason] ?? 0) + 1;
      console.log(`  lot ${i / LOT_VALIDATION + 1} : ${r.body.updated} validee(s)`);
    }

    console.log(`\nValidees : ${valides}`);
    if (Object.keys(rejets).length > 0) {
      console.log("Rejets par motif :", JSON.stringify(rejets));
    }

    /* ---------------------- 3. Etat final ------------------------------ */
    const { rows: bilan } = await ctx.sql(
      `SELECT count(*) FILTER (WHERE statut = 'realisee' AND validated_at IS NOT NULL)::int AS validees,
              count(*) FILTER (WHERE statut = 'realisee' AND validated_at IS NULL)::int     AS restantes,
              count(*)::int AS total
         FROM professional_ecue_seances WHERE tenant_id = $1`,
      [ctx.tenant.id]
    );
    console.log(`\nEtat final : ${JSON.stringify(bilan[0])}`);
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error("ECHEC:", e.message);
  process.exit(1);
});
