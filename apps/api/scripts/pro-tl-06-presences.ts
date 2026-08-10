/**
 * ÉTAPE 6 — Présences (page /professionnel/admin/presences).
 *
 * Deux écritures via `ProfessionalUeService` :
 *   1. `createSeance()`   → une SÉANCE par occurrence hebdomadaire de chaque
 *      ECUE (miroir exact du planning de l'étape 5 : même date, même créneau,
 *      même enseignant, même salle).
 *   2. `markSeanceAttendance()` → la feuille d'appel de chaque séance, pour les
 *      20 étudiants inscrits (statut present / absent / retard / excuse).
 *
 * La « Conduite » est exclue : elle n'a pas de cours, donc pas d'appel.
 *
 * Le tirage est DÉTERMINISTE (générateur à graine fixe) : relancer le script
 * après purge reproduit exactement les mêmes présences. Deux étudiants de la
 * cohorte sont volontairement plus absentéistes, pour que les statistiques et
 * les alertes d'assiduité aient de quoi s'afficher.
 *
 * Idempotent : ne fait rien si des séances existent déjà pour la filière.
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-06-presences.ts
 */
import { ProfessionalUeService } from "../src/services/professional-ue.service";
import {
  FILIERES,
  getAdminUserId,
  getCohorte,
  getFiliere,
  getSessions,
  getTenantId,
  log,
  makePool,
  makeRng,
} from "./pro-tl-common";

/** Tire un statut de présence. `absentéiste` → beaucoup plus d'absences. */
function tirerStatut(rng: () => number, absenteiste: boolean): string {
  const x = rng();
  if (absenteiste) {
    if (x < 0.62) return "present";
    if (x < 0.85) return "absent";
    if (x < 0.94) return "retard";
    return "excuse";
  }
  if (x < 0.9) return "present";
  if (x < 0.945) return "absent";
  if (x < 0.98) return "retard";
  return "excuse";
}

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const adminId = await getAdminUserId(pool, tenantId);
  const ueService = new ProfessionalUeService(pool as any);

  try {
    const cohorte = await getCohorte(pool, tenantId);
    // Les 3ᵉ et 12ᵉ étudiants de la cohorte sont les absentéistes.
    const absenteistes = new Set([cohorte[2]?.id, cohorte[11]?.id].filter(Boolean));

    for (const f of FILIERES) {
      const filiere = await getFiliere(pool, tenantId, f.code);
      log(`\n=== ${filiere.code} ===`);

      const deja = await pool.query(
        `SELECT count(*)::int AS n FROM professional_ecue_seances se
         JOIN professional_ue_sessions s ON s.id = se.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         WHERE se.tenant_id = $1 AND ue.filiere_id = $2`,
        [tenantId, filiere.id]
      );
      if (deja.rows[0].n > 0) {
        log(`  = ${deja.rows[0].n} séance(s) déjà présente(s) — étape ignorée.`);
        continue;
      }

      const sessions = await getSessions(pool, tenantId, filiere.id);
      let nbSeances = 0;
      let nbAppels = 0;
      const rng = makeRng(f.code === "M1TL" ? 20240101 : 20250101);

      for (const s of sessions) {
        // Le planning de l'étape 5 est la source de vérité des dates/créneaux.
        const cours = await pool.query(
          `SELECT cp.ecue_id, cp.titre, cp.date::text AS date,
                  cp.heure_debut::text AS hd, cp.heure_fin::text AS hf, cp.enseignant_id,
                  et.classroom_id
           FROM professional_course_plannings cp
           LEFT JOIN professional_emploi_temps et
             ON et.ue_session_id = cp.ue_session_id AND et.ecue_id = cp.ecue_id
                AND et.tenant_id = cp.tenant_id
           WHERE cp.tenant_id = $1 AND cp.ue_session_id = $2
           ORDER BY cp.date, cp.heure_debut`,
          [tenantId, s.id]
        );

        // Étudiants réellement inscrits et confirmés sur CETTE session.
        const inscrits = await pool.query(
          `SELECT student_id FROM professional_enrollments
           WHERE tenant_id = $1 AND ue_session_id = $2 AND statut IN ('confirmee','terminee')`,
          [tenantId, s.id]
        );
        const studentIds = inscrits.rows.map((r: any) => r.student_id as string);

        for (const c of cours.rows) {
          const seance = await ueService.createSeance(tenantId, s.id, {
            ecue_id: c.ecue_id,
            libelle: c.titre,
            date: c.date,
            heure_debut: c.hd,
            heure_fin: c.hf,
            enseignant_id: c.enseignant_id,
            classroom_id: c.classroom_id,
          } as any);
          if (!seance.success) {
            throw new Error(`createSeance ${s.ue_code} ${c.date}: ${seance.error} ${seance.message}`);
          }
          nbSeances++;

          const entries = studentIds.map((sid) => ({
            student_id: sid,
            statut: tirerStatut(rng, absenteistes.has(sid)),
          }));
          const mark = await ueService.markSeanceAttendance(
            tenantId,
            (seance.data as any).id,
            { entries } as any,
            adminId ?? undefined
          );
          if (!mark.success) throw new Error(`markAttendance: ${mark.error} ${mark.message}`);
          nbAppels += entries.length;
        }
        if (cours.rowCount) log(`  ${s.libelle} → ${cours.rowCount} séances`);
      }
      log(`  + ${nbSeances} séances, ${nbAppels} lignes d'appel`);
    }

    log(`\n=== Vérification ===`);
    const recap = await pool.query(
      `SELECT p.code,
              count(DISTINCT se.id)::int AS seances,
              count(a.id)::int AS appels,
              count(*) FILTER (WHERE a.statut = 'present')::int AS presents,
              count(*) FILTER (WHERE a.statut = 'absent')::int AS absents,
              count(*) FILTER (WHERE a.statut = 'retard')::int AS retards,
              count(*) FILTER (WHERE a.statut = 'excuse')::int AS excuses
       FROM professional_ecue_seances se
       JOIN professional_ue_sessions s ON s.id = se.ue_session_id
       JOIN professional_ue ue ON ue.id = s.ue_id
       JOIN programmes p ON p.id = ue.filiere_id
       LEFT JOIN professional_ecue_attendance a ON a.seance_id = se.id
       WHERE se.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       GROUP BY p.code ORDER BY p.code`,
      [tenantId]
    );
    recap.rows.forEach((r: any) => {
      const tx = ((r.presents / r.appels) * 100).toFixed(1);
      log(
        `  ${r.code}: ${r.seances} séances | ${r.appels} appels | présents ${r.presents} (${tx}%) | absents ${r.absents} | retards ${r.retards} | excusés ${r.excuses}`
      );
    });

    const top = await pool.query(
      `SELECT u.first_name, u.last_name, sp.student_matricule,
              count(*) FILTER (WHERE a.statut = 'absent')::int AS absences,
              count(a.id)::int AS total
       FROM professional_ecue_attendance a
       JOIN student_profiles sp ON sp.id = a.student_id
       JOIN users u ON u.id = sp.user_id
       WHERE a.tenant_id = $1
       GROUP BY u.first_name, u.last_name, sp.student_matricule
       ORDER BY absences DESC LIMIT 4`,
      [tenantId]
    );
    log(`\nÉtudiants les plus absents :`);
    top.rows.forEach((r: any) =>
      log(`  ${r.student_matricule} ${r.first_name} ${r.last_name} — ${r.absences}/${r.total} absences`)
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
