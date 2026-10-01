#!/usr/bin/env node

/**
 * Applies the lot 6 ("l'economie") migrations, in order:
 *
 *   0098_expenses.sql                 charges de l'etablissement
 *   0099_student_status_history.sql   historique des statuts eleve + trigger
 *
 * Both are additive and idempotent.
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnv(relativePath) {
  const envPath = path.join(__dirname, "..", relativePath);
  if (!fs.existsSync(envPath)) return;
  try {
    require("dotenv").config({ path: envPath });
  } catch {
    try {
      require(path.join(__dirname, "..", "apps", "api", "node_modules", "dotenv")).config({
        path: envPath,
      });
    } catch {
      // Environment variables already present are enough.
    }
  }
}

loadEnv(".env");
loadEnv(path.join("apps", "api", ".env"));

const MIGRATIONS = ["0098_expenses.sql", "0099_student_status_history.sql"];

function pgConfigFromDatabaseUrl(url) {
  if (!url || !url.startsWith("postgresql://")) return null;
  const withoutScheme = url.replace(/^postgresql:\/\//, "");
  const lastAt = withoutScheme.lastIndexOf("@");
  if (lastAt <= 0) return null;
  const userPass = withoutScheme.slice(0, lastAt);
  const hostPortDb = withoutScheme.slice(lastAt + 1);
  const colon = userPass.indexOf(":");
  if (colon < 0) return null;
  const user = decodeURIComponent(userPass.slice(0, colon));
  const password = decodeURIComponent(userPass.slice(colon + 1));
  const slash = hostPortDb.indexOf("/");
  const hostPort = slash >= 0 ? hostPortDb.slice(0, slash) : hostPortDb;
  const database = slash >= 0 ? hostPortDb.slice(slash + 1).split("?")[0] : "postgres";
  const portSeparator = hostPort.lastIndexOf(":");
  return {
    user,
    password,
    host: portSeparator > 0 ? hostPort.slice(0, portSeparator) : hostPort,
    port: portSeparator > 0 ? parseInt(hostPort.slice(portSeparator + 1), 10) || 5432 : 5432,
    database,
  };
}

async function applyMigrations() {
  const parsed = pgConfigFromDatabaseUrl(process.env.DATABASE_URL);
  const client = parsed
    ? new Client(parsed)
    : new Client({
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "5432", 10),
        database: process.env.DB_NAME || "dbecoledigitale",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || (() => { throw new Error("DB_PASSWORD (ou POSTGRES_PASSWORD) est requis"); })(),
      });

  console.log("Applying lot 6 migrations (economie)");
  console.log("=".repeat(80));

  try {
    await client.connect();
    client.on("notice", (msg) => console.log(`  [pg] ${msg.message}`));

    for (const name of MIGRATIONS) {
      const file = path.join(__dirname, "..", "infra", "scripts", "migrations", name);
      if (!fs.existsSync(file)) {
        console.error(`Migration file not found: ${file}`);
        process.exitCode = 1;
        return;
      }
      console.log(`\n-- ${name}`);
      await client.query(fs.readFileSync(file, "utf8"));
      console.log("   ok");
    }

    const cat = await client.query(`SELECT count(*)::int n FROM expense_categories`);
    const exp = await client.query(`SELECT count(*)::int n FROM expenses`);
    const hist = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE reason_code = 'baseline_0099')::int AS baseline,
              min(changed_at)::date::text AS depuis
         FROM student_status_history`
    );
    const trg = await client.query(
      `SELECT count(*)::int n FROM pg_trigger
        WHERE tgname = 'student_status_history_trigger' AND NOT tgisinternal`
    );

    console.log("");
    console.log(`Categories de charges : ${cat.rows[0].n}`);
    console.log(`Charges saisies       : ${exp.rows[0].n} (table volontairement vide au depart)`);
    console.log(
      `Historique statuts    : ${hist.rows[0].total} ligne(s) dont ${hist.rows[0].baseline} de reference, depuis ${hist.rows[0].depuis ?? "-"}`
    );
    console.log(`Declencheur installe  : ${trg.rows[0].n === 1 ? "oui" : "NON"}`);
    console.log("");
    console.log("Migrations 0098 et 0099 appliquees.");
  } catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

applyMigrations();
