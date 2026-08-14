#!/usr/bin/env node

/**
 * Applies infra/scripts/migrations/0095_retire_admin_menu_keys.sql.
 *
 * Retire du catalogue de menus administrateur les trois entrees
 * academic.bilan_types, academic.courses et people.registrations, et supprime
 * les lignes de permissions devenues orphelines dans admin_role_menus (0091) et
 * role_menu_denials (0092). Idempotent.
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
      // Environment variables already present are enough.
    }
  }
}

loadEnv(".env");
loadEnv(path.join("apps", "api", ".env"));

const RETIRED_KEYS = ["academic.bilan_types", "academic.courses", "people.registrations"];

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

async function countRetired(client, table) {
  const exists = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  if (!exists.rows[0].ok) return null;
  const res = await client.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE menu_key = ANY($1::text[])`,
    [RETIRED_KEYS]
  );
  return res.rows[0].n;
}

async function applyMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "infra",
    "scripts",
    "migrations",
    "0095_retire_admin_menu_keys.sql"
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

  console.log("Applying 0095_retire_admin_menu_keys.sql");
  console.log("=".repeat(80));

  try {
    await client.connect();
    if (parsedUrl != null) {
      console.log(`Connected to ${parsedUrl.host}:${parsedUrl.port}/${parsedUrl.database}`);
    } else {
      console.log(`Connected to ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    }

    const beforeRoles = await countRetired(client, "admin_role_menus");
    const beforeDenials = await countRetired(client, "role_menu_denials");
    console.log("");
    console.log("Avant :");
    console.log(`  admin_role_menus   : ${beforeRoles === null ? "table absente" : beforeRoles}`);
    console.log(`  role_menu_denials  : ${beforeDenials === null ? "table absente" : beforeDenials}`);

    client.on("notice", (msg) => console.log(`  [pg] ${msg.message}`));
    await client.query(migrationSQL);

    const afterRoles = await countRetired(client, "admin_role_menus");
    const afterDenials = await countRetired(client, "role_menu_denials");
    console.log("");
    console.log("Apres :");
    console.log(`  admin_role_menus   : ${afterRoles === null ? "table absente" : afterRoles}`);
    console.log(`  role_menu_denials  : ${afterDenials === null ? "table absente" : afterDenials}`);

    const emptyRoles = await client.query(
      `SELECT ar.name
         FROM admin_roles ar
        WHERE ar.is_active
          AND NOT EXISTS (SELECT 1 FROM admin_role_menus m WHERE m.admin_role_id = ar.id)`
    );
    if (emptyRoles.rowCount > 0) {
      console.log("");
      console.log(
        `ATTENTION : ${emptyRoles.rowCount} role(s) administratif(s) actif(s) sans aucun menu :`
      );
      for (const row of emptyRoles.rows) console.log(`  - ${row.name}`);
      console.log("Leurs porteurs verront un menu vide. A rouvrir depuis Acces > Roles.");
    }

    console.log("");
    console.log("Migration 0095 appliquee.");
  } catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

applyMigration();
