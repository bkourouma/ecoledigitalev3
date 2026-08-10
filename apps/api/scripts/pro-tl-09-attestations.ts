/**
 * ÉTAPE 9 — Attestations de réussite (page /professionnel/admin/attestations).
 *
 * IMPORTANT — il n'y a RIEN à écrire en base à cette étape : l'attestation est
 * entièrement CALCULÉE par `ProfessionalAttestationsService` à partir des
 * inscriptions, de la validation des UE et des bulletins ; le PDF est ensuite
 * assemblé côté navigateur (`apps/web/src/lib/attestation-pdf.ts`). Contrairement
 * au module Diplômes, aucune table d'attestation n'existe et aucune
 * configuration préalable n'est requise.
 *
 * Ce script joue donc le rôle de l'écran : il appelle `getRoster()` pour chaque
 * filière puis `getStudentAttestation()` pour chaque étudiant éligible, et
 * vérifie que le payload imprimable est complet (référence, année, UV, mention).
 * Une attestation par filière : M1TL et M2TL séparément.
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-09-attestations.ts
 */
import { ProfessionalAttestationsService } from "../src/services/professional-attestations.service";
import { FILIERES, getFiliere, getTenantId, log, makePool, must } from "./pro-tl-common";

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const attestations = new ProfessionalAttestationsService(pool as any);

  try {
    for (const f of FILIERES) {
      const filiere = await getFiliere(pool, tenantId, f.code);
      log(`\n=== ${filiere.code} — ${filiere.name} ===`);

      const roster = must(
        await attestations.getRoster(tenantId, filiere.id),
        `getRoster ${f.code}`
      ) as any;

      const uvTotal = roster.ue_requises.reduce((s: number, u: any) => s + u.nb_uv, 0);
      log(`  UE exigées : ${roster.ue_requises.length} (${uvTotal} UV) — les 3 semestres de la filière`);
      log(`  Inscrits : ${roster.students.length}`);

      const eligibles = roster.students.filter((s: any) => s.eligible);
      const nonEligibles = roster.students.filter((s: any) => !s.eligible);
      log(`  Éligibles : ${eligibles.length} | non éligibles : ${nonEligibles.length}`);

      if (nonEligibles.length > 0) {
        log(`  Détail des non-éligibles :`);
        nonEligibles.forEach((s: any) =>
          log(
            `    ${s.matricule} ${s.nom_complet} — ${s.uv_validees}/${s.uv_required} UV (${s.pourcentage}%) — manque ${s.ue_manquantes.map((u: any) => u.code).join(", ")}`
          )
        );
      }

      // Génération effective du payload d'attestation de chaque éligible.
      let ok = 0;
      const echecs: string[] = [];
      const mentions = new Map<string, number>();
      let exemple: any = null;

      for (const s of eligibles) {
        const res = await attestations.getStudentAttestation(tenantId, filiere.id, s.student_id);
        if (!res.success) {
          echecs.push(`${s.nom_complet}: ${res.error} ${res.message}`);
          continue;
        }
        const a = res.data as any;
        // Contrôle d'intégrité du payload imprimable.
        const manquants = ["reference", "diplome", "etudiant", "date_obtention", "uv_total_validees"].filter(
          (k) => a[k] == null
        );
        if (manquants.length > 0) {
          echecs.push(`${s.nom_complet}: champs manquants ${manquants.join(", ")}`);
          continue;
        }
        mentions.set(a.mention ?? "—", (mentions.get(a.mention ?? "—") ?? 0) + 1);
        if (!exemple) exemple = a;
        ok++;
      }

      log(`  Attestations générables : ${ok}/${eligibles.length}`);
      echecs.slice(0, 5).forEach((e) => log(`    ! ${e}`));
      log(
        `  Mentions : ${[...mentions.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ×${n}`).join(", ")}`
      );

      if (exemple) {
        log(`\n  Exemple de payload d'attestation :`);
        log(`    référence      ${exemple.reference}`);
        log(`    étudiant       ${exemple.etudiant.nom_complet}`);
        log(`    diplôme        ${exemple.diplome.code} — ${exemple.diplome.libelle}`);
        log(`    année scolaire ${exemple.annee_academique}`);
        log(`    date obtention ${String(exemple.date_obtention).slice(0, 10)}`);
        log(`    UV validées    ${exemple.uv_total_validees}`);
        log(`    mention        ${exemple.mention}`);
        log(`    UE listées     ${exemple.ue_validees.length} → ${exemple.ue_validees.map((u: any) => u.code).join(", ")}`);
      }
    }

    log(`\nNote : aucune écriture en base — l'attestation est recalculée à chaque`);
    log(`affichage et le PDF est produit par le navigateur.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
