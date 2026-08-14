#!/usr/bin/env node

/**
 * Applies the lot 3 ("l'argent") migrations, in order:
 *
 *   0096_professional_order_installments.sql  echeancier des commandes pro
 *   0097_owner_alerts_resolution.sql          resolved_at + href sur les alertes
 *
 * Both are additive and idempotent.
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

const MIGRATIONS = [
  "0096_professional_order_installments.sql",
  "0097_owner_alerts_resolution.sql",
];

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

async function applyMigrations() {
  const parsedUrl = DATABASE_URL ? pgConfigFromDatabaseUrl(DATABASE_URL) : null;
  const client =
    parsedUrl != null
      ? new Client(parsedUrl)
      : DATABASE_URL
        ? new Client({ connectionString: DATABASE_URL })
        : new Client(DB_CONFIG);

  console.log("Applying lot 3 migrations (tresorerie)");
  console.log("=".repeat(80));

  try {
    await client.connect();
    if (parsedUrl != null) {
      console.log(`Connected to ${parsedUrl.host}:${parsedUrl.port}/${parsedUrl.database}`);
    } else {
      console.log(`Connected to ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    }
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
      console.log(`   ok`);
    }

    const inst = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE is_default)::int AS par_defaut,
              count(*) FILTER (WHERE due_date < CURRENT_DATE)::int AS echues
         FROM professional_order_installments`
    );
    const orders = await client.query(
      `SELECT count(*)::int AS n FROM professional_orders WHERE statut <> 'annulee'`
    );
    console.log("");
    console.log(
      `Echeancier pro : ${inst.rows[0].total} echeance(s) pour ${orders.rows[0].n} commande(s) non annulee(s)` +
        ` — ${inst.rows[0].par_defaut} par defaut, ${inst.rows[0].echues} deja echue(s).`
    );

    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'owner_pilotage_alerts'
          AND column_name IN ('resolved_at', 'href')
        ORDER BY column_name`
    );
    console.log(
      `Alertes        : ${
        cols.rowCount === 0
          ? "table owner_pilotage_alerts absente (migration 0053 non appliquee sur cette base)"
          : `colonnes en place -> ${cols.rows.map((r) => r.column_name).join(", ")}`
      }`
    );

    console.log("");
    console.log("Migrations 0096 et 0097 appliquees.");
  } catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

applyMigrations();
