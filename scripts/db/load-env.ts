/**
 * Charge `.env` (racine) puis `apps/api/.env` s'ils existent, SANS écraser les variables
 * déjà définies dans l'environnement (une variable exportée dans le shell ou injectée par
 * la CI l'emporte toujours). Aucune dépendance : `process.loadEnvFile` (Node >= 20.12).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");

for (const file of [resolve(root, ".env"), resolve(root, "apps", "api", ".env")]) {
  if (!existsSync(file)) continue;
  try {
    const loader = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;
    loader?.(file);
  } catch {
    /* fichier illisible : on continue avec l'environnement courant */
  }
}
