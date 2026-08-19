/**
 * Parcours de paie complet, de bout en bout, SANS archivage.
 *
 *   node scripts/parcours-paie-decembre-2025.js
 *
 * Trois étapes, toutes passées par l'API — jamais par un INSERT direct : les
 * règles de payabilité, l'exclusion des heures déjà consommées et le verrou de
 * période unique vivent dans les services. Écrire en base les contournerait, et
 * le test ne prouverait plus rien.
 *
 *   1. Configurations manquantes — un enseignant sans configuration est écarté
 *      du calcul en silence (skipReason NO_CONFIG).
 *   2. Création de la période, collective (aucun teacherIds = tous).
 *   3. Calcul des bulletins.
 *
 * L'ARCHIVAGE N'EST PAS FAIT, volontairement : les bulletins restent au plan de
 * travail, consultables sur l'écran des bulletins.
 */

const { connect } = require("./lib/api-client");

const PERIODE = {
  name: "Décembre 2025",
  periodStart: "2025-12-01",
  periodEnd: "2025-12-31",
};

/* Reprend à l'identique la configuration des 24 autres enseignants horaires :
   une valeur différente ferait apparaître un écart de montant qui ne viendrait
   pas des heures. */
const CONFIG_TYPE = {
  configType: "hourly",
  defaultHourlyRate: 10000,
  overtimeThreshold: 40,
  overtimeMultiplier: 1.5,
  effectiveFrom: "2000-01-01",
};

(async () => {
  const s = await connect({ tenantSlug: "ecoledigitale" });
  console.log(`tenant ${s.tenant.slug} — admin ${s.adminEmail}\n`);

  /* ---------------- 1. Configurations manquantes ---------------- */
  const sansConfig = await s.sql(
    `SELECT t.id,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                     TRIM(t.first_name || ' ' || t.last_name)) AS nom
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
      WHERE t.tenant_id = $1 AND t.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM teacher_payment_configs c
                         WHERE c.teacher_id = t.id AND c.tenant_id = t.tenant_id)
      ORDER BY 2`,
    [s.tenant.id]
  );

  console.log(`1. Configurations manquantes : ${sansConfig.rowCount}`);
  for (const t of sansConfig.rows) {
    const r = await s.api("POST", "/api/v1/teacher-payment-configs", {
      teacherId: t.id,
      ...CONFIG_TYPE,
    });
    console.log(`   ${r.ok ? "creee " : "ECHEC "} ${t.nom}${r.ok ? "" : ` — ${r.status} ${JSON.stringify(r.brut).slice(0, 160)}`}`);
  }

  /* ---------------- 2. Période de paiement ---------------- */
  console.log(`\n2. Periode « ${PERIODE.name} » (${PERIODE.periodStart} -> ${PERIODE.periodEnd}), collective`);
  const creation = await s.api("POST", "/api/v1/payment-periods", PERIODE);
  if (!creation.ok) {
    console.error(`   ECHEC ${creation.status} : ${JSON.stringify(creation.brut).slice(0, 400)}`);
    await s.close();
    process.exit(1);
  }
  const periodId = creation.body?.id ?? creation.brut?.data?.id ?? creation.brut?.id;
  console.log(`   creee — id ${periodId}`);

  /* ---------------- 3. Calcul des bulletins ---------------- */
  console.log("\n3. Calcul des bulletins (scope: all)");
  const calcul = await s.api("POST", "/api/v1/teacher-payments/calculate", {
    periodId,
    recalculate: true,
    scope: "all",
  });
  if (!calcul.ok) {
    console.error(`   ECHEC ${calcul.status} : ${JSON.stringify(calcul.brut).slice(0, 400)}`);
    await s.close();
    process.exit(1);
  }
  const c = calcul.body ?? {};
  console.log(`   calcules ${c.calculated ?? "?"} | ecartes ${c.skipped ?? "?"} | erreurs ${c.errors ?? "?"}`);

  /* Les motifs d'écartement : c'est là que se lit ce qui manque encore. */
  const motifs = {};
  for (const r of c.results ?? []) {
    if (r.status !== "calculated") motifs[r.skipReason ?? r.status] = (motifs[r.skipReason ?? r.status] ?? 0) + 1;
  }
  if (Object.keys(motifs).length) {
    console.log("   motifs d'ecartement :");
    for (const [m, n] of Object.entries(motifs)) console.log(`      ${m} : ${n}`);
  }

  /* ---------------- Constat final, lu en base ---------------- */
  const bulletins = await s.sql(
    `SELECT COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                     TRIM(t.first_name || ' ' || t.last_name)) AS nom,
            tp.status::text AS statut, tp.total_amount::float8 AS montant, tp.currency AS devise,
            (SELECT count(*)::int FROM payment_hour_details d WHERE d.payment_id = tp.id) AS lignes,
            tp.archived_at IS NOT NULL AS archive
       FROM teacher_payments tp
       JOIN teachers t ON t.id = tp.teacher_id
       LEFT JOIN users u ON u.id = t.user_id
      WHERE tp.payment_period_id = $1
      ORDER BY tp.total_amount DESC`,
    [periodId]
  );
  console.log(`\nBulletins de la periode : ${bulletins.rowCount}`);
  console.table(bulletins.rows);

  const total = bulletins.rows.reduce((acc, r) => acc + Number(r.montant || 0), 0);
  console.log(`Total : ${new Intl.NumberFormat("fr-FR").format(Math.round(total))} XOF`);
  console.log(`Archives : ${bulletins.rows.filter((r) => r.archive).length} (attendu 0)`);

  await s.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
