/**
 * One-off maintenance script: delete ALL programmes (and their cascade-linked
 * data such as courses) for a single tenant, identified by slug.
 *
 * Safety:
 *  - Every statement is scoped by tenant_id, so other tenants are never touched.
 *  - Runs inside a transaction. Without `--apply` it ROLLBACKs (dry-run preview).
 *  - With `--apply` it COMMITs.
 *
 * Usage (from apps/api):
 *   pnpm tsx scripts/delete-tenant-programmes.ts <slug>            # preview
 *   pnpm tsx scripts/delete-tenant-programmes.ts <slug> --apply    # delete
 */
import "dotenv/config";
import { Client } from "pg";

async function countForTenant(client: Client, table: string, tenantId: string): Promise<number> {
  try {
    const res = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    return res.rows[0].n as number;
  } catch {
    return -1; // table missing in this DB lineage
  }
}

async function main() {
  const slug = process.argv[2] || "ecaformation";
  const apply = process.argv.includes("--apply");

  const connectionString = process.env.DATABASE_URL || process.env.DB_MAIN_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const tenantRes = await client.query<{ id: string; slug: string; name: string; is_reference: boolean }>(
      "SELECT id, slug, name, COALESCE(is_reference, false) AS is_reference FROM tenants WHERE slug = $1",
      [slug]
    );

    if (tenantRes.rows.length === 0) {
      throw new Error(`No tenant found with slug "${slug}"`);
    }
    if (tenantRes.rows.length > 1) {
      throw new Error(`Multiple tenants found with slug "${slug}" — aborting`);
    }

    const tenant = tenantRes.rows[0];
    if (tenant.is_reference) {
      throw new Error(`Tenant "${slug}" is the REFERENCE tenant — refusing to wipe its programmes`);
    }

    console.log(`Tenant: ${tenant.name} (slug=${tenant.slug}, id=${tenant.id})`);

    const beforeProgrammes = await countForTenant(client, "programmes", tenant.id);
    const beforeCourses = await countForTenant(client, "courses", tenant.id);
    const beforeClasses = await countForTenant(client, "classes", tenant.id);
    console.log(
      `Before -> programmes: ${beforeProgrammes}, courses: ${beforeCourses}, classes: ${beforeClasses}`
    );

    await client.query("BEGIN");

    const delCourses = await client.query("DELETE FROM courses WHERE tenant_id = $1", [tenant.id]);
    const delProgrammes = await client.query("DELETE FROM programmes WHERE tenant_id = $1", [tenant.id]);

    console.log(`Deleted -> courses: ${delCourses.rowCount}, programmes: ${delProgrammes.rowCount}`);

    if (apply) {
      await client.query("COMMIT");
      console.log("COMMITTED ✅  (changes are permanent)");
    } else {
      await client.query("ROLLBACK");
      console.log("ROLLED BACK 🔍  (dry-run — re-run with --apply to delete for real)");
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("ERROR — nothing was deleted:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
