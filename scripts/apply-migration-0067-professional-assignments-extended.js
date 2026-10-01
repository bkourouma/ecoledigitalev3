#!/usr/bin/env node
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnv(rel) {
  const p = path.join(__dirname, "..", rel);
  if (!fs.existsSync(p)) return;
  try { require("dotenv").config({ path: p }); }
  catch { try { require(path.join(__dirname, "..", "apps", "api", "node_modules", "dotenv")).config({ path: p }); } catch {} }
}
loadEnv(".env"); loadEnv(path.join("apps","api",".env"));

const DB = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "dbecoledigitale",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || (() => { throw new Error("DB_PASSWORD (ou POSTGRES_PASSWORD) est requis"); })(),
};
const URL = process.env.DATABASE_URL;

(async () => {
  const mp = path.join(__dirname, "..", "infra", "scripts", "migrations", "0067_professional_assignments_extended.sql");
  if (!fs.existsSync(mp)) { console.error("Missing:", mp); process.exit(1); }
  const sql = fs.readFileSync(mp, "utf8");
  const client = URL ? new Client({ connectionString: URL }) : new Client(DB);
  console.log("Applying 0067_professional_assignments_extended.sql");
  try {
    await client.connect();
    await client.query(sql);
    console.log("Migration 0067 applied successfully.");
  } catch (e) {
    console.error("Migration 0067 failed:", e.message);
    if (e.code) console.error("Code:", e.code);
    process.exit(1);
  } finally { await client.end(); }
})();
