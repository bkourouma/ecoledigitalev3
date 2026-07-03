/**
 * Delete ALL UE / ECUE / UE↔ECUE links for the eca-formation tenant.
 * Does NOT touch filières (programmes), cycles, etc.
 *
 * Safety: scoped by tenant_id, single transaction. Dry-run by default;
 * pass --apply to commit.
 *
 * Usage (from apps/api):
 *   pnpm tsx scripts/delete-eca-formation-ue-ecue.ts            # preview
 *   pnpm tsx scripts/delete-eca-formation-ue-ecue.ts --apply    # delete
 */
import "dotenv/config";
import { Client } from "pg";

const TENANT_SLUG = "eca-formation";

async function main() {
  const apply = process.argv.includes("--apply");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const tRes = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM tenants WHERE slug = $1",
      [TENANT_SLUG]
    );
    if (tRes.rows.length !== 1) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);
    const tenantId = tRes.rows[0].id;

    const counts = async () => {
      const ue = await client.query("SELECT count(*)::int n FROM professional_ue WHERE tenant_id=$1", [tenantId]);
      const ecue = await client.query("SELECT count(*)::int n FROM professional_ecue WHERE tenant_id=$1", [tenantId]);
      const link = await client.query("SELECT count(*)::int n FROM professional_ue_ecue WHERE tenant_id=$1", [tenantId]);
      return { ue: ue.rows[0].n, ecue: ecue.rows[0].n, link: link.rows[0].n };
    };

    const before = await counts();
    console.log(`Tenant ${tRes.rows[0].name} (${TENANT_SLUG})`);
    console.log(`Before -> UE: ${before.ue}, ECUE: ${before.ecue}, affectations: ${before.link}`);

    await client.query("BEGIN");
    const dl = await client.query("DELETE FROM professional_ue_ecue WHERE tenant_id=$1", [tenantId]);
    const de = await client.query("DELETE FROM professional_ecue WHERE tenant_id=$1", [tenantId]);
    const du = await client.query("DELETE FROM professional_ue WHERE tenant_id=$1", [tenantId]);
    console.log(`Deleted -> affectations: ${dl.rowCount}, ECUE: ${de.rowCount}, UE: ${du.rowCount}`);

    if (apply) {
      await client.query("COMMIT");
      console.log("COMMITTED ✅ (suppression définitive)");
    } else {
      await client.query("ROLLBACK");
      console.log("ROLLED BACK 🔍 (aperçu — relancer avec --apply pour supprimer)");
    }
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("ERROR — rien supprimé:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
