/**
 * Vérifie que le bulletin porte bien le MODE DE RÉMUNÉRATION de l'enseignant,
 * et qu'il ne le confond plus avec l'état du versement.
 *
 *   npx tsx scripts/verif-bulletin-mode.ts
 *
 * Rend le HTML du document (sans passer par Puppeteer, inutile ici) pour un
 * bulletin de chaque mode présent en base, puis contrôle les libellés.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { Pool } from "pg";
import { TeacherPayslipService } from "../src/services/teacher-payslip.service";
import { buildPayslipHtml } from "../src/services/teacher-payslip-template.service";

const ICI = __dirname;
const url = (
  readFileSync(resolve(ICI, "../.env"), "utf8").match(/^DATABASE_URL=(.*)$/m) as string[]
)[1].trim();

(async () => {
  const pool = new Pool({ connectionString: url });
  const service = new TeacherPayslipService(pool as never);

  const t = await pool.query("SELECT id FROM tenants WHERE slug = $1", ["ecoledigitale"]);
  const tenantId: string = t.rows[0].id;

  // Un bulletin par mode de rémunération réellement présent.
  const echantillon = await pool.query(
    `SELECT DISTINCT ON (tp.payment_type) tp.id, tp.payment_type::text AS mode, tp.status::text AS statut
       FROM teacher_payments tp
      WHERE tp.tenant_id = $1
      ORDER BY tp.payment_type, tp.calculated_at DESC`,
    [tenantId]
  );

  for (const row of echantillon.rows) {
    // `getPayslipData` renvoie un ServiceResult : c'est `.data` qui porte le
    // document.
    const resultat = (await service.getPayslipData(tenantId, row.id)) as {
      data?: unknown;
      error?: string;
    };
    if (!resultat.data) {
      console.log(`bulletin ${row.id.slice(0, 8)} : ECHEC — ${resultat.error ?? "sans donnees"}`);
      continue;
    }
    const html = buildPayslipHtml(resultat.data as never);

    const attendu: Record<string, string> = {
      salary: "Salaire fixe",
      hourly: "Rémunération horaire",
      mixed: "Rémunération mixte",
    };
    const modeAffiche = attendu[row.mode] ?? row.mode;

    console.log(`mode « ${row.mode} » (statut ${row.statut}) — bulletin ${row.id.slice(0, 8)}`);
    console.log(`   libelle « Mode de rémunération » present : ${html.includes("Mode de rémunération")}`);
    console.log(`   valeur « ${modeAffiche} » presente       : ${html.includes(modeAffiche)}`);
    console.log(`   ancien libelle « >Statut<» absent        : ${!html.includes(">Statut<")}`);
    console.log(`   « État du versement » toujours present   : ${html.includes("État du versement")}`);
    console.log(`   aucun statut anglais brut                : ${!/>(unpaid|calculated|paid)</.test(html)}`);
  }

  await pool.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
