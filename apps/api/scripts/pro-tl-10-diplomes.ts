/**
 * ÉTAPE 10 — Diplômes (page /professionnel/admin/diplomes).
 *
 * Contrairement aux attestations (par filière, calculées), le diplôme porte sur
 * un CYCLE ENTIER : « Master — Transport Logistique » = M1TL + M2TL réunis,
 * identifié par sa filière terminale (M2TL). Cf. professional-cycle-groups.ts.
 *
 * Deux appels de service, comme dans l'administration :
 *   1. `ensureCycleDiploma()`      → crée le diplôme du cycle et ses exigences
 *      (`professional_diploma_requirements` = union des UE des deux filières)
 *      avec le total d'UV requis.
 *   2. `recomputeAllForDiploma()`  → évalue tous les étudiants et OCTROIE le
 *      diplôme aux éligibles : `student_professional_diplomas` en statut
 *      « obtenu », référence DIP-AAAA-NNNNNN, avec un instantané des exigences.
 *
 * Idempotent : les deux méthodes sont réexécutables (un diplôme déjà octroyé
 * n'est pas dupliqué — index unique partiel `uniq_student_prof_diploma_active`).
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-10-diplomes.ts
 */
import { ProfessionalDiplomasService } from "../src/services/professional-diplomas.service";
import { getAdminUserId, getFiliere, getTenantId, log, makePool, must } from "./pro-tl-common";

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const adminId = await getAdminUserId(pool, tenantId);
  const diplomas = new ProfessionalDiplomasService(pool as any);

  try {
    // Le cycle Master Transport-Logistique est identifié par sa filière terminale.
    const m2 = await getFiliere(pool, tenantId, "M2TL");

    const groups = must(await diplomas.listCycleGroups(tenantId), "listCycleGroups") as any[];
    const cycle = groups.find((g) => g.id === m2.id);
    if (!cycle) throw new Error("Cycle Master Transport Logistique introuvable.");
    log(`Cycle : ${cycle.libelle} (${cycle.grade})`);
    log(`  filières : ${cycle.filieres.map((f: any) => `${f.code} (niveau ${f.niveau})`).join(", ")}`);

    // 1. Diplôme du cycle + exigences.
    const diploma = must(
      await diplomas.ensureCycleDiploma(tenantId, m2.id, adminId),
      "ensureCycleDiploma"
    ) as any;
    log(`\nDiplôme : ${diploma.code} — ${diploma.libelle}`);
    log(`  UV requises : ${diploma.uv_required} | statut ${diploma.statut}`);

    const reqs = must(
      await diplomas.getRequirements(tenantId, diploma.id),
      "getRequirements"
    ) as any[];
    log(`  Exigences : ${reqs.length} UE`);
    log(`    ${reqs.map((r: any) => r.ue_code).join(", ")}`);

    // 2. Évaluation + octroi automatique aux éligibles.
    const recompute = must(
      await diplomas.recomputeAllForDiploma(tenantId, diploma.id),
      "recomputeAllForDiploma"
    ) as any;
    log(`\nRecalcul : ${JSON.stringify(recompute)}`);

    const awarded = must(
      await diplomas.listAwarded(tenantId, diploma.id, undefined as any),
      "listAwarded"
    ) as any[];
    const obtenus = awarded.filter((a: any) => a.statut === "obtenu");
    log(`\n=== Diplômes octroyés : ${obtenus.length} ===`);
    obtenus.forEach((a: any) =>
      log(
        `  ${a.reference} | ${a.nom_complet ?? a.student_id} | ${a.uv_total_validees} UV | ${String(a.date_obtention ?? "").slice(0, 10)}`
      )
    );

    const candidats = must(
      await diplomas.listCandidates(tenantId, diploma.id),
      "listCandidates"
    ) as any[];
    const nonEligibles = candidats.filter((c: any) => !c.eligible);
    log(`\n=== Candidats non encore diplômés : ${nonEligibles.length} ===`);
    nonEligibles.forEach((c: any) =>
      log(
        `  ${c.matricule ?? ""} ${c.nom_complet} — ${c.uv_validees}/${c.uv_required} UV (${c.pourcentage ?? "?"}%)`
      )
    );

    log(`\n=== Vérification en base ===`);
    const verif = await pool.query(
      `SELECT d.code, d.libelle, d.uv_required,
              count(spd.id)::int AS octroyes,
              count(*) FILTER (WHERE spd.statut = 'obtenu')::int AS obtenus,
              min(spd.reference) AS ref_min, max(spd.reference) AS ref_max
       FROM professional_diplomas d
       LEFT JOIN student_professional_diplomas spd ON spd.diploma_id = d.id
       WHERE d.tenant_id = $1 AND d.filiere_id = $2
       GROUP BY d.code, d.libelle, d.uv_required`,
      [tenantId, m2.id]
    );
    verif.rows.forEach((r: any) =>
      log(
        `  ${r.code} « ${r.libelle} » | ${r.uv_required} UV requises | ${r.obtenus} obtenus | références ${r.ref_min} → ${r.ref_max}`
      )
    );

    const snap = await pool.query(
      `SELECT spd.reference, spd.uv_total_validees,
              jsonb_array_length(spd.requirements_snapshot->'requirements') AS nb_exigences,
              (SELECT count(*) FROM jsonb_array_elements(spd.requirements_snapshot->'requirements') x
                WHERE (x->>'validee')::boolean) AS validees
       FROM student_professional_diplomas spd
       JOIN professional_diplomas d ON d.id = spd.diploma_id
       WHERE spd.tenant_id = $1 AND d.filiere_id = $2
       ORDER BY spd.reference LIMIT 3`,
      [tenantId, m2.id]
    );
    log(`\nInstantanés d'exigences (contrôle) :`);
    snap.rows.forEach((r: any) =>
      log(`  ${r.reference}: ${r.uv_total_validees} UV | ${r.validees}/${r.nb_exigences} UE validées dans l'instantané`)
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
