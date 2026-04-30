// Delete all students for a tenant (and linked user accounts)
// Usage: node apps/api/scripts/delete-all-students.js [tenantSlug]
// Default tenantSlug: imhotepacademy

const { Pool } = require("pg");

const DEFAULT_CONN =
  process.env.DATABASE_URL ||
  "postgresql://postgres:DevMick%402003@localhost:5432/dbecoledigitale";
const tenantSlug = process.argv[2] || "imhotepacademy";

async function resolveTenantId(client, slug) {
  const q = "SELECT id FROM tenants WHERE slug = $1 LIMIT 1";
  const r = await client.query(q, [slug]);
  if (r.rows.length > 0) return r.rows[0].id;
  if (slug === "imhotepacademy") return "6eb9c106-b650-4398-b6fa-091b6828c4ba";
  throw new Error(`Tenant not found for '${slug}'`);
}

async function run(tenant) {
  const pool = new Pool({ connectionString: DEFAULT_CONN });
  const client = await pool.connect();

  try {
    console.log(`Connecting... tenant='${tenant}'`);
    const tenantId = await resolveTenantId(client, tenant);
    console.log(`Resolved tenantId: ${tenantId}`);

    const beforeStudents = await client.query(
      "SELECT COUNT(*)::int AS c FROM student_profiles WHERE tenant_id = $1",
      [tenantId]
    );

    // Capture linked user ids before deleting student profiles
    const linkedUsersRes = await client.query(
      "SELECT user_id FROM student_profiles WHERE tenant_id = $1 AND user_id IS NOT NULL",
      [tenantId]
    );
    const linkedUserIds = linkedUsersRes.rows.map((r) => r.user_id);

    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = 'replica'");

    // Remove dependencies from tables that reference student_profiles(id)
    // using a conventional student_id column.
    const fkRefs = await client.query(
      `
      SELECT tc.table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name = 'student_profiles'
        AND kcu.column_name = 'student_id'
      GROUP BY tc.table_name
      `
    );

    for (const row of fkRefs.rows) {
      const tableName = row.table_name;
      if (tableName === "student_profiles") continue;
      await client.query(
        `DELETE FROM "${tableName}" WHERE student_id IN (
          SELECT id FROM student_profiles WHERE tenant_id = $1
        )`,
        [tenantId]
      );
      console.log(`Deleted dependent rows from ${tableName}`);
    }

    await client.query("DELETE FROM student_profiles WHERE tenant_id = $1", [tenantId]);
    console.log("Deleted all student_profiles");

    if (linkedUserIds.length > 0) {
      await client.query(
        "DELETE FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])",
        [tenantId, linkedUserIds]
      );
      console.log(`Deleted ${linkedUserIds.length} linked users`);
    }

    await client.query("SET LOCAL session_replication_role = 'origin'");
    await client.query("COMMIT");

    const afterStudents = await client.query(
      "SELECT COUNT(*)::int AS c FROM student_profiles WHERE tenant_id = $1",
      [tenantId]
    );

    return {
      tenantId,
      before: { students: beforeStudents.rows[0].c },
      after: { students: afterStudents.rows[0].c },
      linkedUsersDeleted: linkedUserIds.length,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("Delete-all students failed:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { run };

if (require.main === module) {
  run(tenantSlug)
    .then((res) => {
      console.log("✅ Completed:", res);
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Error:", err);
      process.exit(1);
    });
}

