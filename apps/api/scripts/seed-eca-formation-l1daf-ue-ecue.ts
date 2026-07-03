/**
 * Seed UE + ECUE (+ links) for "LICENCE 1 DROIT DES AFFAIRES ET FISCALITE"
 * (code L1-DAF) of the eca-formation tenant. Same conventions as the other seeds:
 *  - UE.nb_uv = "Crédits UE" ; ECUE.credits = "Crédits ECUE".
 *  - Semesters not modelled: all UE attached to the filière; S1/S2/S3 kept only
 *    in the UE code. Affectation: coefficient 1, ordre = position.
 * Idempotent. Usage (from apps/api):
 *   pnpm tsx scripts/seed-eca-formation-l1daf-ue-ecue.ts
 */
import "dotenv/config";
import { Client } from "pg";

const TENANT_SLUG = "eca-formation";
const FILIERE_CODE = "L1-DAF";

type EcueDef = { libelle: string; credits: number };
type UeDef = { suffix: string; libelle: string; uv: number; ecues: EcueDef[] };

const UES: UeDef[] = [
  // ---- Semestre 1 ----
  { suffix: "S1-UE1", libelle: "Fondements du Droit", uv: 8, ecues: [
    { libelle: "Introduction Générale au Droit", credits: 4 },
    { libelle: "Institutions Juridictionnelles et Administratives", credits: 4 },
  ] },
  { suffix: "S1-UE2", libelle: "Sciences Économiques et Sociales", uv: 5, ecues: [
    { libelle: "Introduction à l'Économie", credits: 2 },
    { libelle: "Sociologie Juridique", credits: 3 },
  ] },
  { suffix: "S1-UE3", libelle: "Outils et Méthodes", uv: 5, ecues: [
    { libelle: "Méthodologie Juridique", credits: 3 },
    { libelle: "Techniques d'Expression et de Communication", credits: 2 },
  ] },
  { suffix: "S1-UE4", libelle: "Conduite", uv: 2, ecues: [
    { libelle: "Conduite", credits: 2 },
  ] },
  // ---- Semestre 2 ----
  { suffix: "S2-UE1", libelle: "Droit Privé Fondamental", uv: 8, ecues: [
    { libelle: "Droit Civil des Personnes", credits: 4 },
    { libelle: "Droit de la Famille", credits: 4 },
  ] },
  { suffix: "S2-UE2", libelle: "Droit Public et Institutions", uv: 6, ecues: [
    { libelle: "Droit Constitutionnel", credits: 3 },
    { libelle: "Organisation Administrative", credits: 3 },
  ] },
  { suffix: "S2-UE3", libelle: "Langues et Informatique", uv: 4, ecues: [
    { libelle: "Informatique Juridique", credits: 2 },
    { libelle: "Anglais Juridique I", credits: 2 },
  ] },
  { suffix: "S2-UE4", libelle: "Conduite", uv: 2, ecues: [
    { libelle: "Conduite", credits: 2 },
  ] },
  // ---- Semestre 3 ----
  { suffix: "S3-UE1", libelle: "Droit des Obligations", uv: 7, ecues: [
    { libelle: "Théorie Générale des Obligations", credits: 3 },
    { libelle: "Régime Général des Obligations", credits: 4 },
  ] },
  { suffix: "S3-UE2", libelle: "Introduction au Droit des Affaires", uv: 6, ecues: [
    { libelle: "Droit Commercial Général", credits: 3 },
    { libelle: "Introduction à la Fiscalité", credits: 3 },
  ] },
  { suffix: "S3-UE3", libelle: "Environnement Économique et Comptable", uv: 5, ecues: [
    { libelle: "Comptabilité Générale", credits: 3 },
    { libelle: "Économie de l'Entreprise", credits: 2 },
  ] },
  { suffix: "S3-UE4", libelle: "Conduite", uv: 2, ecues: [
    { libelle: "Conduite", credits: 2 },
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
