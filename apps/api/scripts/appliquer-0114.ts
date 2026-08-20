/**
 * Applique la migration 0114 (versement distinct de l'archivage).
 *
 *   npx tsx scripts/appliquer-0114.ts
 *
 * Le fichier SQL est joué dans une transaction. L'état est affiché avant et
 * après pour que l'effet soit constatable.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";

const ICI = __dirname;
const url = (
  readFileSync(resolve(ICI, "../.env"), "utf8").match(/^DATABASE_URL=(.*)$/m) as string[]
)[1].trim();
const FICHIER = resolve(ICI, "../../../infra/scripts/migrations/0114_versement_distinct_archivage.sql");

async function etat(c: Client, titre: string) {
  const r = await c.query(
    `SELECT status::text AS statut, count(*)::int AS n,
            count(paid_at)::int AS avec_paid_at,
            count(*) FILTER (WHERE total_amount <= 0)::int AS a_zero
       FROM teacher_payments GROUP BY 1 ORDER BY 2 DESC`
  );
  console.log(`-- ${titre}`);
  console.table(r.rows);
}

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();

  await etat(c, "avant");

  await c.query("BEGIN");
  try {
    await c.query(readFileSync(FICHIER, "utf8"));
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }

  await etat(c, "apres");

  const incoherences = await c.query(
    `SELECT count(*)::int AS payes_sans_date FROM teacher_payments
      WHERE status = 'paid' AND paid_at IS NULL`
  );
  console.log(`payes sans date de versement : ${incoherences.rows[0].payes_sans_date} (attendu 0)`);

  await c.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
