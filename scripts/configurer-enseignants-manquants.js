#!/usr/bin/env node

/**
 * Configuration de paie des enseignants qui n'en ont aucune — feature 031.
 *
 * POURQUOI CE SCRIPT
 * Un enseignant sans configuration valide est ignore EN SILENCE par
 * `payment-calculator.ts` : ni erreur, ni avertissement, simplement aucun
 * bulletin. L'ecran « Bulletins de paie » les rend visibles ; ce script les
 * traite en lot.
 *
 * POURQUOI « TAUX HORAIRE » ET PAS « SALAIRE »
 * Aucun des enseignants concernes n'a de seance enregistree. Or les deux types
 * ne se comportent pas pareil face a cette absence :
 *
 *   - `hourly` sans heure validee produit un bulletin a ZERO. C'est exact :
 *     personne ne doit rien a quelqu'un qui n'a pas encore enseigne.
 *   - `salary` paie le salaire INDEPENDAMMENT des heures. Choisir ce type
 *     creerait immediatement une dette envers des enseignants qui n'ont donne
 *     aucun cours — soit, sur les periodes deja ouvertes, des dizaines de
 *     millions de XOF de paie fictive.
 *
 * Le type horaire est donc le choix sur ET reversible : passer un enseignant en
 * salaire ou en mixte reste un clic depuis l'ecran, une fois sa situation
 * reelle connue. Le sens inverse obligerait a annuler des paiements.
 *
 * Le taux de repli ne sert que si aucun tarif d'ECUE ne repond (3e niveau de
 * resolution, `config_defaut`).
 *
 * Usage :
 *   node scripts/configurer-enseignants-manquants.js              (simulation)
 *   node scripts/configurer-enseignants-manquants.js --apply
 *   node scripts/configurer-enseignants-manquants.js --apply --taux 12000
 */

const { connect } = require("./lib/api-client");

const CONFIGS = "/api/v1/teacher-payment-configs";

/** Aligne sur les configurations deja saisies dans ce tenant (10 000 XOF/h). */
const TAUX_DEFAUT = 10000;
/** Seuil hebdomadaire d'heures supplementaires, et son multiplicateur. */
const SEUIL_HS = 40;
const MULTIPLICATEUR_HS = 1.5;

/**
 * Date de prise d'effet volontairement tres anterieure, comme les
 * configurations du jeu de donnees. Une config qui demarre apres une seance
 * deja enregistree laisse un trou : les heures anterieures ne sont rattachees
 * a aucun tarif et disparaissent du calcul sans un mot.
 */
const EFFET_DEPUIS = "2000-01-01";

function argNombre(nom, defaut) {
  const i = process.argv.indexOf(nom);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : defaut;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const taux = argNombre("--taux", TAUX_DEFAUT);
  const ctx = await connect();

  try {
    const { rows: manquants } = await ctx.sql(
      `SELECT t.id,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                       NULLIF(TRIM(t.first_name  || ' ' || t.last_name), ''),
                       u.email, t.email, 'Enseignant')  AS nom,
              t.employee_number                          AS matricule,
              t.contract_type::text                      AS contrat,
              (SELECT count(*)::int FROM professional_ecue_seances se
                WHERE se.enseignant_id = t.id)           AS nb_seances
         FROM teachers t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.tenant_id = $1
          AND NOT EXISTS (SELECT 1 FROM teacher_payment_configs c
                           WHERE c.teacher_id = t.id AND c.tenant_id = t.tenant_id)
        ORDER BY lower(COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                                NULLIF(TRIM(t.first_name  || ' ' || t.last_name), ''),
                                u.email, t.email, 'Enseignant'))`,
      [ctx.tenant.id]
    );

    console.log(`Tenant                    : ${ctx.tenant.slug}`);
    console.log(`Enseignants sans config   : ${manquants.length}`);
    console.log(`Type applique             : horaire, ${taux} XOF/h`);
    console.log(`Heures sup                : au-dela de ${SEUIL_HS} h/sem, x${MULTIPLICATEUR_HS}`);
    console.log(`Prise d'effet             : ${EFFET_DEPUIS} (sans fin)\n`);

    // Garde-fou : le raisonnement « horaire plutot que salaire » repose sur
    // l'absence de seances. Si l'un d'eux en a, le signaler plutot que de
    // l'appliquer en silence.
    const avecSeances = manquants.filter((m) => m.nb_seances > 0);
    if (avecSeances.length > 0) {
      console.log(`ATTENTION : ${avecSeances.length} enseignant(s) ont deja des seances.`);
      for (const m of avecSeances) console.log(`  ${m.nom} — ${m.nb_seances} seance(s)`);
      console.log("");
    }

    if (manquants.length === 0) {
      console.log("Tous les enseignants sont configures : rien a faire.");
      return;
    }

    if (!apply) {
      for (const m of manquants) {
        console.log(
          `  ${m.nom.padEnd(24)} ${String(m.matricule ?? "—").padEnd(10)} ${m.contrat ?? "—"}`
        );
      }
      console.log("\nSimulation. Relancer avec --apply pour ecrire.");
      return;
    }

    let crees = 0;
    const echecs = [];
    for (const m of manquants) {
      const r = await ctx.api("POST", CONFIGS, {
        teacherId: m.id,
        configType: "hourly",
        defaultHourlyRate: taux,
        overtimeThreshold: SEUIL_HS,
        overtimeMultiplier: MULTIPLICATEUR_HS,
        effectiveFrom: EFFET_DEPUIS,
        notes:
          "Configuration initiale — taux horaire de reference. " +
          "A ajuster si l'enseignant releve d'un salaire fixe ou d'un regime mixte.",
      });
      if (r.ok) {
        crees++;
        console.log(`  OK   ${m.nom}`);
      } else {
        echecs.push(`${m.nom}: HTTP ${r.status} ${r.brut?.message ?? ""}`);
        console.log(`  ECHEC ${m.nom} — HTTP ${r.status} ${r.brut?.message ?? ""}`);
      }
    }

    console.log(`\nConfigurations creees : ${crees} / ${manquants.length}`);
    if (echecs.length > 0) {
      console.log(`${echecs.length} echec(s) :`);
      for (const e of echecs.slice(0, 10)) console.log(`  - ${e}`);
    }

    const { rows: bilan } = await ctx.sql(
      `SELECT count(*)::int AS enseignants,
              count(*) FILTER (
                WHERE EXISTS (SELECT 1 FROM teacher_payment_configs c
                               WHERE c.teacher_id = t.id AND c.tenant_id = t.tenant_id
                                 AND c.effective_from <= CURRENT_DATE
                                 AND (c.effective_to IS NULL OR c.effective_to >= CURRENT_DATE))
              )::int AS configures
         FROM teachers t WHERE t.tenant_id = $1`,
      [ctx.tenant.id]
    );
    console.log(`\nBilan : ${bilan[0].configures} / ${bilan[0].enseignants} enseignants couverts.`);
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error("ECHEC:", e.message);
  process.exit(1);
});
