/**
 * Remise à zéro du cycle de paie.
 *
 *   node scripts/reinitialiser-cycle-paie.js              # simulation
 *   node scripts/reinitialiser-cycle-paie.js --appliquer  # écrit
 *
 * DESTRUCTIF. À ne jamais jouer sur une base de production.
 *
 * CE QUI EST SUPPRIMÉ
 *   - toute la paie : lignes de détail, bulletins, périodes, journal d'audit ;
 *   - les séances de DÉMONSTRATION créées par les scripts d'essai, et leurs
 *     présences — ce sont elles qui portaient les créneaux payés deux fois.
 *
 * CE QUI EST CONSERVÉ
 *   - les séances pédagogiques réelles et les présences des étudiants ;
 *   - les configurations de rémunération des enseignants.
 *
 * CE QUI EST SEULEMENT DÉVALIDÉ
 *   - les séances restantes perdent `validated_at` / `validated_by`. Elles ne
 *     sont donc plus payables, sans être détruites : revalider suffit à revenir
 *     en arrière. Leur statut pédagogique (réalisée / planifiée) ne bouge pas —
 *     dévalider est un acte de gestion, pas un démenti du cours donné.
 *
 * L'ORDRE DES SUPPRESSIONS EST CONTRAINT. `payment_hour_details` référence les
 * bulletins, les bulletins référencent les périodes. Et le déclencheur d'audit
 * écrit une ligne « deleted » À CHAQUE bulletin supprimé : le journal se purge
 * donc EN DERNIER, sinon il se repeuple pendant l'opération.
 */

const { connect } = require("./lib/api-client");

const APPLIQUER = process.argv.includes("--appliquer");
const MOTIF_DEMO = "%démonstration%";

(async () => {
  const s = await connect({ tenantSlug: "ecoledigitale" });
  const T = s.tenant.id;

  const etat = async (titre) => {
    const r = await s.sql(
      `SELECT
         (SELECT count(*)::int FROM payment_hour_details WHERE tenant_id = $1) AS lignes,
         (SELECT count(*)::int FROM teacher_payments     WHERE tenant_id = $1) AS bulletins,
         (SELECT count(*)::int FROM payment_periods      WHERE tenant_id = $1) AS periodes,
         (SELECT count(*)::int FROM payment_audit_log    WHERE tenant_id = $1) AS audit,
         (SELECT count(*)::int FROM professional_ecue_seances WHERE tenant_id = $1) AS seances,
         (SELECT count(*)::int FROM professional_ecue_seances
           WHERE tenant_id = $1 AND validated_at IS NOT NULL) AS seances_validees,
         (SELECT count(*)::int FROM professional_ecue_attendance WHERE tenant_id = $1) AS presences`,
      [T]
    );
    console.log(`-- ${titre}`);
    console.table(r.rows);
  };

  await etat("avant");

  if (!APPLIQUER) {
    const demo = await s.sql(
      `SELECT count(*)::int n FROM professional_ecue_seances
        WHERE tenant_id = $1 AND libelle LIKE $2`,
      [T, MOTIF_DEMO]
    );
    console.log(`\nseances de demonstration a supprimer : ${demo.rows[0].n}`);
    console.log("simulation — rien n'a ete ecrit. Relancer avec --appliquer.");
    await s.close();
    return;
  }

  await s.sql("BEGIN");
  try {
    /* 1. La paie, du plus dépendant au moins dépendant. */
    const lignes = await s.sql(`DELETE FROM payment_hour_details WHERE tenant_id = $1`, [T]);
    const bulletins = await s.sql(`DELETE FROM teacher_payments WHERE tenant_id = $1`, [T]);
    await s.sql(
      `DELETE FROM payment_period_teachers ppt
        WHERE EXISTS (SELECT 1 FROM payment_periods pp
                       WHERE pp.id = ppt.payment_period_id AND pp.tenant_id = $1)`,
      [T]
    );
    const periodes = await s.sql(`DELETE FROM payment_periods WHERE tenant_id = $1`, [T]);

    /* 2. Les séances de démonstration : les présences d'abord (clé étrangère). */
    const presences = await s.sql(
      `DELETE FROM professional_ecue_attendance a
        WHERE a.tenant_id = $1
          AND EXISTS (SELECT 1 FROM professional_ecue_seances se
                       WHERE se.id = a.seance_id AND se.libelle LIKE $2)`,
      [T, MOTIF_DEMO]
    );
    const demo = await s.sql(
      `DELETE FROM professional_ecue_seances WHERE tenant_id = $1 AND libelle LIKE $2`,
      [T, MOTIF_DEMO]
    );

    /* 3. Dévalidation du reste — conservation, pas destruction. */
    const devalidees = await s.sql(
      `UPDATE professional_ecue_seances
          SET validated_at = NULL, validated_by = NULL, updated_at = now()
        WHERE tenant_id = $1 AND validated_at IS NOT NULL`,
      [T]
    );

    /* 4. Le journal d'audit EN DERNIER : les suppressions ci-dessus viennent
          d'y écrire une ligne par bulletin. */
    const audit = await s.sql(`DELETE FROM payment_audit_log WHERE tenant_id = $1`, [T]);

    await s.sql("COMMIT");

    console.log("\nsupprime :");
    console.log(`   lignes de detail : ${lignes.rowCount}`);
    console.log(`   bulletins        : ${bulletins.rowCount}`);
    console.log(`   periodes         : ${periodes.rowCount}`);
    console.log(`   audit            : ${audit.rowCount}`);
    console.log(`   seances demo     : ${demo.rowCount} (et ${presences.rowCount} presence(s))`);
    console.log(`devalide :`);
    console.log(`   seances          : ${devalidees.rowCount}`);
  } catch (e) {
    await s.sql("ROLLBACK");
    throw e;
  }

  await etat("apres");

  /* Contrôle : plus rien ne doit être payable, ni se recouper. */
  const reste = await s.sql(
    `SELECT
       (SELECT count(*)::int FROM professional_ecue_seances
         WHERE tenant_id = $1 AND validated_at IS NOT NULL) AS encore_payables,
       (SELECT count(*)::int FROM professional_ecue_seances a
         JOIN professional_ecue_seances b
           ON b.tenant_id = a.tenant_id AND b.id <> a.id
          AND b.enseignant_id = a.enseignant_id AND b.date = a.date
          AND a.validated_at IS NOT NULL AND b.validated_at IS NOT NULL
          AND a.heure_debut < b.heure_fin AND b.heure_debut < a.heure_fin
        WHERE a.tenant_id = $1) AS chevauchements_valides`,
    [T]
  );
  console.log("controle :", JSON.stringify(reste.rows[0]), "(attendu 0 / 0)");

  await s.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
