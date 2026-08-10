/**
 * ÉTAPE 8 — Bulletins (page /professionnel/admin/bulletins).
 *
 * Appelle `ProfessionalBulletinService.generateBulletins()` pour CHACUN des
 * 6 semestres (3 de M1TL + 3 de M2TL) — exactement le bouton « Générer les
 * bulletins » de l'administration.
 *
 * Le service calcule et fige un bulletin par étudiant dans
 * `professional_bulletins.data` (jsonb) :
 *   - note ECUE = devoirs×0,4 + examen×0,6, moyenne UE pondérée par les crédits ;
 *   - la Conduite est traitée à part (note brute, comptée dans les crédits) ;
 *   - règle LMD sans compensation inter-UE : semestre validé seulement si
 *     TOUTES les UE le sont → statut `definitif`, sinon `provisoire` ;
 *   - matricule affiché = matricule professionnel IPAM de la filière.
 *
 * Réexécutable : ON CONFLICT met le bulletin à jour (pas de doublon).
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-08-bulletins.ts
 */
import { ProfessionalBulletinService } from "../src/services/professional-bulletin.service";
import {
  FILIERES,
  getFiliere,
  getSemestres,
  getTenantId,
  log,
  makePool,
  must,
} from "./pro-tl-common";

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const bulletins = new ProfessionalBulletinService(pool as any);

  try {
    for (const f of FILIERES) {
      const filiere = await getFiliere(pool, tenantId, f.code);
      const sems = await getSemestres(pool, tenantId, filiere.id);
      log(`\n=== ${filiere.code} ===`);

      for (const s of sems) {
        const res = must(
          await bulletins.generateBulletins(tenantId, s.id),
          `generateBulletins ${f.code} ${s.libelle}`
        ) as any;
        log(
          `  ${s.libelle}: ${res.generated} bulletin(s) — ${res.definitifs} définitif(s), ${res.provisoires} provisoire(s)`
        );
      }
    }

    log(`\n=== Vérification ===`);
    const recap = await pool.query(
      `SELECT p.code, sem.libelle,
              count(*)::int AS bulletins,
              count(*) FILTER (WHERE b.statut = 'definitif')::int AS definitifs,
              round(avg((b.data->>'moyenne_generale')::numeric), 2) AS moy,
              max((b.data->>'credits_valides')::int) AS credits_max
       FROM professional_bulletins b
       JOIN professional_semestres sem ON sem.id = b.semestre_id
       JOIN programmes p ON p.id = sem.filiere_id
       WHERE b.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       GROUP BY p.code, sem.libelle ORDER BY p.code, sem.libelle`,
      [tenantId]
    );
    recap.rows.forEach((r: any) =>
      log(
        `  ${r.code} ${r.libelle}: ${r.bulletins} bulletins | ${r.definitifs} définitifs | moyenne ${r.moy}/20 | max ${r.credits_max} crédits`
      )
    );

    // Contrôle de cohérence sur un bulletin complet.
    const ex = await pool.query(
      `SELECT b.data FROM professional_bulletins b
       JOIN professional_semestres sem ON sem.id = b.semestre_id
       JOIN programmes p ON p.id = sem.filiere_id
       JOIN student_profiles sp ON sp.id = b.student_id
       WHERE b.tenant_id = $1 AND p.code = 'M1TL' AND sem.libelle = 'Semestre 1'
         AND sp.student_matricule = 'ED-2026-001'`,
      [tenantId]
    );
    if (ex.rowCount) {
      const d = ex.rows[0].data as any;
      log(`\nExemple — ${d.student?.first_name} ${d.student?.last_name} (${d.student?.matricule}) M1TL S1`);
      log(
        `  moyenne ${d.moyenne_generale}/20 | crédits ${d.credits_valides}/${d.credits_total} | rang ${d.rang}/${d.effectif} | ${d.decision} (${d.statut_etudiant})`
      );
      (d.ues ?? []).forEach((u: any) =>
        log(
          `    ${String(u.code).padEnd(14)} ${String(u.libelle).slice(0, 34).padEnd(35)} moy ${String(u.moyenne_ue).padStart(5)} | ${u.credits} cr | ${u.validee ? "validée" : "non validée"}`
        )
      );
    }

    const parStatut = await pool.query(
      `SELECT sp.student_matricule, u.first_name, u.last_name,
              count(*) FILTER (WHERE b.statut = 'definitif')::int AS definitifs,
              count(*)::int AS total,
              round(avg((b.data->>'moyenne_generale')::numeric), 2) AS moy
       FROM professional_bulletins b
       JOIN professional_semestres sem ON sem.id = b.semestre_id
       JOIN programmes p ON p.id = sem.filiere_id
       JOIN student_profiles sp ON sp.id = b.student_id
       JOIN users u ON u.id = sp.user_id
       WHERE b.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       GROUP BY sp.student_matricule, u.first_name, u.last_name
       ORDER BY moy DESC NULLS LAST`,
      [tenantId]
    );
    log(`\n=== Bulletins par étudiant (6 semestres) ===`);
    parStatut.rows.forEach((r: any) =>
      log(
        `  ${r.student_matricule} ${String(r.first_name + " " + r.last_name).padEnd(22)} moyenne ${String(r.moy).padStart(5)}/20 | ${r.definitifs}/${r.total} semestres définitifs`
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
