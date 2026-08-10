/**
 * ÉTAPE 5 — Affectation des enseignants + PLANNING (page /professionnel/admin/planning).
 *
 * Trois écritures, dans l'ordre des dépendances :
 *
 *  1. `professional_session_ecue_teachers` — un enseignant par (session, ECUE).
 *     Obligatoire avant le planning : le service Planning lit l'enseignant
 *     affecté pour le reporter sur le cours. La « Conduite » n'en reçoit jamais
 *     (note de semestre, sans cours) — même règle que le service Semestre.
 *
 *  2. `professional_emploi_temps` — emploi du temps HEBDOMADAIRE (jour + créneau
 *     + salle), via `ProfessionalEmploiTempsService.createSlot()`. C'est ce que
 *     la page Planning affiche et exporte en DOCX.
 *
 *  3. `professional_course_plannings` — les séances DATÉES déduites de l'emploi
 *     du temps (une par occurrence hebdomadaire de la période), via
 *     `ProfessionalPlanningService.createPlanning()`. Alimente le calendrier et
 *     la vue enseignant.
 *
 * Idempotent : ne réécrit rien si l'emploi du temps de la filière existe déjà.
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-05-planning.ts
 */
import { ProfessionalEmploiTempsService } from "../src/services/professional-emploi-temps.service";
import { ProfessionalPlanningService } from "../src/services/professional-planning.service";
import {
  FILIERES,
  datesForWeekday,
  getAdminUserId,
  getFiliere,
  getSessionEcues,
  getSessions,
  getTenantId,
  log,
  makePool,
} from "./pro-tl-common";

/** 6 créneaux hebdomadaires : lundi → mercredi, matin et après-midi. */
const CRENEAUX = [
  { jour: 1, debut: "08:00", fin: "11:00" },
  { jour: 1, debut: "13:30", fin: "16:30" },
  { jour: 2, debut: "08:00", fin: "11:00" },
  { jour: 2, debut: "13:30", fin: "16:30" },
  { jour: 3, debut: "08:00", fin: "11:00" },
  { jour: 3, debut: "13:30", fin: "16:30" },
];

const SALLES_PREF = ["TL-AMPHI-A", "TL-101", "TL-102", "TL-INFO-1", "TL-INFO-2", "TL-ATELIER"];

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const adminId = await getAdminUserId(pool, tenantId);
  const emploi = new ProfessionalEmploiTempsService(pool as any);
  const planning = new ProfessionalPlanningService(pool as any);
  const scope = { isAdmin: true, userId: adminId ?? "" };

  try {
    const teachersRes = await pool.query(
      `SELECT te.id, u.first_name, u.last_name FROM teachers te
       JOIN users u ON u.id = te.user_id WHERE te.tenant_id = $1 ORDER BY u.last_name, u.first_name`,
      [tenantId]
    );
    const teachers = teachersRes.rows as Array<{ id: string; first_name: string; last_name: string }>;
    if (teachers.length === 0) throw new Error("Aucun enseignant en base.");

    const sallesRes = await pool.query(
      `SELECT id, code FROM classrooms WHERE tenant_id = $1 AND code = ANY($2::text[])`,
      [tenantId, SALLES_PREF]
    );
    const salleByCode = new Map<string, string>(sallesRes.rows.map((r: any) => [r.code, r.id]));
    const salles = SALLES_PREF.map((c) => salleByCode.get(c)).filter(Boolean) as string[];
    if (salles.length === 0) throw new Error("Salles TL introuvables — lancez l'étape 2.");

    for (const f of FILIERES) {
      const filiere = await getFiliere(pool, tenantId, f.code);
      log(`\n=== ${filiere.code} ===`);

      const dejaFait = await pool.query(
        `SELECT count(*)::int AS n FROM professional_emploi_temps et
         JOIN professional_ue_sessions s ON s.id = et.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         WHERE et.tenant_id = $1 AND ue.filiere_id = $2`,
        [tenantId, filiere.id]
      );
      if (dejaFait.rows[0].n > 0) {
        log(`  = emploi du temps déjà présent (${dejaFait.rows[0].n} créneaux) — étape ignorée.`);
        continue;
      }

      const sessions = await getSessions(pool, tenantId, filiere.id);
      let affectations = 0;
      let creneaux = 0;
      let seances = 0;
      let conduiteSkipped = 0;

      // Un enseignant STABLE par ECUE de la filière (même prof sur tout le cursus).
      const teacherByEcue = new Map<string, string>();

      for (const sem of [1, 2, 3]) {
        const semSessions = sessions.filter((s) => s.semestre_numero === sem);
        // Index de créneau par semestre : les ECUE ne se chevauchent pas.
        let slotIndex = 0;

        for (const s of semSessions) {
          const ecues = await getSessionEcues(pool, tenantId, s.id);
          for (const e of ecues) {
            if (e.is_conduite) {
              conduiteSkipped++;
              continue;
            }

            // 1. Enseignant affecté à l'ECUE dans cette session.
            if (!teacherByEcue.has(e.id)) {
              teacherByEcue.set(e.id, teachers[teacherByEcue.size % teachers.length].id);
            }
            const enseignantId = teacherByEcue.get(e.id)!;
            await pool.query(
              `INSERT INTO professional_session_ecue_teachers
                 (tenant_id, ue_session_id, ecue_id, enseignant_id)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (tenant_id, ue_session_id, ecue_id)
               DO UPDATE SET enseignant_id = EXCLUDED.enseignant_id, updated_at = now()`,
              [tenantId, s.id, e.id, enseignantId]
            );
            affectations++;

            // 2. Créneau hebdomadaire.
            const cr = CRENEAUX[slotIndex % CRENEAUX.length];
            const salleId = salles[slotIndex % salles.length];
            slotIndex++;

            const slot = await emploi.createSlot(
              tenantId,
              {
                ue_session_id: s.id,
                ecue_id: e.id,
                enseignant_id: enseignantId,
                classroom_id: salleId,
                jour: cr.jour,
                heure_debut: cr.debut,
                heure_fin: cr.fin,
                date_debut: s.date_debut,
                date_fin: s.date_fin,
              } as any,
              adminId ?? undefined
            );
            if (!slot.success) throw new Error(`createSlot ${e.code}: ${slot.error} ${slot.message}`);
            creneaux++;

            // 3. Séances datées déduites du créneau.
            const dates = datesForWeekday(s.date_debut, s.date_fin, cr.jour);
            let n = 0;
            for (const d of dates) {
              n++;
              const p = await planning.createPlanning(
                tenantId,
                {
                  ue_session_id: s.id,
                  ecue_id: e.id,
                  titre: `Cours ${n} — ${e.libelle}`,
                  date: d,
                  heure_debut: cr.debut,
                  heure_fin: cr.fin,
                } as any,
                scope
              );
              if (!p.success) throw new Error(`createPlanning ${e.code} ${d}: ${p.error} ${p.message}`);
              seances++;
            }
          }
        }
      }

      log(`  + ${affectations} affectations enseignant↔ECUE`);
      log(`  + ${creneaux} créneaux hebdomadaires (emploi du temps)`);
      log(`  + ${seances} séances datées (planning des cours)`);
      log(`  = ${conduiteSkipped} ECUE « Conduite » exclues (note de semestre, sans cours)`);
    }

    log(`\n=== Vérification ===`);
    const recap = await pool.query(
      `SELECT p.code,
              count(DISTINCT t.id)::int AS affectations,
              count(DISTINCT et.id)::int AS creneaux,
              count(DISTINCT cp.id)::int AS seances,
              count(DISTINCT et.enseignant_id)::int AS profs,
              count(DISTINCT et.classroom_id)::int AS salles
       FROM programmes p
       JOIN professional_ue ue ON ue.filiere_id = p.id
       JOIN professional_ue_sessions s ON s.ue_id = ue.id
       LEFT JOIN professional_session_ecue_teachers t ON t.ue_session_id = s.id
       LEFT JOIN professional_emploi_temps et ON et.ue_session_id = s.id
       LEFT JOIN professional_course_plannings cp ON cp.ue_session_id = s.id
       WHERE p.code IN ('M1TL','M2TL') AND p.tenant_id = $1
       GROUP BY p.code ORDER BY p.code`,
      [tenantId]
    );
    recap.rows.forEach((r: any) =>
      log(
        `  ${r.code}: ${r.affectations} affectations | ${r.creneaux} créneaux | ${r.seances} séances | ${r.profs} enseignants | ${r.salles} salles`
      )
    );

    const exemple = await pool.query(
      `SELECT et.jour, et.heure_debut::text AS hd, et.heure_fin::text AS hf,
              e.code AS ecue, c.code AS salle, u.first_name, u.last_name
       FROM professional_emploi_temps et
       JOIN professional_ecue e ON e.id = et.ecue_id
       JOIN professional_ue_sessions s ON s.id = et.ue_session_id
       JOIN professional_ue ue ON ue.id = s.ue_id
       JOIN programmes p ON p.id = ue.filiere_id
       LEFT JOIN classrooms c ON c.id = et.classroom_id
       LEFT JOIN teachers te ON te.id = et.enseignant_id
       LEFT JOIN users u ON u.id = te.user_id
       WHERE et.tenant_id = $1 AND p.code = 'M1TL' AND s.date_debut = '2024-10-07'
       ORDER BY et.jour, et.heure_debut`,
      [tenantId]
    );
    const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    log(`\nEmploi du temps M1TL Semestre 1 :`);
    exemple.rows.forEach((r: any) =>
      log(
        `  ${JOURS[r.jour].padEnd(9)} ${r.hd.slice(0, 5)}-${r.hf.slice(0, 5)}  ${String(r.ecue).padEnd(16)} ${String(r.salle ?? "—").padEnd(11)} ${r.first_name ?? ""} ${r.last_name ?? ""}`
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
