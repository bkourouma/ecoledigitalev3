/**
 * ÉTAPE 3 — Inscriptions (page /professionnel/admin/inscriptions).
 *
 * Inscrit les 20 étudiants de la cohorte à TOUTES les sessions de M1TL puis de
 * M2TL, via `ProfessionalEnrollmentService.adminEnrollBulk()` — la méthode
 * appelée par le bouton d'inscription en lot de l'administration.
 *
 * Effets produits par le service (identiques à l'UI) :
 *   - un matricule professionnel IPAM<code filière><NNN> par (étudiant, filière),
 *     attribué à la 1ʳᵉ inscription puis réutilisé ;
 *   - une commande `professional_orders` par inscription, en attente de paiement ;
 *   - l'inscription elle-même en statut `en_attente_paiement`.
 *
 * Idempotent : les inscriptions déjà présentes sont comptées « ignorées ».
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-03-inscriptions.ts
 */
import { ProfessionalEnrollmentService } from "../src/services/professional-enrollment.service";
import {
  FILIERES,
  getCohorte,
  getFiliere,
  getSessions,
  getTenantId,
  log,
  makePool,
  must,
} from "./pro-tl-common";

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const enrollments = new ProfessionalEnrollmentService(pool as any);

  try {
    const cohorte = await getCohorte(pool, tenantId);
    if (cohorte.length === 0) throw new Error("Aucun étudiant ED-2026-* trouvé.");
    log(`Cohorte : ${cohorte.length} étudiants (${cohorte[0].matricule} → ${cohorte[cohorte.length - 1].matricule})`);

    for (const f of FILIERES) {
      const filiere = await getFiliere(pool, tenantId, f.code);
      const sessions = await getSessions(pool, tenantId, filiere.id);
      log(`\n=== ${filiere.code} — ${sessions.length} sessions × ${cohorte.length} étudiants ===`);

      const res = must(
        await enrollments.adminEnrollBulk(
          tenantId,
          sessions.map((s) => s.id),
          cohorte.map((s) => s.id)
        ),
        `adminEnrollBulk ${f.code}`
      ) as any;

      log(
        `  total=${res.total}  créées=${res.created}  déjà inscrites=${res.skipped}  erreurs=${res.errors.length}`
      );
      if (res.errors.length > 0) {
        res.errors.slice(0, 5).forEach((e: any) => log(`    ! ${e.error}: ${e.message}`));
      }

      const mats = await pool.query(
        `SELECT psm.matricule, u.first_name, u.last_name
         FROM professional_student_matricules psm
         JOIN student_profiles sp ON sp.id = psm.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE psm.tenant_id = $1 AND psm.filiere_id = $2
         ORDER BY psm.seq`,
        [tenantId, filiere.id]
      );
      log(`  Matricules ${filiere.code} attribués : ${mats.rowCount}`);
      mats.rows
        .slice(0, 3)
        .forEach((m: any) => log(`    ${m.matricule}  ${m.first_name} ${m.last_name}`));
      if ((mats.rowCount ?? 0) > 3) log(`    … jusqu'à ${mats.rows[mats.rows.length - 1].matricule}`);
    }

    const recap = await pool.query(
      `SELECT p.code, count(*)::int AS inscriptions,
              count(DISTINCT en.student_id)::int AS etudiants,
              count(DISTINCT en.order_id)::int AS commandes,
              sum(en.prix_unitaire)::float8 AS du_total
       FROM professional_enrollments en
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id
       JOIN professional_ue ue ON ue.id = s.ue_id
       JOIN programmes p ON p.id = ue.filiere_id
       WHERE en.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       GROUP BY p.code ORDER BY p.code`,
      [tenantId]
    );
    log(`\n=== Récapitulatif ===`);
    recap.rows.forEach((r: any) =>
      log(
        `  ${r.code}: ${r.inscriptions} inscriptions | ${r.etudiants} étudiants | ${r.commandes} commandes | ${r.du_total.toLocaleString("fr-FR")} FCFA dus`
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
