// Applique la migration 0071_semestre.sql sur la base de dev locale.
// Usage : node scripts/apply-migration-0071.cjs
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const CONN =
  process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  try {
    // Prérequis : tables référencées par la migration.
    const pre = await client.query(
      `SELECT to_regclass('public.tenants') AS tenants,
              to_regclass('public.users') AS users,
              to_regclass('public.programmes') AS programmes,
              to_regclass('public.professional_ue_sessions') AS ue_sessions`
    );
    console.log("Prérequis:", pre.rows[0]);
    const missing = Object.entries(pre.rows[0]).filter(([, v]) => v == null);
    if (missing.length > 0) {
      throw new Error(
        "Tables prérequises manquantes: " + missing.map(([k]) => k).join(", ")
      );
    }

    const sqlPath = path.join(
      __dirname,
      "..",
      "infra",
      "scripts",
      "migrations",
      "0071_semestre.sql"
    );
    const sql = fs.readFileSync(sqlPath, "utf8");
    await client.query(sql);
    console.log("✅ Migration 0071 appliquée.");

    const post = await client.query(
      `SELECT to_regclass('public.professional_semestres') AS semestres,
              to_regclass('public.professional_semestre_sessions') AS semestre_sessions`
    );
    console.log("Tables créées:", post.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
