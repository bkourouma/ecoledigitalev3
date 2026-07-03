/**
 * Seed filières (programmes) for the "eca-formation" tenant, under the LICENCE
 * and MASTER cycles. Idempotent: re-running skips already-existing codes
 * (unique on tenant_id, code, version).
 *
 * Usage (from apps/api):
 *   pnpm tsx scripts/seed-eca-formation-filieres.ts
 */
import "dotenv/config";
import { Client } from "pg";

const TENANT_SLUG = "eca-formation";

type Spec = { name: string; code: string };

const LICENCE_SPECS: Spec[] = [
  { name: "FINANCE-COMPTABILITÉ", code: "FC" },
  { name: "MARKETING MANAGEMENT", code: "MM" },
  { name: "DROIT DES AFFAIRES ET FISCALITE", code: "DAF" },
  { name: "INTELLIGENCE ARTIFICIELLE", code: "IA" },
  { name: "GENIE LOGICIEL", code: "GL" },
  { name: "RESEAU TELECOMMUNICATIONS", code: "RT" },
  { name: "TRANSPORT LOGISTIQUE", code: "TL" },
  { name: "GESTION DES RESSOURCES HUMAINES", code: "GRH" },
];

const MASTER_SPECS: Spec[] = [
  { name: "FINANCE-COMPTABILITÉ", code: "FC" },
  { name: "MARKETING MANAGEMENT", code: "MM" },
  { name: "DROIT DES AFFAIRES ET FISCALITE", code: "DAF" },
  { name: "INTELLIGENCE ARTIFICIELLE", code: "IA" },
  { name: "GENIE LOGICIEL", code: "GL" },
  { name: "RESEAU TELECOMMUNICATIONS", code: "RT" },
  { name: "TRANSPORT LOGISTIQUE", code: "TL" },
  { name: "AUDIT ET CONTROLE DE GESTION", code: "ACG" },
  { name: "GESTION DES RESSOURCES HUMAINES", code: "GRH" },
];

type Filiere = { name: string; code: string; cycleCode: "LICENCE" | "MASTER" };

function buildFilieres(): Filiere[] {
  const rows: Filiere[] = [];
  for (const spec of LICENCE_SPECS) {
    for (const lvl of [1, 2, 3]) {
      rows.push({ name: `LICENCE ${lvl} ${spec.name}`, code: `L${lvl}-${spec.code}`, cycleCode: "LICENCE" });
    }
  }
  for (const spec of MASTER_SPECS) {
    for (const lvl of [1, 2]) {
      rows.push({ name: `MASTER ${lvl} ${spec.name}`, code: `M${lvl}-${spec.code}`, cycleCode: "MASTER" });
    }
  }
  return rows;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const tenantRes = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM tenants WHERE slug = $1",
      [TENANT_SLUG]
    );
    if (tenantRes.rows.length !== 1) {
      throw new Error(`Expected exactly one tenant with slug "${TENANT_SLUG}", found ${tenantRes.rows.length}`);
    }
    const tenant = tenantRes.rows[0];

    const cyclesRes = await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM cycles WHERE tenant_id = $1 AND code = ANY($2)",
      [tenant.id, ["LICENCE", "MASTER"]]
    );
    const cycleByCode = new Map(cyclesRes.rows.map((r) => [r.code, r.id]));
    for (const code of ["LICENCE", "MASTER"]) {
      if (!cycleByCode.has(code)) throw new Error(`Cycle "${code}" not found for tenant ${TENANT_SLUG}`);
    }

    const filieres = buildFilieres();
    console.log(`Tenant: ${tenant.name} (${tenant.id})`);
    console.log(`Filières to seed: ${filieres.length} (LICENCE + MASTER)`);

    await client.query("BEGIN");

    let inserted = 0;
    for (const f of filieres) {
      const res = await client.query(
        `
          INSERT INTO programmes (tenant_id, cycle_id, name, code, status)
          VALUES ($1, $2, $3, $4, 'active')
          ON CONFLICT (tenant_id, code, version) DO NOTHING
        `,
        [tenant.id, cycleByCode.get(f.cycleCode), f.name, f.code]
      );
      inserted += res.rowCount ?? 0;
    }

    await client.query("COMMIT");

    const after = await client.query<{ count: string }>(
      "SELECT COUNT(*)::int AS count FROM programmes WHERE tenant_id = $1",
      [tenant.id]
    );

    console.log(`Inserted: ${inserted}, skipped (already existed): ${filieres.length - inserted}`);
    console.log(`Total programmes for ${TENANT_SLUG} now: ${after.rows[0].count}`);
    console.log("COMMITTED ✅");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("ERROR — nothing was inserted:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
