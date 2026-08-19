/**
 * Rattrapage : bulletins ARCHIVÉS restés au statut « calculé ».
 *
 *   npx tsx scripts/rattraper-statuts-archives.ts              # simulation
 *   npx tsx scripts/rattraper-statuts-archives.ts --appliquer  # écrit
 *
 * Depuis la migration 0113, l'archivage tranche le sort financier : payé, ou
 * impayé s'il n'y a rien à verser. Les bulletins classés AVANT ce changement
 * ont gardé leur statut de calcul, si bien que l'historique répond encore
 * « calculé » à la question « a-t-il été payé ? ».
 *
 * La règle appliquée est exactement celle de `archiverBulletins` :
 * montant > 0 -> payé, sinon impayé.
 *
 * Ne touche QUE les bulletins déjà archivés et au statut `calculated` : un
 * bulletin approuvé, contesté ou annulé garde le sien, et ceux encore au plan
 * de travail seront tranchés par leur propre archivage.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";

const ICI = __dirname;
const url = (
  readFileSync(resolve(ICI, "../.env"), "utf8").match(/^DATABASE_URL=(.*)$/m) as string[]
)[1].trim();
const APPLIQUER = process.argv.includes("--appliquer");

const CIBLES = `FROM teacher_payments
                WHERE archived_at IS NOT NULL AND status = 'calculated'`;

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();

  const apercu = await c.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE total_amount > 0)::int AS futurs_payes,
            count(*) FILTER (WHERE total_amount <= 0)::int AS futurs_impayes
     ${CIBLES}`
  );
  const { total, futurs_payes, futurs_impayes } = apercu.rows[0];
  console.log(`bulletins archives au statut « calcule » : ${total}`);
  console.log(`   deviendraient PAYE   : ${futurs_payes}`);
  console.log(`   deviendraient IMPAYE : ${futurs_impayes}`);

  if (!APPLIQUER) {
    console.log("\nsimulation — rien n'a ete ecrit. Relancer avec --appliquer pour corriger.");
    await c.end();
    return;
  }

  await c.query("BEGIN");
  try {
    const res = await c.query(
      `UPDATE teacher_payments
          SET status = CASE WHEN total_amount > 0 THEN 'paid'::payment_status
                            ELSE 'unpaid'::payment_status END,
              updated_at = now()
        WHERE archived_at IS NOT NULL AND status = 'calculated'
        RETURNING status::text AS statut`
    );
    await c.query("COMMIT");
    const payes = res.rows.filter((r) => r.statut === "paid").length;
    console.log(`\ncorriges : ${res.rowCount} — payes ${payes}, impayes ${(res.rowCount ?? 0) - payes}`);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  await c.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
