/**
 * ÉTAPE 1 — Sessions (cohortes) de M1TL et M2TL.
 *
 * Crée UNE session par UE de CHAQUE semestre des deux filières, rattachée au
 * semestre, via `ProfessionalSemestreService.createSessionsBySemestre()` — la
 * même méthode que la page /professionnel/admin/sessions.
 *
 * Statut « ouvert » : requis pour planifier des cours (le service Planning
 * refuse toute session non ouverte) et pour saisir notes et présences.
 * `capacite_max` laissé à NULL pour que la session ne bascule jamais
 * automatiquement en « complet » / « ferme ».
 *
 * Idempotent : ne fait rien si des sessions existent déjà pour la filière.
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-01-sessions.ts
 */
import { ProfessionalSemestreService } from "../src/services/professional-semestre.service";
import {
  CALENDRIER,
  FILIERES,
  getFiliere,
  getSemestres,
  getTenantId,
  log,
  makePool,
  must,
} from "./pro-tl-common";

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const semestres = new ProfessionalSemestreService(pool as any);

  try {
    for (const f of FILIERES) {
      const filiere = await getFiliere(pool, tenantId, f.code);
      log(`\n=== ${filiere.code} — ${filiere.name} ===`);

      const existing = await pool.query(
        `SELECT count(*)::int AS n FROM professional_ue_sessions s
         JOIN professional_ue ue ON ue.id = s.ue_id
         WHERE s.tenant_id = $1 AND ue.filiere_id = $2`,
        [tenantId, filiere.id]
      );
      if (existing.rows[0].n > 0) {
        log(`  = ${existing.rows[0].n} session(s) déjà présente(s) — étape ignorée.`);
        continue;
      }

      const sems = await getSemestres(pool, tenantId, filiere.id);
      const blocks = sems.map((s) => {
        const p = CALENDRIER[f.code][s.numero];
        if (!p) throw new Error(`Aucune période au calendrier pour ${f.code} ${s.libelle}.`);
        return {
          semestre_id: s.id,
          libelle: `${f.code} ${s.libelle}`,
          date_debut: p.debut,
          date_fin: p.fin,
          inscription_ouverte_le: `${p.inscOuvre}T08:00:00.000Z`,
          inscription_fermee_le: `${p.inscFerme}T23:59:00.000Z`,
          capacite_max: null,
          statut: "ouvert",
        };
      });

      const res = must(
        await semestres.createSessionsBySemestre(tenantId, {
          filiere_id: filiere.id,
          blocks,
        } as any),
        `createSessionsBySemestre ${f.code}`
      ) as any;
      log(`  + ${res.sessions_created} session(s) créée(s) sur ${res.semestres} semestre(s).`);

      const listed = await pool.query(
        `SELECT s.libelle, s.statut, s.date_debut::text AS d, s.date_fin::text AS f
         FROM professional_ue_sessions s
         JOIN professional_ue ue ON ue.id = s.ue_id
         WHERE s.tenant_id = $1 AND ue.filiere_id = $2
         ORDER BY s.date_debut, s.libelle`,
        [tenantId, filiere.id]
      );
      listed.rows.forEach((r: any) => log(`      ${r.libelle} | ${r.d} → ${r.f} | ${r.statut}`));
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
