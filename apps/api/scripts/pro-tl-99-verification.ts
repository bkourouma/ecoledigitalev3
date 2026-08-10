/**
 * VÉRIFICATION FINALE — interroge les services exactement comme le font les
 * pages du module professionnel, pour confirmer que chaque écran affichera bien
 * des données pour M1TL et M2TL.
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-99-verification.ts
 */
import { ProfessionalBulletinService } from "../src/services/professional-bulletin.service";
import { ProfessionalDiplomasService } from "../src/services/professional-diplomas.service";
import { ProfessionalEmploiTempsService } from "../src/services/professional-emploi-temps.service";
import { ProfessionalPlanningService } from "../src/services/professional-planning.service";
import { ProfessionalUeService } from "../src/services/professional-ue.service";
import {
  FILIERES,
  getAdminUserId,
  getFiliere,
  getSemestres,
  getTenantId,
  log,
  makePool,
} from "./pro-tl-common";

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const adminId = await getAdminUserId(pool, tenantId);
  const scope = { isAdmin: true, userId: adminId ?? "" };

  const ueSvc = new ProfessionalUeService(pool as any);
  const bulletinSvc = new ProfessionalBulletinService(pool as any);
  const emploiSvc = new ProfessionalEmploiTempsService(pool as any);
  const planningSvc = new ProfessionalPlanningService(pool as any);
  const diplomaSvc = new ProfessionalDiplomasService(pool as any);

  try {
    log("################ VOLUMÉTRIE EN BASE ################\n");
    const vol = await pool.query(
      `WITH s AS (
         SELECT ps.id, p.code AS filiere
         FROM professional_ue_sessions ps
         JOIN professional_ue ue ON ue.id = ps.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         WHERE ps.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       )
       SELECT
         (SELECT count(*) FROM s)                                                      AS sessions,
         (SELECT count(*) FROM professional_enrollments e WHERE e.ue_session_id IN (SELECT id FROM s)) AS inscriptions,
         (SELECT count(DISTINCT e.order_id) FROM professional_enrollments e WHERE e.ue_session_id IN (SELECT id FROM s)) AS commandes,
         (SELECT count(*) FROM professional_payments pay WHERE pay.order_id IN
            (SELECT DISTINCT order_id FROM professional_enrollments WHERE ue_session_id IN (SELECT id FROM s))) AS paiements,
         (SELECT count(*) FROM professional_emploi_temps et WHERE et.ue_session_id IN (SELECT id FROM s)) AS creneaux,
         (SELECT count(*) FROM professional_course_plannings cp WHERE cp.ue_session_id IN (SELECT id FROM s)) AS cours_planifies,
         (SELECT count(*) FROM professional_ecue_seances se WHERE se.ue_session_id IN (SELECT id FROM s)) AS seances,
         (SELECT count(*) FROM professional_ecue_attendance a WHERE a.seance_id IN
            (SELECT id FROM professional_ecue_seances WHERE ue_session_id IN (SELECT id FROM s))) AS appels,
         (SELECT count(*) FROM professional_ecue_notes n WHERE n.ue_session_id IN (SELECT id FROM s)) AS notes,
         (SELECT count(*) FROM professional_ecue_results r WHERE r.ue_session_id IN (SELECT id FROM s)) AS resultats_ecue,
         (SELECT count(*) FROM professional_bulletins b
            JOIN professional_semestres sm ON sm.id = b.semestre_id
            JOIN programmes p2 ON p2.id = sm.filiere_id
            WHERE b.tenant_id = $1 AND p2.code IN ('M1TL','M2TL'))                      AS bulletins,
         (SELECT count(*) FROM professional_student_matricules m
            JOIN programmes p3 ON p3.id = m.filiere_id
            WHERE m.tenant_id = $1 AND p3.code IN ('M1TL','M2TL'))                      AS matricules_ipam,
         (SELECT count(*) FROM student_professional_diplomas spd
            JOIN professional_diplomas d ON d.id = spd.diploma_id
            WHERE spd.tenant_id = $1 AND d.code = 'DIP-MTL')                            AS diplomes,
         (SELECT count(*) FROM classrooms WHERE tenant_id = $1 AND code LIKE 'TL-%')     AS salles_tl`,
      [tenantId]
    );
    const v = vol.rows[0];
    Object.entries(v).forEach(([k, n]) => log(`  ${k.padEnd(18)} ${String(n).padStart(6)}`));

    log("\n################ CE QUE VERRONT LES PAGES ################");

    for (const f of FILIERES) {
      const filiere = await getFiliere(pool, tenantId, f.code);
      const sems = await getSemestres(pool, tenantId, filiere.id);
      log(`\n=== ${filiere.code} ===`);

      // Page Présences
      const presences = await ueSvc.getPresencesHistory(tenantId, filiere.id);
      if (presences.success) {
        const d: any = presences.data;
        const seances = d.seances ?? d.items ?? [];
        const recap = d.recapitulatif ?? d.students ?? [];
        log(`  Présences   : ${seances.length} séances, ${recap.length} lignes de récapitulatif étudiant`);
        if (recap[0]) {
          const r = recap[0];
          log(`                ex. ${r.nom_complet ?? r.nom ?? "?"} → ${JSON.stringify(r).slice(0, 150)}`);
        }
      } else log(`  Présences   : ÉCHEC ${presences.error} ${presences.message}`);

      // Page Planning (emploi du temps)
      const filEt = await emploiSvc.listFilieresWithEmploiTemps(tenantId);
      const presentDansListe =
        filEt.success && (filEt.data as any[]).some((x: any) => x.id === filiere.id || x.code === f.code);
      log(`  Planning    : filière listée = ${presentDansListe}`);
      for (const s of sems) {
        const et = await emploiSvc.getEmploiTemps(tenantId, s.id);
        const n = et.success ? ((et.data as any).slots ?? (et.data as any).items ?? et.data ?? []).length : -1;
        log(`                ${s.libelle} → ${n} créneaux`);
      }

      // Calendrier des cours planifiés
      const pl = await planningSvc.listPlannings(tenantId, scope, {});
      if (pl.success) {
        const mine = (pl.data as any[]).filter((x: any) => String(x.ue_code ?? "").startsWith(f.code));
        log(`  Cours datés : ${mine.length} pour ${f.code}`);
      }

      // Page Bulletins
      for (const s of sems) {
        const full = await bulletinSvc.listFullBulletins(tenantId, s.id);
        if (full.success) {
          const arr = (full.data as any).bulletins ?? (full.data as any) ?? [];
          const avecRang = arr.filter((b: any) => b.rang != null).length;
          log(`  Bulletins   : ${s.libelle} → ${arr.length} bulletins (${avecRang} avec rang calculé)`);
        } else log(`  Bulletins   : ${s.libelle} ÉCHEC ${full.error}`);
      }
    }

    // Page Diplômes
    log(`\n=== Diplômes (cycle) ===`);
    const m2 = await getFiliere(pool, tenantId, "M2TL");
    const dl = await diplomaSvc.list(tenantId, {} as any);
    if (dl.success) {
      const mtl = (dl.data as any[]).find((d: any) => d.code === "DIP-MTL");
      if (mtl) {
        log(`  ${mtl.code} — ${mtl.libelle} | ${mtl.uv_required} UV | ${mtl.statut}`);
        const aw = await diplomaSvc.listAwarded(tenantId, mtl.id, undefined as any);
        const cd = await diplomaSvc.listCandidates(tenantId, mtl.id);
        log(`  Octroyés : ${aw.success ? (aw.data as any[]).length : "?"} | Candidats : ${cd.success ? (cd.data as any[]).length : "?"}`);
      } else log(`  ! DIP-MTL absent de la liste`);
    }

    // Diplômés avec leurs noms (la liste du service ne renvoie que les ids).
    const noms = await pool.query(
      `SELECT spd.reference, sp.student_matricule, psm.matricule AS ipam,
              u.first_name || ' ' || u.last_name AS nom, spd.uv_total_validees AS uv
       FROM student_professional_diplomas spd
       JOIN professional_diplomas d ON d.id = spd.diploma_id
       JOIN student_profiles sp ON sp.id = spd.student_id
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN professional_student_matricules psm
         ON psm.student_id = sp.id AND psm.filiere_id = $2
       WHERE spd.tenant_id = $1 AND d.code = 'DIP-MTL' AND spd.statut = 'obtenu'
       ORDER BY spd.reference`,
      [tenantId, m2.id]
    );
    log(`\n=== Diplômés Master Transport-Logistique (${noms.rowCount}) ===`);
    noms.rows.forEach((r: any) =>
      log(`  ${r.reference}  ${String(r.ipam ?? "").padEnd(12)} ${String(r.nom).padEnd(22)} ${r.uv} UV`)
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
