/**
 * ÉTAPE 4 — Paiements (page /professionnel/admin/paiements).
 *
 * Solde intégralement chaque inscription de M1TL et M2TL via
 * `ProfessionalPaymentService.adminRecordPayment()` — la méthode de
 * l'enregistrement de paiement côté administration.
 *
 * Effets produits par le service :
 *   - un `professional_payments` confirmé, avec numéro de reçu REC-PRO-AAAA-NNNNNN
 *     et URL de reçu ;
 *   - l'inscription passe de `en_attente_paiement` à `confirmee` ;
 *   - la commande passe à `payee` dès que le solde est atteint.
 *
 * Idempotent : une inscription déjà soldée renvoie ALREADY_PAID et est ignorée.
 * Modes de paiement répartis (especes / mobile_money / virement) pour que la
 * page de suivi affiche une ventilation réaliste.
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-04-paiements.ts
 */
import { ProfessionalPaymentService } from "../src/services/professional-payment.service";
import { getTenantId, log, makePool } from "./pro-tl-common";

const MODES = ["especes", "mobile_money", "virement"] as const;

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const payments = new ProfessionalPaymentService(pool as any);

  try {
    // Inscriptions non soldées des deux filières, dans l'ordre pédagogique.
    const rows = await pool.query(
      `SELECT en.id, en.prix_unitaire::float8 AS montant, o.montant_total::float8 AS du,
              p.code AS filiere, s.libelle AS session
       FROM professional_enrollments en
       JOIN professional_orders o ON o.id = en.order_id
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id
       JOIN professional_ue ue ON ue.id = s.ue_id
       JOIN programmes p ON p.id = ue.filiere_id
       WHERE en.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       ORDER BY p.code, s.date_debut, s.libelle, en.created_at`,
      [tenantId]
    );
    log(`${rows.rowCount} inscription(s) à traiter.`);

    let paid = 0;
    let already = 0;
    const errors: string[] = [];
    let i = 0;

    for (const r of rows.rows) {
      const mode = MODES[i % MODES.length];
      const res = await payments.adminRecordPayment(tenantId, r.id, {
        montant: r.du,
        mode,
        reference_transaction: `TL-${r.filiere}-${String(i + 1).padStart(4, "0")}`,
      });
      if (res.success) {
        paid++;
      } else if (res.error === "ALREADY_PAID") {
        already++;
      } else {
        errors.push(`${r.filiere} ${r.session}: ${res.error} ${res.message}`);
      }
      i++;
      if (i % 100 === 0) log(`  … ${i}/${rows.rowCount}`);
    }

    log(`\nPaiements enregistrés : ${paid} | déjà soldés : ${already} | erreurs : ${errors.length}`);
    errors.slice(0, 5).forEach((e) => log(`  ! ${e}`));

    const recap = await pool.query(
      `SELECT p.code,
              count(DISTINCT pay.id)::int AS paiements,
              sum(pay.montant)::float8 AS encaisse,
              count(DISTINCT o.id) FILTER (WHERE o.statut = 'payee')::int AS commandes_payees,
              count(DISTINCT en.id) FILTER (WHERE en.statut = 'confirmee')::int AS inscr_confirmees
       FROM professional_payments pay
       JOIN professional_orders o ON o.id = pay.order_id
       JOIN professional_enrollments en ON en.order_id = o.id
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id
       JOIN professional_ue ue ON ue.id = s.ue_id
       JOIN programmes p ON p.id = ue.filiere_id
       WHERE pay.tenant_id = $1 AND pay.statut = 'confirme' AND p.code IN ('M1TL','M2TL')
       GROUP BY p.code ORDER BY p.code`,
      [tenantId]
    );
    log(`\n=== Encaissements ===`);
    recap.rows.forEach((r: any) =>
      log(
        `  ${r.code}: ${r.paiements} reçus | ${r.encaisse.toLocaleString("fr-FR")} FCFA | ${r.commandes_payees} commandes payées | ${r.inscr_confirmees} inscriptions confirmées`
      )
    );

    const modes = await pool.query(
      `SELECT pay.mode, count(*)::int AS n, sum(pay.montant)::float8 AS total
       FROM professional_payments pay
       WHERE pay.tenant_id = $1 AND pay.reference_transaction LIKE 'TL-%'
       GROUP BY pay.mode ORDER BY pay.mode`,
      [tenantId]
    );
    log(`\n=== Ventilation par mode ===`);
    modes.rows.forEach((r: any) =>
      log(`  ${r.mode}: ${r.n} paiements — ${r.total.toLocaleString("fr-FR")} FCFA`)
    );

    const sample = await pool.query(
      `SELECT receipt_number, montant::float8 AS m, mode FROM professional_payments
       WHERE tenant_id = $1 AND reference_transaction LIKE 'TL-%'
       ORDER BY receipt_number LIMIT 3`,
      [tenantId]
    );
    log(`\nExemples de reçus :`);
    sample.rows.forEach((r: any) => log(`  ${r.receipt_number} — ${r.m.toLocaleString("fr-FR")} FCFA (${r.mode})`));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
