/**
 * Rattrapage : séances qui portent un appel mais sont restées « planifiée ».
 *
 * Ce sont les victimes du chemin enseignant qui ne basculait pas le statut
 * (corrigé par `professional-seance-constat.ts`). Le correctif ne vaut que
 * pour les appels à venir ; celles déjà saisies restent à reprendre.
 *
 *   npx tsx scripts/rattraper-seances-appelees.ts              # simulation
 *   npx tsx scripts/rattraper-seances-appelees.ts --appliquer  # écrit
 *
 * La simulation est le défaut : elle liste les séances concernées et n'écrit
 * rien. Les identifiants affichés permettent de revenir en arrière au besoin.
 *
 * Ce script NE VALIDE RIEN : `validated_at` n'est pas touché, aucune séance ne
 * devient payable de ce seul fait. Engager la dépense reste un acte distinct.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";

const ICI = __dirname;
const url = (
  readFileSync(resolve(ICI, "../.env"), "utf8").match(/^DATABASE_URL=(.*)$/m) as string[]
)[1].trim();
const APPLIQUER = process.argv.includes("--appliquer");

const CIBLES = `
  FROM professional_ecue_seances se
 WHERE se.statut = 'planifiee'
   AND EXISTS (SELECT 1 FROM professional_ecue_attendance a
                WHERE a.seance_id = se.id AND a.tenant_id = se.tenant_id)`;

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();

  const cibles = await c.query(
    `SELECT se.id, se.date::text AS date, se.enseignant_id ${CIBLES} ORDER BY se.date`
  );
  console.log(`seances appelees mais planifiees : ${cibles.rowCount}`);
  for (const r of cibles.rows) console.log(`  ${r.date}  ${r.id}`);

  if (!APPLIQUER) {
    console.log("\nsimulation — rien n'a ete ecrit. Relancer avec --appliquer pour corriger.");
    await c.end();
    return;
  }

  await c.query("BEGIN");
  try {
    const res = await c.query(
      `UPDATE professional_ecue_seances se
          SET statut = 'realisee', statut_modifie_le = now(), updated_at = now()
        WHERE se.id IN (SELECT se2.id FROM professional_ecue_seances se2
                         WHERE se2.statut = 'planifiee'
                           AND EXISTS (SELECT 1 FROM professional_ecue_attendance a
                                        WHERE a.seance_id = se2.id
                                          AND a.tenant_id = se2.tenant_id))`
    );
    await c.query("COMMIT");
    console.log(`\nbascules en realisee : ${res.rowCount}`);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  await c.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
