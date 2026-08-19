#!/usr/bin/env node

/**
 * Applies infra/scripts/migrations/0104_seance_duree_payee.sql.
 *
 * Feature 031 (extension) — derogation comptable sur le volume horaire d'une
 * seance + tracage de la saisie comptable.
 *
 * Additive et idempotente : rejouable sans effet de bord. Aucune seance
 * existante n'acquiert de derogation.
 *
 * Connection order: DATABASE_URL -> DB_* env vars -> local development defaults.
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
      /* variables deja presentes */
    }
  }
}

loadEnv(".env");
loadEnv(path.join("apps", "api", ".env"));

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "dbecoledigitale",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "mysecretpassword",
};

const DATABASE_URL = process.env.DATABASE_URL;

function pgConfigFromDatabaseUrl(url) {
  if (!url || !url.startsWith("postgresql://")) return null;
  const withoutScheme = url.replace(/^postgresql:\/\//, "");
  const lastAt = withoutScheme.lastIndexOf("@");
  if (lastAt <= 0) return null;
  const userPass = withoutScheme.slice(0, lastAt);
  const hostPortDb = withoutScheme.slice(lastAt + 1);
  const colon = userPass.indexOf(":");
  if (colon < 0) return null;
  const slash = hostPortDb.indexOf("/");
  const hostPort = slash >= 0 ? hostPortDb.slice(0, slash) : hostPortDb;
  const portSeparator = hostPort.lastIndexOf(":");
  return {
    user: decodeURIComponent(userPass.slice(0, colon)),
    password: decodeURIComponent(userPass.slice(colon + 1)),
    host: portSeparator > 0 ? hostPort.slice(0, portSeparator) : hostPort,
    port: portSeparator > 0 ? parseInt(hostPort.slice(portSeparator + 1), 10) || 5432 : 5432,
    database: slash >= 0 ? hostPortDb.slice(slash + 1).split("?")[0] : "postgres",
  };
}

function columnCheck(column) {
  return {
    label: `professional_ecue_seances.${column}`,
    sql: `SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'professional_ecue_seances' AND column_name = $1
          ) AS ok`,
    params: [column],
  };
}

const CHECKS = [
  columnCheck("duree_payee"),
  columnCheck("duree_payee_par"),
  columnCheck("duree_payee_le"),
  columnCheck("saisie_comptable"),
  columnCheck("cree_par"),
  {
    label: "contrainte duree_payee > 0",
    sql: `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'professional_ecue_seances_duree_payee_positive'
          ) AS ok`,
    params: [],
  },
  {
    label: "index des derogations",
    sql: `SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE indexname = 'idx_prof_ecue_seances_derogation'
          ) AS ok`,
    params: [],
  },
];

async function applyMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "infra",
    "scripts",
    "migrations",
    "0104_seance_duree_payee.sql"
  );
  if (!fs.existsSync(migrationPath)) {
    console.error("Migration file not found:", migrationPath);
    process.exit(1);
  }
  const migrationSQL = fs.readFileSync(migrationPath, "utf8");
  const parsedUrl = DATABASE_URL ? pgConfigFromDatabaseUrl(DATABASE_URL) : null;
  const client =
    parsedUrl != null
      ? new Client(parsedUrl)
      : DATABASE_URL
        ? new Client({ connectionString: DATABASE_URL })
        : new Client(DB_CONFIG);

  console.log("Applying 0104_seance_duree_payee.sql (Feature 031 — derogation comptable)");
  console.log("=".repeat(80));

  try {
    await client.connect();
    if (parsedUrl != null) {
      console.log(`Connected to ${parsedUrl.host}:${parsedUrl.port}/${parsedUrl.database}`);
    } else {
      console.log("Connected");
    }

    await client.query(migrationSQL);

    console.log("");
    console.log("Verification");
    console.log("-".repeat(80));
    let allOk = true;
    for (const check of CHECKS) {
      const res = await client.query(check.sql, check.params);
      const ok = res.rows[0] && res.rows[0].ok === true;
      if (!ok) allOk = false;
      console.log(`  ${ok ? "OK  " : "FAIL"}  ${check.label}`);
    }

    // Aucune seance ne doit avoir acquis de derogation par la migration.
    const derog = await client.query(
      `SELECT count(*) FILTER (WHERE duree_payee IS NOT NULL)::int AS avec_derogation,
              count(*) FILTER (WHERE saisie_comptable)::int        AS saisies_comptables,
              count(*)::int                                        AS total
       FROM professional_ecue_seances`
    );
    const d = derog.rows[0];
    console.log("");
    console.log(
      `  Seances : ${d.total} total, ${d.avec_derogation} avec derogation, ${d.saisies_comptables} saisie(s) comptable(s)`
    );

    console.log("");
    console.log(allOk ? "Migration 0104 applied successfully." : "Verifications en echec — inspecter ci-dessus.");
    if (!allOk) process.exitCode = 1;
  } catch (error) {
    console.error("");
    console.error("Migration failed:", error.message);
    if (error.code) console.error("Code:", error.code);
    if (error.position) {
      const pos = parseInt(error.position, 10);
      console.error(`Ligne ${migrationSQL.slice(0, pos).split("\n").length}`);
      console.error(migrationSQL.slice(Math.max(0, pos - 180), pos + 180));
    }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

applyMigration();
