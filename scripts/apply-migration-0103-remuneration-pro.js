#!/usr/bin/env node

/**
 * Applies infra/scripts/migrations/0103_remuneration_professionnelle.sql.
 *
 * Feature 031 — Remuneration des enseignants du Module Professionnel :
 * cycle de vie des seances ECUE, tarifs horaires par ECUE, ouverture de
 * payment_hour_details aux deux origines, plus la regularisation de cinq
 * defauts preexistants (E4..E8, voir l'en-tete de la migration).
 *
 * Additive et idempotente : rejouable sans effet de bord. Deux controles de
 * donnees (paiements en double, periodes chevauchantes) arretent la migration
 * avec un message actionnable — c'est voulu.
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

const CHECKS = [
  {
    label: "professional_ecue_hourly_rates (table)",
    sql: "SELECT to_regclass('public.professional_ecue_hourly_rates') IS NOT NULL AS ok",
  },
  {
    label: "professional_ecue_seances.statut",
    sql: `SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='professional_ecue_seances' AND column_name='statut') AS ok`,
  },
  {
    label: "professional_ecue_seances.validated_at",
    sql: `SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='professional_ecue_seances' AND column_name='validated_at') AS ok`,
  },
  {
    label: "payment_hour_details.source",
    sql: `SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='payment_hour_details' AND column_name='source') AS ok`,
  },
  {
    label: "payment_hour_details.seance_id",
    sql: `SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='payment_hour_details' AND column_name='seance_id') AS ok`,
  },
  {
    label: "payment_hour_details.teaching_hours_id nullable",
    sql: `SELECT (is_nullable = 'YES') AS ok FROM information_schema.columns
            WHERE table_name='payment_hour_details' AND column_name='teaching_hours_id'`,
  },
  {
    label: "payment_periods.academic_year_id",
    sql: `SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='payment_periods' AND column_name='academic_year_id') AS ok`,
  },
  {
    label: "contrainte payment_periods_no_overlap (E8)",
    sql: "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_periods_no_overlap') AS ok",
  },
  {
    label: "contrainte unique_teacher_payment_per_period (E7)",
    sql: "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unique_teacher_payment_per_period') AS ok",
  },
  {
    label: "vue v_payment_hour_details_enriched",
    sql: "SELECT to_regclass('public.v_payment_hour_details_enriched') IS NOT NULL AS ok",
  },
];

async function applyMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "infra",
    "scripts",
    "migrations",
    "0103_remuneration_professionnelle.sql"
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

  console.log("Applying 0103_remuneration_professionnelle.sql (Feature 031)");
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
    console.log("Verification");
    console.log("-".repeat(80));
    let allOk = true;
    for (const check of CHECKS) {
      const res = await client.query(check.sql);
      const ok = res.rows[0] && res.rows[0].ok === true;
      if (!ok) allOk = false;
      console.log(`  ${ok ? "OK  " : "FAIL"}  ${check.label}`);
    }

    // Aucune seance ne doit avoir ete validee par la migration (D-R12).
    const seances = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE statut <> 'planifiee')::int AS non_planifiees,
              count(*) FILTER (WHERE validated_at IS NOT NULL)::int AS validees
       FROM professional_ecue_seances`
    );
    const s = seances.rows[0];
    console.log("");
    console.log(`  Seances : ${s.total} total, ${s.non_planifiees} hors 'planifiee', ${s.validees} validees`);
    if (s.validees > 0) {
      console.log("  NOTE: des seances sont deja validees — validation applicative, pas un backfill.");
    }

    console.log("");
    if (allOk) {
      console.log("Migration 0103 applied successfully.");
    } else {
      console.log("Migration appliquee mais des verifications ont echoue — inspecter ci-dessus.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("");
    console.error("Migration failed:", error.message);
    if (error.code) console.error("Code:", error.code);
    if (error.hint) console.error("Hint:", error.hint);
    if (error.position) {
      const pos = parseInt(error.position, 10);
      const before = migrationSQL.slice(0, pos);
      const line = before.split("\n").length;
      console.error(`Position: ${pos} (ligne ${line})`);
      console.error("Contexte :");
      console.error(migrationSQL.slice(Math.max(0, pos - 200), pos + 200));
    }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

applyMigration();
