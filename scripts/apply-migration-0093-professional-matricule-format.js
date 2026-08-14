#!/usr/bin/env node

/**
 * Applies infra/scripts/migrations/0093_professional_matricule_format.sql.
 *
 * Normalise `professional_student_matricules.matricule` au format canonique
 * `IPAM-<CODE FILIERE>-<NNNN>` (ex. IPAM-L1GL-9009). Le matricule est recalcule
 * depuis programmes.code + seq, donc les deux anciennes conventions convergent.
 * Idempotent : une ligne deja au bon format n'est pas reecrite.
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

/** Compte les lignes qui ne sont pas encore au format canonique. */
const NON_CANONICAL_COUNT = `
  SELECT count(*)::int AS n
  FROM professional_student_matricules psm
  JOIN programmes p ON p.id = psm.filiere_id
  WHERE psm.matricule IS DISTINCT FROM (
    'IPAM-'
      || COALESCE(NULLIF(upper(regexp_replace(p.code, '[^A-Za-z0-9]', '', 'g')), ''), 'XXX')
      || '-' || lpad(psm.seq::text, 4, '0')
  )
`;

async function applyMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "infra",
    "scripts",
    "migrations",
    "0093_professional_matricule_format.sql"
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

  console.log("Applying 0093_professional_matricule_format.sql");
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

    const before = await client.query(NON_CANONICAL_COUNT);
    const total = await client.query(
      "SELECT count(*)::int AS n FROM professional_student_matricules"
    );
    console.log(`Avant : ${before.rows[0].n} / ${total.rows[0].n} matricules a normaliser`);

    await client.query(migrationSQL);

    const after = await client.query(NON_CANONICAL_COUNT);
    const sample = await client.query(
      `SELECT matricule FROM professional_student_matricules ORDER BY matricule LIMIT 5`
    );
    console.log("");
    console.log(`Migration 0093 applied. Restant hors format : ${after.rows[0].n}`);
    console.log("Echantillon :", sample.rows.map((r) => r.matricule).join(", "));
  } catch (error) {
    console.error("");
    console.error("Migration 0093 failed:");
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
