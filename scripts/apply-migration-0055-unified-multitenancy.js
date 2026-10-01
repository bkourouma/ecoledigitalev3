#!/usr/bin/env node

/**
 * Applies infra/scripts/migrations/0055_unified_multitenancy.sql.
 *
 * Connection order:
 * 1. DATABASE_URL
 * 2. DB_* environment variables
 * 3. local development defaults
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

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "dbecoledigitale",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || (() => { throw new Error("DB_PASSWORD (ou POSTGRES_PASSWORD) est requis"); })(),
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

async function applyMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "infra",
    "scripts",
    "migrations",
    "0055_unified_multitenancy.sql"
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

  console.log("Applying 0055_unified_multitenancy.sql");
  console.log("This migration tenantizes the database, merges duplicate users, drops ASPCI/session tables, and enables RLS.");
  console.log("=".repeat(80));

  try {
    await client.connect();

    if (parsedUrl != null) {
      console.log(`Connected to ${parsedUrl.host}:${parsedUrl.port}/${parsedUrl.database}`);
    } else if (DATABASE_URL) {
      console.log("Connected with DATABASE_URL");
    } else {
      console.log(`Connected to ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    }

    await client.query(migrationSQL);
    console.log("");
    console.log("Migration 0055 applied successfully.");
  } catch (error) {
    console.error("");
    console.error("Migration 0055 failed:");
    console.error(error.message);
    if (error.code) console.error("Code:", error.code);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  applyMigration().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { applyMigration };
