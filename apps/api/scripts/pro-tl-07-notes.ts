/**
 * ÉTAPE 7 — Notes (page /professionnel/admin/notes).
 *
 * Saisit, via `ProfessionalResultsService.upsertManualEcueNote()` :
 *   - pour chaque ECUE de matière : 2 DEVOIRS + 1 EXAMEN par étudiant ;
 *   - pour chaque ECUE « Conduite » : une note unique de semestre (nature
 *     « examen », conformément au modèle : la conduite n'a pas de devoirs).
 *
 * Le service recalcule automatiquement, à chaque note :
 *   - `professional_ecue_results`  → note ECUE = devoirs×0,4 + examen×0,6 ;
 *   - `student_professional_ue_results` → validation de l'UE (compensation par
 *     les crédits, verrou éliminatoire si une ECUE < 5) et UV acquises.
 *   Formules dans apps/api/src/services/bulletin-calc.ts.
 *
 * Profils de la cohorte (déterministes, graine fixe) : 17 étudiants solides,
 * 2 limites et 1 en difficulté — afin que les listes « candidats » et
 * « diplômés » ne soient pas toutes identiques.
 *
 * Idempotent : ne fait rien si des notes existent déjà pour la filière (les
 * devoirs ne sont pas dédupliqués côté base, une relance les doublerait).
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-07-notes.ts
 */
import { ProfessionalResultsService } from "../src/services/professional-results.service";
import {
  FILIERES,
  getAdminUserId,
  getCohorte,
  getFiliere,
  getSessionEcues,
  getSessions,
  getTenantId,
  log,
  makePool,
  makeRng,
} from "./pro-tl-common";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const arrondi = (x: number) => Math.round(x * 4) / 4; // pas de 0,25 comme en saisie réelle

/** Niveau de base /20 de chaque étudiant, par rang dans la cohorte. */
function niveauDeBase(rang: number): number {
  if (rang === 19) return 8.4; // en difficulté → n'obtiendra pas le diplôme
  if (rang === 17 || rang === 18) return 10.1; // limites → quelques UE non validées
  // 17 étudiants solides, répartis de 11,2 à 16,4.
  return 11.2 + (rang % 17) * 0.32;
}

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);
  const adminId = await getAdminUserId(pool, tenantId);
  const results = new ProfessionalResultsService(pool as any);

  try {
    const cohorte = await getCohorte(pool, tenantId);
    const baseByStudent = new Map<string, number>();
    cohorte.forEach((s, i) => baseByStudent.set(s.id, niveauDeBase(i)));

    for (const f of FILIERES) {
      const filiere = await getFiliere(pool, tenantId, f.code);
      log(`\n=== ${filiere.code} ===`);

      const deja = await pool.query(
        `SELECT count(*)::int AS n FROM professional_ecue_notes n
         JOIN professional_ue_sessions s ON s.id = n.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         WHERE n.tenant_id = $1 AND ue.filiere_id = $2`,
        [tenantId, filiere.id]
      );
      if (deja.rows[0].n > 0) {
        log(`  = ${deja.rows[0].n} note(s) déjà saisie(s) — étape ignorée.`);
        continue;
      }

      const sessions = await getSessions(pool, tenantId, filiere.id);
      const rng = makeRng(f.code === "M1TL" ? 770001 : 880002);
      let devoirs = 0;
      let examens = 0;
      let conduites = 0;

      for (const s of sessions) {
        const ecues = await getSessionEcues(pool, tenantId, s.id);
        const inscrits = await pool.query(
          `SELECT student_id FROM professional_enrollments
           WHERE tenant_id = $1 AND ue_session_id = $2 AND statut IN ('confirmee','terminee')`,
          [tenantId, s.id]
        );

        for (const e of ecues) {
          for (const row of inscrits.rows) {
            const sid = row.student_id as string;
            const base = baseByStudent.get(sid) ?? 12;

            if (e.is_conduite) {
              // Conduite : note de semestre unique, plutôt généreuse.
              const note = arrondi(clamp(base + 2.5 + (rng() - 0.5) * 2, 8, 20));
              const r = await results.upsertManualEcueNote(
                tenantId,
                {
                  ecue_id: e.id,
                  student_id: sid,
                  ue_session_id: s.id,
                  nature: "examen",
                  libelle: `Conduite — ${s.libelle}`,
                  note,
                  note_max: 20,
                  session: 1,
                },
                adminId ?? undefined
              );
              if (!r.success) throw new Error(`conduite ${e.code}: ${r.error} ${r.message}`);
              conduites++;
              continue;
            }

            // 2 devoirs (contrôle continu, 40 %).
            for (let d = 1; d <= 2; d++) {
              const note = arrondi(clamp(base + (rng() - 0.4) * 4, 4, 20));
              const r = await results.upsertManualEcueNote(
                tenantId,
                {
                  ecue_id: e.id,
                  student_id: sid,
                  ue_session_id: s.id,
                  nature: "devoir",
                  libelle: `Devoir ${d}`,
                  note,
                  note_max: 20,
                  session: 1,
                },
                adminId ?? undefined
              );
              if (!r.success) throw new Error(`devoir ${e.code}: ${r.error} ${r.message}`);
              devoirs++;
            }

            // Examen final (60 %).
            const noteEx = arrondi(clamp(base + (rng() - 0.45) * 4.5, 3, 20));
            const rx = await results.upsertManualEcueNote(
              tenantId,
              {
                ecue_id: e.id,
                student_id: sid,
                ue_session_id: s.id,
                nature: "examen",
                libelle: "Examen final",
                note: noteEx,
                note_max: 20,
                session: 1,
              },
              adminId ?? undefined
            );
            if (!rx.success) throw new Error(`examen ${e.code}: ${rx.error} ${rx.message}`);
            examens++;
          }
        }
        log(`  ${s.libelle} traitée`);
      }
      log(`  + ${devoirs} devoirs, ${examens} examens, ${conduites} notes de conduite`);
    }

    log(`\n=== Résultats calculés par le moteur ===`);
    const recap = await pool.query(
      `SELECT p.code,
              count(*)::int AS ecue_results,
              count(*) FILTER (WHERE r.validee)::int AS validees,
              count(*) FILTER (WHERE r.eliminee)::int AS eliminatoires,
              round(avg(r.moyenne)::numeric, 2) AS moyenne_generale
       FROM professional_ecue_results r
       JOIN professional_ue_sessions s ON s.id = r.ue_session_id
       JOIN professional_ue ue ON ue.id = s.ue_id
       JOIN programmes p ON p.id = ue.filiere_id
       WHERE r.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       GROUP BY p.code ORDER BY p.code`,
      [tenantId]
    );
    recap.rows.forEach((r: any) =>
      log(
        `  ${r.code}: ${r.ecue_results} résultats ECUE | ${r.validees} validés | ${r.eliminatoires} éliminatoires | moyenne ${r.moyenne_generale}/20`
      )
    );

    const ue = await pool.query(
      `SELECT p.code, r.statut, count(*)::int AS n, sum(r.uv_acquises)::int AS uv
       FROM student_professional_ue_results r
       JOIN professional_ue ue ON ue.id = r.ue_id
       JOIN programmes p ON p.id = ue.filiere_id
       WHERE r.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       GROUP BY p.code, r.statut ORDER BY p.code, r.statut`,
      [tenantId]
    );
    log(`\n=== Validation des UE ===`);
    ue.rows.forEach((r: any) => log(`  ${r.code} ${r.statut}: ${r.n} UE (${r.uv} UV acquises)`));

    const parEtudiant = await pool.query(
      `SELECT sp.student_matricule, u.first_name, u.last_name,
              sum(r.uv_acquises)::int AS uv,
              count(*) FILTER (WHERE r.statut = 'validee')::int AS ue_ok,
              count(*)::int AS ue_total
       FROM student_professional_ue_results r
       JOIN professional_ue ue ON ue.id = r.ue_id
       JOIN programmes p ON p.id = ue.filiere_id
       JOIN student_profiles sp ON sp.id = r.student_id
       JOIN users u ON u.id = sp.user_id
       WHERE r.tenant_id = $1 AND p.code IN ('M1TL','M2TL')
       GROUP BY sp.student_matricule, u.first_name, u.last_name
       ORDER BY uv DESC`,
      [tenantId]
    );
    log(`\n=== UV par étudiant (M1TL + M2TL, 120 UV au total) ===`);
    parEtudiant.rows.forEach((r: any) =>
      log(`  ${r.student_matricule} ${String(r.first_name + " " + r.last_name).padEnd(22)} ${String(r.uv).padStart(3)} UV | ${r.ue_ok}/${r.ue_total} UE validées`)
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
