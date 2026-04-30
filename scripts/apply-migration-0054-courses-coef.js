#!/usr/bin/env node

/**
 * Applique infra/scripts/migrations/0054_courses_coef_decimal.sql
 * Usage: node scripts/apply-migration-0054-courses-coef.js
 *
 * Connexion : DATABASE_URL, sinon variables DB_* / valeurs par défaut (dev local).
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadApiEnv() {
  const envPath = path.join(__dirname, "..", "apps", "api", ".env");
  try {
    const dotenv = require(path.join(__dirname, "..", "apps", "api", "node_modules", "dotenv"));
    dotenv.config({ path: envPath });
  } catch {
    try {
      require("dotenv").config({ path: envPath });
    } catch {
      /* sans dotenv : uniquement variables d'environnement système */
    }
  }
}

loadApiEnv();

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "dbecoledigitale",
  user: process.env.DB_USER || "postgres",
  password:
    process.env.DB_PASSWORD ||
    process.env.POSTGRES_PASSWORD ||
    "mysecretpassword",
};

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * postgresql://user:pass@word@host:port/db — le @ du mot de passe casse new URL().
 * Le dernier @ sépare (user + mot de passe) et (hôte…).
 */
function pgConfigFromDatabaseUrl(url) {
  if (!url || !url.startsWith("postgresql://")) return null;
  const without = url.replace(/^postgresql:\/\//, "");
  const lastAt = without.lastIndexOf("@");
  if (lastAt <= 0) return null;
  const userPass = without.slice(0, lastAt);
  const hostPortDb = without.slice(lastAt + 1);
  const colon = userPass.indexOf(":");
  if (colon < 0) return null;
  const user = userPass.slice(0, colon);
  const password = userPass.slice(colon + 1);
  const slash = hostPortDb.indexOf("/");
  const hostPort = slash >= 0 ? hostPortDb.slice(0, slash) : hostPortDb;
  const database = slash >= 0 ? hostPortDb.slice(slash + 1).split("?")[0] : "postgres";
  const pc = hostPort.lastIndexOf(":");
  const host = pc > 0 ? hostPort.slice(0, pc) : hostPort;
  const port = pc > 0 ? parseInt(hostPort.slice(pc + 1), 10) || 5432 : 5432;
  return { user, password, host, port, database };
}

async function applyMigration() {
  console.log("Application de 0054_courses_coef_decimal.sql (coef -> NUMERIC(8,2))");
  console.log("=".repeat(60));

  const migrationPath = path.join(
    __dirname,
    "..",
    "infra",
    "scripts",
    "migrations",
    "0054_courses_coef_decimal.sql"
  );

  if (!fs.existsSync(migrationPath)) {
    console.error("Fichier introuvable:", migrationPath);
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

  try {
    await client.connect();
    console.log("Connecte a la base.");
    if (parsedUrl != null) console.log(`   (${parsedUrl.host}:${parsedUrl.port}/${parsedUrl.database})`);
    else if (DATABASE_URL) console.log("   (DATABASE_URL)");
    else console.log(`   (${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database})`);

    await client.query(migrationSQL);
    console.log("");
    console.log("Migration 0054 appliquee avec succes.");
  } catch (error) {
    console.error("");
    console.error("Erreur:", error.message);
    if (error.code) console.error("   Code:", error.code);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  applyMigration().catch(console.error);
}

module.exports = { applyMigration };
