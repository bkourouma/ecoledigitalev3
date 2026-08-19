/**
 * Vérification manuelle : le collecteur écarte-t-il bien, EN BASE, les heures
 * déjà portées à un bulletin ? Les tests unitaires n'inspectent que le SQL
 * produit ; celui-ci le fait exécuter par PostgreSQL sur les données réelles.
 *
 *   npx tsx scripts/verif-heures-consommees.ts
 *
 * Lecture seule : aucune écriture, aucun bulletin créé.
 */
import { readFileSync } from "fs";
import { Client, Pool } from "pg";
import { ProfessionalHourCollector } from "../src/services/hour-collectors/professional-hour-collector";
import { TeacherPayrollOverviewService } from "../src/services/teacher-payroll-overview.service";

const url = (readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m) as string[])[1].trim();
const PERIODE_FICTIVE = "00000000-0000-0000-0000-000000000000";

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();

  const t = await c.query("SELECT id FROM tenants WHERE slug = $1", ["ecoledigitale"]);
  if (t.rows.length === 0) throw new Error("tenant ecoledigitale introuvable");
  const tenantId: string = t.rows[0].id;

  const bornes = await c.query(
    `SELECT min(date)::text AS d, max(date)::text AS f
       FROM professional_ecue_seances WHERE tenant_id = $1`,
    [tenantId]
  );
  const { d, f } = bornes.rows[0];
  console.log(`periode balayee            : ${d} -> ${f}`);

  const payables = await c.query(
    `SELECT count(*)::int n FROM professional_ecue_seances se
      WHERE se.tenant_id = $1 AND se.date BETWEEN $2::date AND $3::date
        AND se.validated_at IS NOT NULL AND se.statut = 'realisee'`,
    [tenantId, d, f]
  );
  console.log(`seances validees (brut)    : ${payables.rows[0].n}`);

  const consommees = await c.query(
    `SELECT count(DISTINCT phd.seance_id)::int n
       FROM payment_hour_details phd
       JOIN teacher_payments tp ON tp.id = phd.payment_id
      WHERE phd.tenant_id = $1 AND phd.seance_id IS NOT NULL AND tp.status <> 'cancelled'`,
    [tenantId]
  );
  console.log(`seances deja consommees    : ${consommees.rows[0].n}`);

  const rows = await new ProfessionalHourCollector().collect(c as never, {
    tenantId,
    periodStart: d,
    periodEnd: f,
    periodId: PERIODE_FICTIVE,
  });
  console.log(`collectees APRES exclusion : ${rows.length}`);

  // La vue d'ensemble porte le MÊME fragment d'exclusion. Sa requête est
  // construite au chargement du module : si le fragment ne s'y intègre pas,
  // c'est ici que PostgreSQL le dira.
  const pool = new Pool({ connectionString: url });
  const res = await new TeacherPayrollOverviewService(pool).listEnseignants(tenantId);
  const data = (res as { data?: { items?: unknown[] } }).data;
  console.log(
    `vue d'ensemble             : ${data?.items?.length ?? "ECHEC"} enseignant(s), requete acceptee`
  );
  await pool.end();

  await c.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
