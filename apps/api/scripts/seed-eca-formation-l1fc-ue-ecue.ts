/**
 * Seed UE + ECUE (and their links) for the filière "LICENCE 1 FINANCE-COMPTABILITÉ"
 * (code L1-FC) of the eca-formation tenant, from the provided curriculum tables.
 *
 * Per request:
 *  - UE.nb_uv = "Crédits UE" (UV = crédits).
 *  - ECUE.credits = "Crédits ECUE" (new column, see migration 0074).
 *  - Semesters are NOT modelled: every UE (S1+S2+S3) is attached to the same
 *    filière. The S1/S2/S3 origin is only kept in the UE code for traceability.
 *  - Affectation UE↔ECUE: coefficient 1 (default), ordre = position in the UE.
 *
 * Idempotent (ON CONFLICT on the unique codes). Usage (from apps/api):
 *   pnpm tsx scripts/seed-eca-formation-l1fc-ue-ecue.ts
 */
import "dotenv/config";
import { Client } from "pg";

const TENANT_SLUG = "eca-formation";
const FILIERE_CODE = "L1-FC";

type EcueDef = { libelle: string; credits: number };
type UeDef = { suffix: string; libelle: string; uv: number; ecues: EcueDef[] };

// suffix -> S<sem>-UE<n> (kept only to make the UE code unique & traceable).
const UES: UeDef[] = [
  // ---- Semestre 1 ----
  { suffix: "S1-UE1", libelle: "Fondamentaux de Gestion", uv: 6, ecues: [
    { libelle: "Introduction à la Gestion", credits: 3 },
    { libelle: "Principes de Management", credits: 3 },
  ] },
  { suffix: "S1-UE2", libelle: "Comptabilité Fondamentale", uv: 6, ecues: [
    { libelle: "Comptabilité Générale I", credits: 3 },
    { libelle: "Documents Comptables et États Financiers", credits: 3 },
  ] },
  { suffix: "S1-UE3", libelle: "Environnement Économique", uv: 6, ecues: [
    { libelle: "Microéconomie", credits: 3 },
    { libelle: "Macroéconomie", credits: 3 },
  ] },
  { suffix: "S1-UE4", libelle: "Conduite", uv: 2, ecues: [
    { libelle: "Conduite", credits: 2 },
  ] },
  // ---- Semestre 2 ----
  { suffix: "S2-UE1", libelle: "Comptabilité Approfondie", uv: 8, ecues: [
    { libelle: "Comptabilité Générale II", credits: 4 },
    { libelle: "Travaux Comptables de Fin d'Exercice", credits: 4 },
  ] },
  { suffix: "S2-UE2", libelle: "Droit et Fiscalité de Base", uv: 6, ecues: [
    { libelle: "Introduction au Droit", credits: 3 },
    { libelle: "Droit des Affaires OHADA", credits: 3 },
  ] },
  { suffix: "S2-UE3", libelle: "Outils Quantitatifs", uv: 6, ecues: [
    { libelle: "Mathématiques Financières", credits: 3 },
    { libelle: "Statistiques Descriptives", credits: 3 },
  ] },
  // ---- Semestre 3 ----
  { suffix: "S3-UE1", libelle: "Finance et Comptabilité Analytique", uv: 8, ecues: [
    { libelle: "Introduction à la Finance d'Entreprise", credits: 4 },
    { libelle: "Comptabilité Analytique", credits: 4 },
  ] },
  { suffix: "S3-UE2", libelle: "Fiscalité et Gestion Financière", uv: 6, ecues: [
    { libelle: "Fiscalité des Entreprises (Bases)", credits: 3 },
    { libelle: "Gestion Financière I", credits: 3 },
  ] },
  { suffix: "S3-UE3", libelle: "Informatique et Communication", uv: 6, ecues: [
    { libelle: "Informatique Appliquée (Excel et Logiciels Comptables)", credits: 3 },
    { libelle: "Techniques d'Expression et de Communication", credits: 3 },
  ] },
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Ensure the new ECUE.credits column exists (migration 0074, idempotent).
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

    let ueCount = 0;
    let ecueCount = 0;
    let linkCount = 0;

    for (const ue of UES) {
      const ueCode = `${FILIERE_CODE}-${ue.suffix}`;
      const ueRes = await client.query<{ id: string }>(
        `INSERT INTO professional_ue (tenant_id, filiere_id, code, libelle, nb_uv, statut)
         VALUES ($1, $2, $3, $4, $5, 'actif')
         ON CONFLICT (tenant_id, code) DO UPDATE
           SET filiere_id = EXCLUDED.filiere_id,
               libelle    = EXCLUDED.libelle,
               nb_uv      = EXCLUDED.nb_uv,
               updated_at = now()
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
             SET libelle    = EXCLUDED.libelle,
                 credits    = EXCLUDED.credits,
                 updated_at = now()
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
                 coefficient     = EXCLUDED.coefficient,
                 ordre           = EXCLUDED.ordre`,
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
