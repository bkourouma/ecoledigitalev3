#!/usr/bin/env node

/**
 * Parcours de paie complet pour les seances deja effectuees — feature 031.
 *
 *   1. CONFIGURATIONS  : chaque enseignant ayant des seances validees doit etre
 *      couvert par une config de paie sur TOUTE la periode de ses seances.
 *      Sans config, le calculateur ignore l'enseignant en silence.
 *   2. PERIODES        : une periode mensuelle par mois couvert, y compris
 *      passe. Les periodes deja presentes ne sont ni recreees ni modifiees.
 *   3. CALCUL          : un calcul par periode, sur toutes les origines
 *      d'heures (academique + professionnel : un enseignant, un bulletin).
 *
 * BORNE AU PASSE : on ne paie pas un cours qui n'a pas encore eu lieu.
 *
 * Tout passe par l'API. Le calcul, la resolution des tarifs et les verrous
 * vivent dans `payment-calculator.ts` ; les rejouer en SQL produirait des
 * montants qui ne correspondraient a rien de reproductible depuis l'interface.
 *
 * Usage :
 *   node scripts/preparer-paie-complete.js            (simulation)
 *   node scripts/preparer-paie-complete.js --apply
 */

const { connect } = require("./lib/api-client");

const CONFIGS = "/api/v1/teacher-payment-configs";
const PERIODES = "/api/v1/payment-periods";
const PAIEMENTS = "/api/v1/teacher-payments";

/**
 * Taux horaire de repli, en XOF. Il ne sert QUE lorsqu'aucun tarif d'ECUE ne
 * repond : c'est la troisieme origine de resolution (`config_defaut`).
 * Aligne sur les configurations deja saisies pour les autres enseignants.
 */
const TAUX_DEFAUT = 10000;

const MOIS = [
  "Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre",
];

const iso = (d) => d.toISOString().slice(0, 10);
const finDeMois = (a, m) => new Date(Date.UTC(a, m + 1, 0));
const debutDeMois = (a, m) => new Date(Date.UTC(a, m, 1));

async function main() {
  const apply = process.argv.includes("--apply");
  const ctx = await connect();
  const journal = { configs: 0, periodes: 0, calculs: 0, paiements: 0, echecs: [] };

  try {
    console.log(`Tenant : ${ctx.tenant.slug}\n`);

    /* =============== 1. Configurations enseignants ==================== */

    const { rows: enseignants } = await ctx.sql(
      `SELECT se.enseignant_id AS id,
              COALESCE(TRIM(u.first_name || ' ' || u.last_name),
                       TRIM(t.first_name || ' ' || t.last_name)) AS nom,
              min(se.date)::text AS premiere_seance,
              count(*)::int      AS nb_seances,
              (SELECT min(cfg.effective_from)::text
                 FROM teacher_payment_configs cfg
                WHERE cfg.teacher_id = se.enseignant_id
                  AND cfg.tenant_id  = se.tenant_id) AS config_depuis
         FROM professional_ecue_seances se
         JOIN teachers t ON t.id = se.enseignant_id
         LEFT JOIN users u ON u.id = t.user_id
        WHERE se.tenant_id = $1
          AND se.statut = 'realisee' AND se.validated_at IS NOT NULL
          AND se.date <= CURRENT_DATE
        GROUP BY se.enseignant_id, se.tenant_id, u.first_name, u.last_name,
                 t.first_name, t.last_name
        ORDER BY nom`,
      [ctx.tenant.id]
    );

    console.log("== 1. Configurations enseignants ==");
    for (const e of enseignants) {
      // Une config qui demarre APRES la premiere seance laisse un trou : les
      // seances anterieures ne seraient rattachees a aucun tarif.
      const couvert = e.config_depuis && e.config_depuis <= e.premiere_seance;
      if (couvert) {
        console.log(`  ${e.nom.padEnd(18)} couvert depuis ${e.config_depuis}`);
        continue;
      }

      // Fin de validite : la veille de la config existante, pour ne PAS
      // ecraser un taux deja saisi par l'utilisateur.
      const veille = e.config_depuis
        ? iso(new Date(new Date(e.config_depuis).getTime() - 86400000))
        : undefined;

      const corps = {
        teacherId: e.id,
        configType: "hourly",
        defaultHourlyRate: TAUX_DEFAUT,
        overtimeThreshold: 40,
        overtimeMultiplier: 1.5,
        effectiveFrom: e.premiere_seance,
        ...(veille ? { effectiveTo: veille } : {}),
        notes: "Configuration de rattrapage — couverture des seances anterieures.",
      };

      console.log(
        `  ${e.nom.padEnd(18)} A CREER  ${corps.effectiveFrom}` +
          `${veille ? ` -> ${veille}` : " (sans fin)"}  ${TAUX_DEFAUT} XOF/h`
      );
      if (!apply) continue;

      const r = await ctx.api("POST", CONFIGS, corps);
      if (r.ok) journal.configs++;
      else {
        journal.echecs.push(`config ${e.nom}: HTTP ${r.status} ${r.brut?.message ?? ""}`);
        console.log(`     -> ECHEC HTTP ${r.status} ${r.brut?.message ?? ""}`);
      }
    }

    /* ===================== 2. Periodes de paie ======================== */

    const { rows: bornes } = await ctx.sql(
      `SELECT min(date)::text AS du, LEAST(max(date), CURRENT_DATE)::text AS au
         FROM professional_ecue_seances
        WHERE tenant_id = $1 AND statut = 'realisee' AND validated_at IS NOT NULL
          AND date <= CURRENT_DATE`,
      [ctx.tenant.id]
    );
    const { rows: existantes } = await ctx.sql(
      `SELECT id, name, period_start::text AS debut, period_end::text AS fin, status
         FROM payment_periods WHERE tenant_id = $1 ORDER BY period_start`,
      [ctx.tenant.id]
    );

    console.log(`\n== 2. Periodes de paie (${bornes[0].du} -> ${bornes[0].au}) ==`);
    console.log(`  ${existantes.length} periode(s) deja presente(s)`);

    const debut = new Date(`${bornes[0].du}T00:00:00Z`);
    const fin = new Date(`${bornes[0].au}T00:00:00Z`);
    const aCreer = [];

    for (
      let d = debutDeMois(debut.getUTCFullYear(), debut.getUTCMonth());
      d <= fin;
      d = debutDeMois(d.getUTCFullYear(), d.getUTCMonth() + 1)
    ) {
      const a = d.getUTCFullYear();
      const m = d.getUTCMonth();
      const pDebut = iso(debutDeMois(a, m));
      const pFin = iso(finDeMois(a, m));

      // Un mois deja couvert, meme partiellement, est laisse tel quel :
      // superposer deux periodes ferait payer deux fois les memes heures.
      const chevauche = existantes.some((p) => p.debut <= pFin && pDebut <= p.fin);
      if (chevauche) continue;

      aCreer.push({ name: `${MOIS[m]} ${a}`, periodStart: pDebut, periodEnd: pFin });
    }

    console.log(`  ${aCreer.length} periode(s) a creer`);
    if (apply) {
      for (const p of aCreer) {
        const r = await ctx.api("POST", PERIODES, p);
        if (r.ok) journal.periodes++;
        else {
          journal.echecs.push(`periode ${p.name}: HTTP ${r.status} ${r.brut?.message ?? ""}`);
          console.log(`     ${p.name} -> ECHEC HTTP ${r.status} ${r.brut?.message ?? ""}`);
        }
      }
      console.log(`  ${journal.periodes} creee(s)`);
    }

    if (!apply) {
      console.log("\nSimulation. Relancer avec --apply pour ecrire.");
      return;
    }

    /* ======================== 3. Calculs ============================== */

    const { rows: toutes } = await ctx.sql(
      `SELECT id, name, period_start::text AS debut, period_end::text AS fin, status
         FROM payment_periods
        WHERE tenant_id = $1 AND period_start <= CURRENT_DATE
        ORDER BY period_start`,
      [ctx.tenant.id]
    );

    console.log(`\n== 3. Calcul sur ${toutes.length} periode(s) ==`);
    for (const p of toutes) {
      // `recalculate: true` rend l'operation rejouable : sans lui, une periode
      // deja calculee serait ignoree et le script ne serait pas idempotent.
      // Les paiements approuves ou payes restent proteges cote service.
      const r = await ctx.api("POST", `${PAIEMENTS}/calculate`, {
        periodId: p.id,
        recalculate: true,
        scope: "all",
      });
      if (!r.ok) {
        journal.echecs.push(`calcul ${p.name}: HTTP ${r.status} ${r.brut?.message ?? ""}`);
        console.log(`  ${p.name.padEnd(18)} ECHEC HTTP ${r.status} ${r.brut?.message ?? ""}`);
        continue;
      }
      journal.calculs++;
      journal.paiements += r.body?.calculated ?? 0;
      console.log(
        `  ${p.name.padEnd(18)} calcules=${r.body?.calculated ?? 0}` +
          ` ignores=${r.body?.skipped ?? 0} erreurs=${r.body?.errors ?? 0}`
      );
    }

    /* ========================= Bilan ================================== */

    const { rows: bilan } = await ctx.sql(
      `SELECT count(*)::int AS paiements,
              count(*) FILTER (WHERE status = 'calculated')::int AS calcules,
              count(*) FILTER (WHERE status = 'approved')::int   AS approuves,
              COALESCE(SUM(total_amount), 0)::float8             AS montant
         FROM teacher_payments WHERE tenant_id = $1`,
      [ctx.tenant.id]
    );
    console.log(`\nBilan : ${JSON.stringify(bilan[0])}`);
    console.log(
      `Configs creees=${journal.configs} periodes=${journal.periodes} calculs=${journal.calculs}`
    );
    if (journal.echecs.length > 0) {
      console.log(`\n${journal.echecs.length} echec(s) :`);
      for (const e of journal.echecs.slice(0, 15)) console.log(`  - ${e}`);
    }
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error("ECHEC:", e.message);
  process.exit(1);
});
