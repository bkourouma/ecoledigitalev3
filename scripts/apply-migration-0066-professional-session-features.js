#!/usr/bin/env node

/**
 * Applies infra/scripts/migrations/0066_professional_session_features.sql.
 *
 * - professional_assignments + professional_assignment_submissions
 * - Extension de live_sessions pour rattacher à une session professionnelle.
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnv(rel) {
  const p = path.join(__dirname, "..", rel);
  if (!fs.existsSync(p)) return;
  try {
    require("dotenv").config({ path: p });
  } catch {
    try {
      require(path.join(__dirname, "..", "apps", "api", "node_modules", "dotenv")).config({
        path: p,
      });
    } catch {
      /* noop */
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

function fromUrl(url) {
  if (!url || !url.startsWith("postgresql://")) return null;
  const ws = url.replace(/^postgresql:\/\//, "");
  const at = ws.lastIndexOf("@");
  if (at <= 0) return null;
  const userPass = ws.slice(0, at);
  const hpd = ws.slice(at + 1);
  const c = userPass.indexOf(":");
  if (c < 0) return null;
  const user = decodeURIComponent(userPass.slice(0, c));
  const password = decodeURIComponent(userPass.slice(c + 1));
  const slash = hpd.indexOf("/");
  const hostPort = slash >= 0 ? hpd.slice(0, slash) : hpd;
  const database = slash >= 0 ? hpd.slice(slash + 1).split("?")[0] : "postgres";
  const ps = hostPort.lastIndexOf(":");
  return {
    user,
    password,
    host: ps > 0 ? hostPort.slice(0, ps) : hostPort,
    port: ps > 0 ? parseInt(hostPort.slice(ps + 1), 10) || 5432 : 5432,
    database,
  };
}

async function main() {
  const mp = path.join(
    __dirname,
    "..",
    "infra",
    "scripts",
    "migrations",
    "0066_professional_session_features.sql"
  );
  if (!fs.existsSync(mp)) {
    console.error("Migration file not found:", mp);
    process.exit(1);
  }
  const sql = fs.readFileSync(mp, "utf8");
  const parsed = DATABASE_URL ? fromUrl(DATABASE_URL) : null;
  const client = parsed ? new Client(parsed) : DATABASE_URL ? new Client({ connectionString: DATABASE_URL }) : new Client(DB_CONFIG);
  console.log("Applying 0066_professional_session_features.sql");
  try {
    await client.connect();
    await client.query(sql);
    console.log("Migration 0066 applied successfully.");
  } catch (e) {
    console.error("Migration 0066 failed:", e.message);
    if (e.code) console.error("Code:", e.code);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) main();
module.exports = { main };
