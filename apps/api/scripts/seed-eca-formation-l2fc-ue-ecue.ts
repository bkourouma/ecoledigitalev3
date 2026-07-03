/**
 * Seed UE + ECUE (+ links) for "LICENCE 2 FINANCE-COMPTABILITÉ" (code L2-FC) of
 * the eca-formation tenant. Same conventions as the L1-FC seed:
 *  - UE.nb_uv = "Crédits UE" ; ECUE.credits = "Crédits ECUE".
 *  - Semesters not modelled: all UE attached to the filière; S1/S2/S3 kept only
 *    in the UE code. Affectation: coefficient 1, ordre = position.
 * Idempotent. Usage (from apps/api):
 *   pnpm tsx scripts/seed-eca-formation-l2fc-ue-ecue.ts
 */
import "dotenv/config";
import { Client } from "pg";

const TENANT_SLUG = "eca-formation";
const FILIERE_CODE = "L2-FC";

type EcueDef = { libelle: string; credits: number };
type UeDef = { suffix: string; libelle: string; uv: number; ecues: EcueDef[] };

const UES: UeDef[] = [
  // ---- Semestre 1 ----
  { suffix: "S1-UE1", libelle: "Comptabilité Approfondie", uv: 8, ecues: [
    { libelle: "Comptabilité Approfondie I", credits: 4 },
    { libelle: "Opérations de Fin d'Exercice et États Financiers", credits: 4 },
  ] },
  { suffix: "S1-UE2", libelle: "Finance d'Entreprise", uv: 6, ecues: [
    { libelle: "Gestion Financière II", credits: 3 },
    { libelle: "Analyse Financière I", credits: 3 },
  ] },
  { suffix: "S1-UE3", libelle: "Environnement Juridique et Fiscal", uv: 6, ecues: [
    { libelle: "Droit des Sociétés OHADA", credits: 3 },
    { libelle: "Fiscalité Générale", credits: 3 },
  ] },
  // ---- Semestre 2 ----
  { suffix: "S2-UE1", libelle: "Comptabilité et Contrôle", uv: 8, ecues: [
    { libelle: "Comptabilité Analytique Approfondie", credits: 4 },
    { libelle: "Contrôle de Gestion I", credits: 4 },
  ] },
  { suffix: "S2-UE2", libelle: "Gestion Financière et Marchés", uv: 6, ecues: [
    { libelle: "Mathématiques Financières", credits: 3 },
    { libelle: "Introduction aux Marchés Financiers", credits: 3 },
  ] },
  { suffix: "S2-UE3", libelle: "Outils d'Aide à la Décision", uv: 6, ecues: [
    { libelle: "Informatique Appliquée à la Gestion", credits: 3 },
    { libelle: "Statistiques Inférentielles", credits: 3 },
  ] },
  // ---- Semestre 3 ----
  { suffix: "S3-UE1", libelle: "Comptabilité et Audit", uv: 8, ecues: [
    { libelle: "Comptabilité des Sociétés", credits: 4 },
    { libelle: "Introduction à l'Audit", credits: 4 },
  ] },
  { suffix: "S3-UE2", libelle: "Gestion et Fiscalité", uv: 6, ecues: [
    { libelle: "Gestion Budgétaire", credits: 3 },
    { libelle: "Fiscalité des Entreprises", credits: 3 },
  ] },
  { suffix: "S3-UE3", libelle: "Communication et Professionnalisation", uv: 6, ecues: [
    { libelle: "Anglais des Affaires", credits: 3 },
    { libelle: "Techniques de Communication Professionnelle", credits: 3 },
  ] },
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      "ALTER TABLE professional_ecue ADD COLUMN IF NOT EXISTS credits INTEGER CHECK (credits IS NULL OR credits >= 0)"
    );

    const tenantRes = await client.query<{ id: string }>(
      "SELECT id FROM tenants WHERE slug = $1",
      [TENANT_SLUG]
    );
    if (tenantRes.rows.length !== 1) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);
    const tenantId = tenantRes.rows[0].id;

    const filiereRes = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM programmes WHERE tenant_id = $1 AND code = $2",
      [tenantId, FILIERE_CODE]
    );
    if (filiereRes.rows.length !== 1) throw new Error(`Filière "${FILIERE_CODE}" introuvable pour ${TENANT_SLUG}`);
    const filiere = filiereRes.rows[0];
    console.log(`Tenant ${TENANT_SLUG} / Filière ${filiere.name} (${FILIERE_CODE})`);

    await client.query("BEGIN");

    let ueCount = 0, ecueCount = 0, linkCount = 0;

    for (const ue of UES) {
      const ueCode = `${FILIERE_CODE}-${ue.suffix}`;
      const ueRes = await client.query<{ id: string }>(
        `INSERT INTO professional_ue (tenant_id, filiere_id, code, libelle, nb_uv, statut)
         VALUES ($1, $2, $3, $4, $5, 'actif')
         ON CONFLICT (tenant_id, code) DO UPDATE
           SET filiere_id = EXCLUDED.filiere_id, libelle = EXCLUDED.libelle,
               nb_uv = EXCLUDED.nb_uv, updated_at = now()
         RETURNING id`,
        [tenantId, filiere.id, ueCode, ue.libelle, ue.uv]
      );
      const ueId = ueRes.rows[0].id;
      ueCount++;

      let ordre = 0;
      for (const ecue of ue.ecues) {
        const ecueCode = `${ueCode}-E${ordre + 1}`;
        const ecueRes = await client.query<{ id: string }>(
          `INSERT INTO professional_ecue (tenant_id, code, libelle, credits, statut)
           VALUES ($1, $2, $3, $4, 'actif')
           ON CONFLICT (tenant_id, code) DO UPDATE
             SET libelle = EXCLUDED.libelle, credits = EXCLUDED.credits, updated_at = now()
           RETURNING id`,
          [tenantId, ecueCode, ecue.libelle, ecue.credits]
        );
        const ecueId = ecueRes.rows[0].id;
        ecueCount++;

        await client.query(
          `INSERT INTO professional_ue_ecue (tenant_id, ue_id, ecue_id, est_obligatoire, coefficient, ordre)
           VALUES ($1, $2, $3, true, 1, $4)
           ON CONFLICT (tenant_id, ue_id, ecue_id) DO UPDATE
             SET est_obligatoire = EXCLUDED.est_obligatoire,
                 coefficient = EXCLUDED.coefficient, ordre = EXCLUDED.ordre`,
          [tenantId, ueId, ecueId, ordre]
        );
        linkCount++;
        ordre++;
      }
    }

    await client.query("COMMIT");
    console.log(`UE: ${ueCount} | ECUE: ${ecueCount} | affectations: ${linkCount}`);
    console.log("COMMITTED ✅");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("ERROR — rien n'a été enregistré:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
