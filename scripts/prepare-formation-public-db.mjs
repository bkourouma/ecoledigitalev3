import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");
const apiDir = path.join(repoRoot, "apps", "api");
const publicAppDir = path.join(repoRoot, "apps", "formation-pro-public");
const schemaPath = path.join(apiDir, "prisma", "schema.prisma");
const prismaCliPath = path.join(
  apiDir,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);

const externalEnvKeys = new Set(Object.keys(process.env));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || externalEnvKeys.has(key)) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value.replace(/\\n/g, "\n");
  }
}

[
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(apiDir, ".env"),
  path.join(apiDir, ".env.local"),
  path.join(publicAppDir, ".env"),
  path.join(publicAppDir, ".env.local"),
].forEach(loadEnvFile);

if (!fs.existsSync(prismaCliPath)) {
  console.error(
    "[formation-pro-public] Prisma CLI not found. Run pnpm install before applying the database setup."
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "[formation-pro-public] DATABASE_URL is missing. Check apps/api/.env or apps/formation-pro-public/.env.local."
  );
  process.exit(1);
}

function runPrisma(args) {
  const result = spawnSync(
    process.execPath,
    [prismaCliPath, ...args, "--schema", schemaPath],
    {
      stdio: "inherit",
      cwd: apiDir,
      env: process.env,
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[formation-pro-public] Applying Prisma migrations on shared database...");
runPrisma(["migrate", "deploy"]);

console.log("[formation-pro-public] Regenerating Prisma client...");
runPrisma(["generate"]);

console.log("[formation-pro-public] Database is ready for the public portal.");
