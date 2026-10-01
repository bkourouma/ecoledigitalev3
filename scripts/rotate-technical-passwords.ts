/**
 * Fait tourner le mot de passe de TOUS les comptes techniques (is_technical_account = true)
 * de tous les tenants.
 *
 * À lancer après avoir retiré l'ancien mot de passe par défaut du code : les comptes
 * créés avant ce changement conservent l'ancien hash, donc l'ancien mot de passe
 * (connu, car versionné dans l'historique git).
 *
 *   TECHNICAL_ACCOUNT_PASSWORD=<nouveau mot de passe> pnpm rotate:technical-passwords -- --yes
 *
 * - DATABASE_URL et TECHNICAL_ACCOUNT_PASSWORD sont lus dans l'environnement,
 *   à défaut dans .env / apps/api/.env.
 * - Sans `--yes`, le script ne fait qu'afficher le nombre de comptes concernés.
 * - Le mot de passe en clair n'est jamais stocké (initial_password est vidé).
 * - Utiliser la même valeur pour TECHNICAL_ACCOUNT_PASSWORD côté API et côté web.
 */
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { loadEnvFiles } from "./lib/load-env.mjs";

loadEnvFiles();

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const password = process.env.TECHNICAL_ACCOUNT_PASSWORD?.trim();

  if (!databaseUrl) throw new Error("DATABASE_URL est requis (voir .env.example)");
  if (!password || password.length < 12) {
    throw new Error("TECHNICAL_ACCOUNT_PASSWORD est requis (12 caractères minimum)");
  }

  const confirmed = process.argv.includes("--yes");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const count = await client.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM users WHERE COALESCE(is_technical_account, false) = true"
    );
    const total = Number(count.rows[0]?.n ?? 0);
    console.log(`${total} compte(s) technique(s) trouvé(s).`);

    if (!confirmed) {
      console.log("Mode simulation : relancer avec --yes pour appliquer la rotation.");
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `UPDATE users
          SET password_hash = $1,
              initial_password = NULL,
              updated_at = NOW()
        WHERE COALESCE(is_technical_account, false) = true`,
      [hash]
    );
    console.log(`Mot de passe renouvelé pour ${result.rowCount} compte(s) technique(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
