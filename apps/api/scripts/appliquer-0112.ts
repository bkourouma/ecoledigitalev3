/**
 * Applique la migration 0112 (chevauchement des périodes de paiement autorisé).
 *
 *   npx tsx scripts/appliquer-0112.ts
 *
 * Le fichier SQL est joué tel quel, dans une transaction. L'état de la
 * contrainte est affiché avant et après pour que le résultat soit constatable.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";

// Chemins résolus depuis CE fichier, pas depuis le répertoire courant : le
// script doit marcher qu'on le lance de apps/api ou de la racine du dépôt.
const ICI = __dirname;
const url = (
  readFileSync(resolve(ICI, "../.env"), "utf8").match(/^DATABASE_URL=(.*)$/m) as string[]
)[1].trim();
const FICHIER = resolve(
  ICI,
  "../../../infra/scripts/migrations/0112_periodes_paie_chevauchement_autorise.sql"
);

async function contrainte(c: Client): Promise<string | null> {
  const r = await c.query(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1",
    ["payment_periods_no_overlap"]
  );
  return r.rows[0]?.def ?? null;
}

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();

  console.log("avant :", (await contrainte(c)) ?? "absente");

  await c.query("BEGIN");
  try {
    await c.query(readFileSync(FICHIER, "utf8"));
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }

  console.log("apres :", (await contrainte(c)) ?? "absente");
  await c.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
