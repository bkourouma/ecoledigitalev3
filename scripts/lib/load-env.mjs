/**
 * Chargeur minimal de fichiers .env pour les scripts (sans dépendance).
 * Ne remplace jamais une variable déjà présente dans process.env.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseLine(line) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match) return null;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, "");
  }
  return [match[1], value];
}

export function loadEnvFiles(files = [".env", "apps/api/.env"]) {
  for (const file of files) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const entry = parseLine(line);
      if (entry && process.env[entry[0]] === undefined) process.env[entry[0]] = entry[1];
    }
  }
}
