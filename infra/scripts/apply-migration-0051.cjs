/**
 * Applique 0051_users_initial_password.sql (mot de passe initial sur users).
 * Usage: depuis la racine du repo — node infra/scripts/apply-migration-0051.cjs
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function parseDatabaseUrl(url) {
  if (!url) throw new Error("DATABASE_URL manquant dans apps/api/.env");
  const trimmed = url.replace(/^["']|["']$/g, "").trim();
  const withoutScheme = trimmed.replace(/^postgresql:\/\//, "");
  const at = withoutScheme.lastIndexOf("@");
  if (at < 0) throw new Error("DATABASE_URL invalide");
  const auth = withoutScheme.slice(0, at);
  const rest = withoutScheme.slice(at + 1);
  const colon = auth.indexOf(":");
  const user = auth.slice(0, colon);
  const password = auth.slice(colon + 1);
  const slash = rest.indexOf("/");
  const hostPort = slash >= 0 ? rest.slice(0, slash) : rest;
  const database = slash >= 0 ? rest.slice(slash + 1) : "postgres";
  const [host, portStr] = hostPort.split(":");
  return {
    user,
    password,
    host,
    port: portStr ? parseInt(portStr, 10) : 5432,
    database: database.split("?")[0],
  };
}

async function main() {
  const envPath = path.join(__dirname, "../../apps/api/.env");
  if (!fs.existsSync(envPath)) {
    console.error("Fichier introuvable:", envPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(envPath, "utf8");
  const line = raw.split("\n").find((l) => /^\s*DATABASE_URL=/.test(l));
  if (!line) {
    console.error("DATABASE_URL non trouvé dans apps/api/.env");
    process.exit(1);
  }
  const url = line.replace(/^\s*DATABASE_URL=\s*/, "").trim();
  const cfg = parseDatabaseUrl(url);

  const sqlPath = path.join(__dirname, "migrations/0051_users_initial_password.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const client = new Client(cfg);
  await client.connect();
  try {
    await client.query(sql);
    console.log("Migration 0051_users_initial_password.sql appliquée avec succès.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
