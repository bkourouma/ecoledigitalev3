import type { PoolClient } from "pg";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import {
  normaliserNote,
  moyenneDevoirs as calcMoyenneDevoirs,
  noteEcue,
  evaluerUe,
  SEUIL_VALIDATION,
  SEUIL_ELIMINATOIRE,
  type EcueInput,
} from "./bulletin-calc";

/**
 * Service résultats & validation — Module Professionnel (feature 030).
 *
 * Applique les formules officielles de l'établissement :
 *   Note ECUE  = moyenneDevoirs × 0,4 + noteExamen × 0,6
 *   Moyenne UE = Σ(NoteECUE × créditsECUE) / Σ créditsECUE  (compensation +
 *                verrou éliminatoire < 5)
 *
 * Les notes proviennent, au choix et de façon combinable :
 *   - des évaluations (`professional_assignments` + copies notées), réparties
 *     selon leur `type` (examen → note d'examen ; tout le reste → devoirs) ;
 *   - de la saisie manuelle directe par ECUE (`professional_ecue_notes`).
 *
 * Une ECUE est validée si NoteECUE ≥ 10 OU par override manuel (tracé).
 */

export const ECUE_VALIDATION_THRESHOLD = SEUIL_VALIDATION;

/** Exclut la « Conduite » (note, pas une matière) des calculs de moyenne. */
const NOT_CONDUITE = `NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')`;

/**
 * Jointures minimales pour raisonner sur les rattrapages : résultat ECUE `r`,
 * cohorte `s`, UE `u`, ECUE `e`. Partagées par la liste des rattrapages et par
 * ses sélecteurs (filière / semestre), qui doivent voir exactement la même
 * chose : un semestre proposé dans le sélecteur mais vide à l'ouverture serait
 * un bug visible.
 */
const RATTRAPAGE_FROM = `
  FROM professional_ecue_results r
  JOIN professional_ue_sessions s ON s.id = r.ue_session_id AND s.tenant_id = r.tenant_id
  JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
  JOIN professional_ecue e ON e.id = r.ecue_id AND e.tenant_id = r.tenant_id`;

/**
 * Un rattrapage = un résultat ECUE CALCULÉ mais NON validé, porté par une
 * inscription confirmée/terminée, hors ECUE de conduite. Une ECUE sans note
 * (`moyenne IS NULL`) n'en est pas un : l'étudiant n'a pas encore été noté.
 * Suppose les alias de `RATTRAPAGE_FROM` et `$1` = tenant.
 */
const RATTRAPAGE_PREDICATE = `
  COALESCE(r.validee, false) = false
  AND r.moyenne IS NOT NULL
  AND ${NOT_CONDUITE}
  AND EXISTS (SELECT 1 FROM professional_enrollments en
              WHERE en.ue_session_id = s.id AND en.student_id = r.student_id
                AND en.tenant_id = r.tenant_id
                AND en.statut IN ('confirmee','terminee'))`;

/** Restriction enseignant : les ECUE qui lui sont affectées dans la cohorte `s`. */
function teacherEcueFilterSql(param: string): string {
  return `AND r.ecue_id IN (
    SELECT a.ecue_id FROM professional_session_ecue_teachers a
    JOIN teachers t ON t.id = a.enseignant_id
    WHERE a.ue_session_id = s.id AND t.user_id = ${param} AND a.tenant_id = $1)`;
}

/** Rattachement d'une cohorte `s` à un semestre (directement ou via son UE). */
function semestreLinkSql(semestreParam: string, tenantRef = "$1"): string {
  return `(
    s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
             WHERE semestre_id = ${semestreParam} AND tenant_id = ${tenantRef})
    OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                   WHERE semestre_id = ${semestreParam} AND tenant_id = ${tenantRef})
  )`;
}

interface EcueBreakdown {
  moyenneDevoirs: number | null;
  noteExamen: number | null;
  note: number | null;
  eliminee: boolean;
  source: "auto" | "manuel" | "mixte" | "aucune";
  /** Session de la note d'examen retenue (2 = rattrapage). */
  examenSession: number;
}

export class ProfessionalResultsService extends ProfessionalBaseService {
  /* ===================== Recalcul d'une cohorte ====================== */

  /**
   * Recalcule les résultats ECUE de tous les étudiants inscrits (confirmés ou
   * terminés) d'une cohorte, puis réévalue la validation des UE.
   */
  async recomputeSessionResults(
    tenantId: string,
    ueSessionId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const sess = await client.query(
        `SELECT ue_id FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
        [ueSessionId, tenantId]
      );
      if (sess.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Cohorte introuvable.");
      const ueId = sess.rows[0].ue_id as string;

      const ecueRows = await client.query(
        `SELECT l.ecue_id FROM professional_ue_ecue l
         JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
         WHERE l.ue_id=$1 AND l.tenant_id=$2 AND ${NOT_CONDUITE}`,
        [ueId, tenantId]
      );
      const students = await client.query(
        `SELECT DISTINCT student_id FROM professional_enrollments
         WHERE ue_session_id=$1 AND tenant_id=$2 AND statut IN ('confirmee','terminee')`,
        [ueSessionId, tenantId]
      );

      let updated = 0;
      for (const s of students.rows) {
        for (const ec of ecueRows.rows) {
          await this.recomputeEcueResult(client, tenantId, ec.ecue_id, s.student_id, ueSessionId);
          updated++;
        }
        await this.evaluateUeValidation(client, tenantId, ueId, s.student_id, ueSessionId);
      }
      return ok({ ue_session_id: ueSessionId, ecue_results_updated: updated });
    });
  }

  /**
   * Recalcule le résultat d'une ECUE pour un étudiant après notation d'une
   * évaluation (auto-capture). Résout la/les cohorte(s) concernée(s).
   */
  async recomputeAfterGrade(
    tenantId: string,
    assignmentId: string,
    studentId: string
  ): Promise<void> {
    await this.withTenantTx(tenantId, async (client) => {
      const a = await client.query(
        `SELECT ecue_id, ue_session_id FROM professional_assignments
         WHERE id=$1 AND tenant_id=$2`,
        [assignmentId, tenantId]
      );
      if (a.rowCount === 0) return;
      const { ecue_id, ue_session_id } = a.rows[0];

      // Cohortes concernées : celle de l'évaluation, sinon toutes celles où
      // l'étudiant est inscrit et dont l'UE porte cette ECUE.
      let sessions: { id: string; ue_id: string }[];
      if (ue_session_id) {
        const s = await client.query(
          `SELECT id, ue_id FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
          [ue_session_id, tenantId]
        );
        sessions = s.rows;
      } else {
        const s = await client.query(
          `SELECT DISTINCT s.id, s.ue_id
           FROM professional_enrollments en
           JOIN professional_ue_sessions s ON s.id = en.ue_session_id
           JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
           WHERE en.student_id=$1 AND en.tenant_id=$2
             AND en.statut IN ('confirmee','terminee') AND l.ecue_id=$3`,
          [studentId, tenantId, ecue_id]
        );
        sessions = s.rows;
      }
      for (const sess of sessions) {
        await this.recomputeEcueResult(client, tenantId, ecue_id, studentId, sess.id);
        await this.evaluateUeValidation(client, tenantId, sess.ue_id, studentId, sess.id);
      }
    });
  }

  /* ==================== Calcul d'une note ECUE ======================= */

  /**
   * Décompose la note d'une ECUE pour un étudiant/cohorte : moyenne des
   * devoirs (évals hors examen + notes manuelles « devoir ») et note d'examen
   * (note manuelle « examen » prioritaire, sinon éval de type examen).
   */
  private async computeEcueBreakdown(
    client: PoolClient,
    tenantId: string,
    ecueId: string,
    studentId: string,
    ueSessionId: string
  ): Promise<EcueBreakdown> {
    // Devoirs issus des évaluations (tout type sauf « examen »).
    const devEval = await client.query(
      `SELECT sub.note::float8 AS note, a.note_max::float8 AS note_max
       FROM professional_assignment_submissions sub
       JOIN professional_assignments a ON a.id = sub.assignment_id
       WHERE a.ecue_id=$1 AND sub.student_id=$2 AND sub.tenant_id=$3
         AND sub.note IS NOT NULL AND a.type <> 'examen'
         AND (a.ue_session_id=$4 OR a.ue_session_id IS NULL)`,
      [ecueId, studentId, tenantId, ueSessionId]
    );
    // Examen issu des évaluations (type = examen) — la plus récemment notée.
    const examEval = await client.query(
      `SELECT sub.note::float8 AS note, a.note_max::float8 AS note_max
       FROM professional_assignment_submissions sub
       JOIN professional_assignments a ON a.id = sub.assignment_id
       WHERE a.ecue_id=$1 AND sub.student_id=$2 AND sub.tenant_id=$3
         AND sub.note IS NOT NULL AND a.type = 'examen'
         AND (a.ue_session_id=$4 OR a.ue_session_id IS NULL)
       ORDER BY sub.graded_at DESC NULLS LAST LIMIT 1`,
      [ecueId, studentId, tenantId, ueSessionId]
    );
    // Notes manuelles (devoirs multiples + examen unique).
    const manDev = await client.query(
      `SELECT note::float8 AS note, note_max::float8 AS note_max
       FROM professional_ecue_notes
       WHERE tenant_id=$3 AND ecue_id=$1 AND student_id=$2 AND ue_session_id=$4
         AND nature='devoir'`,
      [ecueId, studentId, tenantId, ueSessionId]
    );
    // Examen manuel : la Session 2 (rattrapage) REMPLACE la Session 1.
    const manExam = await client.query(
      `SELECT note::float8 AS note, note_max::float8 AS note_max,
              COALESCE(session, 1)::int AS session
       FROM professional_ecue_notes
       WHERE tenant_id=$3 AND ecue_id=$1 AND student_id=$2 AND ue_session_id=$4
         AND nature='examen'
       ORDER BY session DESC LIMIT 1`,
      [ecueId, studentId, tenantId, ueSessionId]
    );

    const devoirs: number[] = [
      ...devEval.rows.map((r) => normaliserNote(r.note, r.note_max || 20)),
      ...manDev.rows.map((r) => normaliserNote(r.note, r.note_max || 20)),
    ];
    const moyDev = calcMoyenneDevoirs(devoirs);

    let examen: number | null = null;
    let examenSession = 1;
    if ((manExam.rowCount ?? 0) > 0) {
      const r = manExam.rows[0];
      examen = normaliserNote(r.note, r.note_max || 20);
      examenSession = Number(r.session) || 1;
    } else if ((examEval.rowCount ?? 0) > 0) {
      const r = examEval.rows[0];
      examen = normaliserNote(r.note, r.note_max || 20);
    }

    const hasAuto = (devEval.rowCount ?? 0) > 0 || (examEval.rowCount ?? 0) > 0;
    const hasManuel = (manDev.rowCount ?? 0) > 0 || (manExam.rowCount ?? 0) > 0;
    const source: EcueBreakdown["source"] =
      hasAuto && hasManuel ? "mixte" : hasManuel ? "manuel" : hasAuto ? "auto" : "aucune";

    const note = noteEcue(moyDev, examen);
    const eliminee = note != null && note < SEUIL_ELIMINATOIRE;
    return { moyenneDevoirs: moyDev, noteExamen: examen, note, eliminee, source, examenSession };
  }

  /** Calcule et persiste le résultat d'une ECUE (préserve l'override manuel). */
  private async recomputeEcueResult(
    client: PoolClient,
    tenantId: string,
    ecueId: string,
    studentId: string,
    ueSessionId: string
  ): Promise<void> {
    const bd = await this.computeEcueBreakdown(client, tenantId, ecueId, studentId, ueSessionId);

    const existing = await client.query(
      `SELECT validee_manuellement FROM professional_ecue_results
       WHERE tenant_id=$1 AND ecue_id=$2 AND student_id=$3 AND ue_session_id=$4`,
      [tenantId, ecueId, studentId, ueSessionId]
    );
    const manual = existing.rows[0]?.validee_manuellement === true;
    const autoValid = bd.note != null && bd.note >= SEUIL_VALIDATION;
    const validee = manual || autoValid;
    // Session d'obtention (LMD) : validée au mérite → session de la note
    // d'examen retenue (2 si rattrapage) ; validée uniquement par le jury → 2.
    const sessionObtention = validee ? (autoValid ? bd.examenSession : 2) : null;

    await client.query(
      `INSERT INTO professional_ecue_results
         (tenant_id, ecue_id, student_id, ue_session_id,
          moyenne, moyenne_devoirs, note_examen, eliminee, note_source,
          validee, date_validation, session_obtention)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $10 THEN now() ELSE NULL END, $12)
       ON CONFLICT (tenant_id, ecue_id, student_id, ue_session_id)
       DO UPDATE SET moyenne = EXCLUDED.moyenne,
                     moyenne_devoirs = EXCLUDED.moyenne_devoirs,
                     note_examen = EXCLUDED.note_examen,
                     eliminee = EXCLUDED.eliminee,
                     note_source = EXCLUDED.note_source,
                     validee = professional_ecue_results.validee_manuellement OR $11,
                     session_obtention = CASE
                       WHEN (professional_ecue_results.validee_manuellement OR $11)
                         THEN COALESCE($12, 2)
                       ELSE NULL END,
                     date_validation = CASE
                       WHEN (professional_ecue_results.validee_manuellement OR $11)
                         AND professional_ecue_results.date_validation IS NULL THEN now()
                       WHEN NOT (professional_ecue_results.validee_manuellement OR $11) THEN NULL
                       ELSE professional_ecue_results.date_validation END,
                     updated_at = now()`,
      [
        tenantId,
        ecueId,
        studentId,
        ueSessionId,
        bd.note,
        bd.moyenneDevoirs,
        bd.noteExamen,
        bd.eliminee,
        bd.source,
        validee,
        autoValid,
        sessionObtention,
      ]
    );
  }

  /* ==================== Validation d'une UE ========================= */

  /**
   * Évalue la validation d'une UE (compensation + verrou éliminatoire) et met
   * à jour `student_professional_ue_results` (octroi des UV si validée).
   */
  private async evaluateUeValidation(
    client: PoolClient,
    tenantId: string,
    ueId: string,
    studentId: string,
    ueSessionId: string
  ): Promise<void> {
    const rows = await client.query(
      `SELECT l.ecue_id, e.credits::int AS credits,
              r.moyenne_devoirs::float8 AS moyenne_devoirs,
              r.note_examen::float8 AS note_examen,
              r.validee_manuellement AS validee_manuellement
       FROM professional_ue_ecue l
       JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
       LEFT JOIN professional_ecue_results r
         ON r.ecue_id = l.ecue_id AND r.student_id = $3
         AND r.ue_session_id = $4 AND r.tenant_id = l.tenant_id
       WHERE l.ue_id=$1 AND l.tenant_id=$2 AND ${NOT_CONDUITE}`,
      [ueId, tenantId, studentId, ueSessionId]
    );
    const ue = await client.query(
      `SELECT nb_uv FROM professional_ue WHERE id=$1 AND tenant_id=$2`,
      [ueId, tenantId]
    );
    const nbUv = ue.rows[0]?.nb_uv ?? 0;

    // Une UE sans ECUE gradable reste « en_cours ».
    if (rows.rowCount === 0) {
      await this.upsertUeResult(client, tenantId, ueId, studentId, ueSessionId, "en_cours", 0);
      return;
    }

    const inputs: EcueInput[] = rows.rows.map((r) => ({
      moyenneDevoirs: r.moyenne_devoirs,
      noteExamen: r.note_examen,
      credits: r.credits ?? 0,
      validationManuelle: r.validee_manuellement === true,
    }));
    const res = evaluerUe(inputs);
    const incomplet = res.motifs.includes("INCOMPLET");
    const statut = res.validee ? "validee" : incomplet ? "en_cours" : "echec";
    const uvAcquises = res.validee ? nbUv : 0;
    await this.upsertUeResult(client, tenantId, ueId, studentId, ueSessionId, statut, uvAcquises);
  }

  private async upsertUeResult(
    client: PoolClient,
    tenantId: string,
    ueId: string,
    studentId: string,
    ueSessionId: string,
    statut: string,
    uvAcquises: number
  ): Promise<void> {
    await client.query(
      `INSERT INTO student_professional_ue_results
         (tenant_id, ue_id, student_id, ue_session_id, statut, uv_acquises, date_validation)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5 = 'validee' THEN now() ELSE NULL END)
       ON CONFLICT (tenant_id, ue_id, student_id)
       DO UPDATE SET statut = EXCLUDED.statut, uv_acquises = EXCLUDED.uv_acquises,
                     ue_session_id = EXCLUDED.ue_session_id,
                     date_validation = CASE
                       WHEN EXCLUDED.statut = 'validee'
                         AND student_professional_ue_results.date_validation IS NULL THEN now()
                       WHEN EXCLUDED.statut <> 'validee' THEN NULL
                       ELSE student_professional_ue_results.date_validation END,
                     updated_at = now()`,
      [tenantId, ueId, studentId, ueSessionId, statut, uvAcquises]
    );
  }

  /**
   * Validation manuelle (override) d'un résultat ECUE. Réévalue l'UE associée.
   */
  async validateEcueResultManually(
    tenantId: string,
    resultId: string,
    validee: boolean,
    userId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE professional_ecue_results
         SET validee = $1, validee_manuellement = $1, valide_par = $2,
             date_validation = CASE WHEN $1 THEN now() ELSE NULL END, updated_at = now()
         WHERE id=$3 AND tenant_id=$4
         RETURNING ecue_id, student_id, ue_session_id`,
        [validee, userId ?? null, resultId, tenantId]
      );
      if (res.rowCount === 0) return fail("ECUE_RESULT_NOT_FOUND", "Résultat ECUE introuvable.");
      const { student_id, ue_session_id } = res.rows[0];
      const sess = await client.query(
        `SELECT ue_id FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
        [ue_session_id, tenantId]
      );
      if ((sess.rowCount ?? 0) > 0) {
        await this.evaluateUeValidation(
          client,
          tenantId,
          sess.rows[0].ue_id,
          student_id,
          ue_session_id
        );
      }
      return ok({ id: resultId, validee });
    });
  }

  /* ==================== Notes manuelles par ECUE ===================== */

  /** Vrai si l'utilisateur (enseignant) enseigne l'ECUE dans la cohorte. */
  private async teacherTeachesEcue(
    client: PoolClient,
    tenantId: string,
    userId: string,
    ecueId: string,
    ueSessionId: string
  ): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM professional_session_ecue_teachers a
       JOIN teachers t ON t.id = a.enseignant_id
       WHERE a.tenant_id=$1 AND a.ue_session_id=$2 AND a.ecue_id=$3 AND t.user_id=$4 LIMIT 1`,
      [tenantId, ueSessionId, ecueId, userId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Crée (devoir) ou met à jour (examen unique) une note manuelle. */
  async upsertManualEcueNote(
    tenantId: string,
    input: {
      ecue_id: string;
      student_id: string;
      ue_session_id: string;
      nature: "devoir" | "examen";
      libelle?: string | null;
      note: number;
      note_max?: number;
      session?: number;
    },
    userId?: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const noteMax = input.note_max ?? 20;
      if (input.note > noteMax)
        return fail("VALIDATION_ERROR", "La note dépasse le barème.");
      if (
        teacherUserId &&
        !(await this.teacherTeachesEcue(
          client,
          tenantId,
          teacherUserId,
          input.ecue_id,
          input.ue_session_id
        ))
      ) {
        return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }

      const session = input.session === 2 ? 2 : 1;
      let row;
      if (input.nature === "examen") {
        // Une note d'examen par session (S1 + S2 rattrapage possibles).
        const r = await client.query(
          `INSERT INTO professional_ecue_notes
             (tenant_id, ecue_id, student_id, ue_session_id, nature, libelle, note, note_max, saisi_par, session)
           VALUES ($1,$2,$3,$4,'examen',$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, ecue_id, student_id, ue_session_id, session) WHERE nature='examen'
           DO UPDATE SET libelle=EXCLUDED.libelle, note=EXCLUDED.note,
                         note_max=EXCLUDED.note_max, saisi_par=EXCLUDED.saisi_par,
                         updated_at=now()
           RETURNING *`,
          [
            tenantId,
            input.ecue_id,
            input.student_id,
            input.ue_session_id,
            input.libelle ?? null,
            input.note,
            noteMax,
            userId ?? null,
            session,
          ]
        );
        row = r.rows[0];
      } else {
        const r = await client.query(
          `INSERT INTO professional_ecue_notes
             (tenant_id, ecue_id, student_id, ue_session_id, nature, libelle, note, note_max, saisi_par, session)
           VALUES ($1,$2,$3,$4,'devoir',$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            tenantId,
            input.ecue_id,
            input.student_id,
            input.ue_session_id,
            input.libelle ?? null,
            input.note,
            noteMax,
            userId ?? null,
            session,
          ]
        );
        row = r.rows[0];
      }

      await this.recomputeEcueAndUe(
        client,
        tenantId,
        input.ecue_id,
        input.student_id,
        input.ue_session_id
      );
      return ok(row);
    });
  }

  async updateManualEcueNote(
    tenantId: string,
    id: string,
    patch: { libelle?: string | null; note?: number; note_max?: number },
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      if (teacherUserId) {
        const own = await client.query(
          `SELECT ecue_id, ue_session_id FROM professional_ecue_notes WHERE id=$1 AND tenant_id=$2`,
          [id, tenantId]
        );
        if (own.rowCount === 0) return fail("NOTE_NOT_FOUND", "Note introuvable.");
        if (
          !(await this.teacherTeachesEcue(
            client,
            tenantId,
            teacherUserId,
            own.rows[0].ecue_id,
            own.rows[0].ue_session_id
          ))
        ) {
          return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
        }
      }
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      if (patch.libelle !== undefined) {
        sets.push(`libelle=$${i++}`);
        params.push(patch.libelle);
      }
      if (patch.note !== undefined) {
        sets.push(`note=$${i++}`);
        params.push(patch.note);
      }
      if (patch.note_max !== undefined) {
        sets.push(`note_max=$${i++}`);
        params.push(patch.note_max);
      }
      if (sets.length === 0) return fail("VALIDATION_ERROR", "Aucun champ à modifier.");
      params.push(id, tenantId);
      const r = await client.query(
        `UPDATE professional_ecue_notes SET ${sets.join(", ")}, updated_at=now()
         WHERE id=$${i++} AND tenant_id=$${i}
         RETURNING *`,
        params
      );
      if (r.rowCount === 0) return fail("NOTE_NOT_FOUND", "Note introuvable.");
      const n = r.rows[0];
      await this.recomputeEcueAndUe(client, tenantId, n.ecue_id, n.student_id, n.ue_session_id);
      return ok(n);
    });
  }

  async deleteManualEcueNote(
    tenantId: string,
    id: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      if (teacherUserId) {
        const own = await client.query(
          `SELECT ecue_id, ue_session_id FROM professional_ecue_notes WHERE id=$1 AND tenant_id=$2`,
          [id, tenantId]
        );
        if (own.rowCount === 0) return fail("NOTE_NOT_FOUND", "Note introuvable.");
        if (
          !(await this.teacherTeachesEcue(
            client,
            tenantId,
            teacherUserId,
            own.rows[0].ecue_id,
            own.rows[0].ue_session_id
          ))
        ) {
          return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
        }
      }
      const r = await client.query(
        `DELETE FROM professional_ecue_notes WHERE id=$1 AND tenant_id=$2
         RETURNING ecue_id, student_id, ue_session_id`,
        [id, tenantId]
      );
      if (r.rowCount === 0) return fail("NOTE_NOT_FOUND", "Note introuvable.");
      const n = r.rows[0];
      await this.recomputeEcueAndUe(client, tenantId, n.ecue_id, n.student_id, n.ue_session_id);
      return ok({ id });
    });
  }

  /** Notes manuelles d'une ECUE (filtrable par cohorte / étudiant). */
  async listEcueNotes(
    tenantId: string,
    ecueId: string,
    ueSessionId?: string,
    studentId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId, ecueId];
      let where = `tenant_id=$1 AND ecue_id=$2`;
      if (ueSessionId) {
        params.push(ueSessionId);
        where += ` AND ue_session_id=$${params.length}`;
      }
      if (studentId) {
        params.push(studentId);
        where += ` AND student_id=$${params.length}`;
      }
      const r = await client.query(
        `SELECT id, tenant_id, ecue_id, student_id, ue_session_id, nature, libelle,
                note::float8 AS note, note_max::float8 AS note_max, saisi_par,
                created_at, updated_at
         FROM professional_ecue_notes
         WHERE ${where}
         ORDER BY nature, created_at`,
        params
      );
      return ok(r.rows);
    });
  }

  private async recomputeEcueAndUe(
    client: PoolClient,
    tenantId: string,
    ecueId: string,
    studentId: string,
    ueSessionId: string
  ): Promise<void> {
    await this.recomputeEcueResult(client, tenantId, ecueId, studentId, ueSessionId);
    const sess = await client.query(
      `SELECT ue_id FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
      [ueSessionId, tenantId]
    );
    if ((sess.rowCount ?? 0) > 0) {
      await this.evaluateUeValidation(client, tenantId, sess.rows[0].ue_id, studentId, ueSessionId);
    }
  }

  /* ========================= Lectures ============================== */

  /** Résultats ECUE d'une cohorte (vue admin/enseignant). */
  async listSessionResults(tenantId: string, ueSessionId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT r.id, r.ecue_id, r.student_id, r.ue_session_id,
                r.moyenne::float8 AS moyenne,
                r.moyenne_devoirs::float8 AS moyenne_devoirs,
                r.note_examen::float8 AS note_examen,
                r.eliminee, r.note_source,
                r.validee, r.validee_manuellement, r.valide_par, r.date_validation,
                e.code AS ecue_code, e.libelle AS ecue_libelle,
                u.first_name, u.last_name
         FROM professional_ecue_results r
         JOIN professional_ecue e ON e.id = r.ecue_id
         JOIN student_profiles sp ON sp.id = r.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE r.ue_session_id=$1 AND r.tenant_id=$2
         ORDER BY u.last_name, u.first_name, e.code`,
        [ueSessionId, tenantId]
      );
      return ok(res.rows);
    });
  }

  /**
   * Grille de saisie d'une cohorte : ECUE de l'UE × étudiants inscrits, avec
   * les résultats calculés et les notes manuelles existantes.
   */
  /**
   * Conduite d'un semestre : la note de conduite est portée par une UE/ECUE
   * dédiée (« Conduite »), distincte des matières. Renvoie l'ECUE + la session
   * de conduite du semestre et la liste des étudiants du semestre avec leur note
   * de conduite éventuelle. La saisie se fait ensuite via /ecue/:id/manual-notes
   * (nature « examen », une note unique par étudiant).
   */
  async getSemestreConduite(
    tenantId: string,
    semestreId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      // Sessions du semestre (liaison directe ou via l'UE).
      const semLink = `(
        s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                 WHERE semestre_id = $2 AND tenant_id = $1)
        OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                       WHERE semestre_id = $2 AND tenant_id = $1)
      )`;

      // Session + ECUE de conduite du semestre.
      const cond = await client.query(
        `SELECT s.id AS ue_session_id, s.ue_id, e.id AS ecue_id,
                e.code AS ecue_code, e.libelle AS ecue_libelle, e.credits::int AS credits
         FROM professional_ue_sessions s
         JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
         JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
         WHERE s.tenant_id = $1
           AND (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
           AND ${semLink}
         LIMIT 1`,
        [tenantId, semestreId]
      );
      if (cond.rowCount === 0) {
        return ok({ conduite: null, students: [] });
      }
      const conduite = cond.rows[0];

      // Étudiants du semestre : inscrits (confirmés) de toutes les sessions du semestre.
      const students = await client.query(
        `SELECT DISTINCT en.student_id, u.first_name, u.last_name,
                sp.student_number AS matricule
         FROM professional_enrollments en
         JOIN student_profiles sp ON sp.id = en.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE en.tenant_id = $1 AND en.statut IN ('confirmee','terminee')
           AND en.ue_session_id IN (
             SELECT s.id FROM professional_ue_sessions s
             WHERE s.tenant_id = $1 AND ${semLink}
           )
         ORDER BY u.last_name, u.first_name`,
        [tenantId, semestreId]
      );

      // Notes de conduite existantes (nature « examen »).
      const notes = await client.query(
        `SELECT id, student_id, note::float8 AS note, note_max::float8 AS note_max
         FROM professional_ecue_notes
         WHERE tenant_id = $1 AND ecue_id = $2 AND ue_session_id = $3 AND nature = 'examen'`,
        [tenantId, conduite.ecue_id, conduite.ue_session_id]
      );
      const noteBy = new Map<string, any>();
      for (const n of notes.rows) noteBy.set(n.student_id, n);

      return ok({
        conduite: {
          ue_session_id: conduite.ue_session_id,
          ecue_id: conduite.ecue_id,
          ecue_code: conduite.ecue_code,
          ecue_libelle: conduite.ecue_libelle,
          credits: conduite.credits,
          note_max: 20,
        },
        students: students.rows.map((s) => {
          const n = noteBy.get(s.student_id);
          return {
            ...s,
            note_id: n?.id ?? null,
            note: n?.note ?? null,
          };
        }),
      });
    });
  }

  /**
   * Semestres ouverts à la SAISIE DES CONDUITES, avec leur filière.
   *
   * Un semestre y figure tant qu'il reste quelque chose à y faire :
   *   - il a encore au moins une cohorte active (hors UE « Conduite », qui n'est
   *     jamais clôturée et fausserait le test) ; OU
   *   - au moins un étudiant n'a pas sa note de conduite, même si toutes les
   *     cohortes sont terminées : on ne perd pas un semestre à finaliser.
   *
   * Un semestre sans aucune cohorte est écarté (rien à noter), et un semestre
   * dépourvu d'ECUE « Conduite » ne compte aucune note manquante — sans quoi il
   * resterait indéfiniment dans la liste, aucune saisie n'y étant possible.
   *
   * `filiereId` restreint au besoin à une filière ; sinon tout le tenant, ce qui
   * sert à dresser la liste des filières encore concernées.
   */
  private async conduiteSemestreRows(
    client: PoolClient,
    tenantId: string,
    filiereId?: string
  ): Promise<any[]> {
    const params: any[] = [tenantId];
    let filiereFilter = "";
    if (filiereId) {
      params.push(filiereId);
      filiereFilter = `AND sm.filiere_id = $${params.length}`;
    }
    const r = await client.query(
      `WITH sem AS (
         SELECT sm.id, sm.libelle, sm.filiere_id,
                p.name AS filiere_nom, p.code AS filiere_code
         FROM professional_semestres sm
         JOIN programmes p ON p.id = sm.filiere_id
         WHERE sm.tenant_id = $1 ${filiereFilter}
       ),
       sess AS (
         SELECT sem.id AS semestre_id, s.id AS ue_session_id, s.ue_id, s.statut,
                u.libelle AS ue_libelle, s.date_debut
         FROM sem
         JOIN professional_ue_sessions s ON s.tenant_id = $1 AND (
                s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                         WHERE semestre_id = sem.id AND tenant_id = $1)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = sem.id AND tenant_id = $1))
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       ),
       agg AS (
         SELECT semestre_id,
                count(*)::int AS nb_sessions,
                count(*) FILTER (
                  WHERE statut NOT IN ('termine','annule')
                    AND ue_libelle NOT ILIKE 'conduite%'
                )::int AS nb_sessions_actives,
                min(date_debut)::text AS date_debut
         FROM sess GROUP BY semestre_id
       ),
       cond AS (
         SELECT DISTINCT ON (se.semestre_id)
                se.semestre_id, se.ue_session_id, e.id AS ecue_id
         FROM sess se
         JOIN professional_ue_ecue l ON l.ue_id = se.ue_id AND l.tenant_id = $1
         JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = $1
         WHERE e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%'
         ORDER BY se.semestre_id
       ),
       etu AS (
         SELECT DISTINCT se.semestre_id, en.student_id
         FROM sess se
         JOIN professional_enrollments en
           ON en.ue_session_id = se.ue_session_id AND en.tenant_id = $1
          AND en.statut IN ('confirmee','terminee')
       ),
       manque AS (
         SELECT e.semestre_id, count(*)::int AS nb
         FROM etu e
         JOIN cond c ON c.semestre_id = e.semestre_id
         WHERE NOT EXISTS (
           SELECT 1 FROM professional_ecue_notes n
           WHERE n.tenant_id = $1 AND n.student_id = e.student_id
             AND n.ecue_id = c.ecue_id AND n.ue_session_id = c.ue_session_id
             AND n.nature = 'examen'
         )
         GROUP BY e.semestre_id
       )
       SELECT sem.id, sem.libelle, sem.filiere_id, sem.filiere_nom, sem.filiere_code,
              agg.nb_sessions, agg.nb_sessions_actives, agg.date_debut,
              COALESCE(manque.nb, 0)::int AS nb_conduites_manquantes
       FROM sem
       JOIN agg ON agg.semestre_id = sem.id
       LEFT JOIN manque ON manque.semestre_id = sem.id
       WHERE agg.nb_sessions > 0
         AND (agg.nb_sessions_actives > 0 OR COALESCE(manque.nb, 0) > 0)
       ORDER BY sem.filiere_nom, sem.libelle`,
      params
    );
    return r.rows;
  }

  /**
   * Filières encore concernées par la saisie des conduites : celles ayant au
   * moins un semestre retenu par `conduiteSemestreRows`. Une filière dont aucun
   * semestre n'a de cohorte n'apparaît donc pas, et une filière dont les
   * cohortes sont terminées reste visible tant qu'une conduite manque.
   */
  async listConduiteFilieres(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const rows = await this.conduiteSemestreRows(client, tenantId);
      const byId = new Map<string, any>();
      for (const r of rows) {
        if (!byId.has(r.filiere_id)) {
          byId.set(r.filiere_id, {
            id: r.filiere_id,
            name: r.filiere_nom,
            code: r.filiere_code,
            nb_conduites_manquantes: 0,
          });
        }
        byId.get(r.filiere_id).nb_conduites_manquantes += Number(r.nb_conduites_manquantes ?? 0);
      }
      return ok(Array.from(byId.values()));
    });
  }

  /** Semestres d'une filière ouverts à la saisie des conduites. */
  async listConduiteSemestres(
    tenantId: string,
    filiereId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) =>
      ok(await this.conduiteSemestreRows(client, tenantId, filiereId))
    );
  }

  async getSessionGrid(
    tenantId: string,
    ueSessionId: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sess = await client.query(
        `SELECT s.id, s.ue_id, s.libelle AS session_libelle,
                u.code AS ue_code, u.libelle AS ue_libelle
         FROM professional_ue_sessions s
         JOIN professional_ue u ON u.id = s.ue_id
         WHERE s.id=$1 AND s.tenant_id=$2`,
        [ueSessionId, tenantId]
      );
      if (sess.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Cohorte introuvable.");
      const ueId = sess.rows[0].ue_id as string;

      // Enseignant : limité aux ECUE qui lui sont affectées dans cette cohorte.
      const ecueParams: any[] = [ueId, tenantId];
      let teacherFilter = "";
      if (teacherUserId) {
        ecueParams.push(ueSessionId, teacherUserId);
        teacherFilter = `AND l.ecue_id IN (
          SELECT a.ecue_id FROM professional_session_ecue_teachers a
          JOIN teachers t ON t.id = a.enseignant_id
          WHERE a.ue_session_id=$3 AND t.user_id=$4 AND a.tenant_id=$2)`;
      }
      const ecues = await client.query(
        `SELECT l.ecue_id, e.code, e.libelle, e.credits::int AS credits, l.ordre,
                l.est_obligatoire
         FROM professional_ue_ecue l
         JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
         WHERE l.ue_id=$1 AND l.tenant_id=$2 AND ${NOT_CONDUITE} ${teacherFilter}
         ORDER BY l.ordre, e.code`,
        ecueParams
      );
      const students = await client.query(
        `SELECT DISTINCT en.student_id, u.first_name, u.last_name,
                sp.student_number AS matricule
         FROM professional_enrollments en
         JOIN student_profiles sp ON sp.id = en.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE en.ue_session_id=$1 AND en.tenant_id=$2
           AND en.statut IN ('confirmee','terminee')
         ORDER BY u.last_name, u.first_name`,
        [ueSessionId, tenantId]
      );
      const resultsRows = await client.query(
        `SELECT r.id AS result_id, r.ecue_id, r.student_id,
                r.moyenne::float8 AS moyenne, r.moyenne_devoirs::float8 AS moyenne_devoirs,
                r.note_examen::float8 AS note_examen, r.eliminee, r.note_source,
                r.validee, r.validee_manuellement
         FROM professional_ecue_results r
         WHERE r.ue_session_id=$1 AND r.tenant_id=$2`,
        [ueSessionId, tenantId]
      );
      const notes = await client.query(
        `SELECT id, ecue_id, student_id, nature, libelle,
                note::float8 AS note, note_max::float8 AS note_max,
                COALESCE(session, 1)::int AS session
         FROM professional_ecue_notes
         WHERE ue_session_id=$1 AND tenant_id=$2
         ORDER BY nature, session, created_at`,
        [ueSessionId, tenantId]
      );
      // Notes issues des évaluations (copies notées) — pour affichage détaillé.
      const ecueIds = ecues.rows.map((e) => e.ecue_id);
      const studentIds = students.rows.map((s) => s.student_id);
      let submissions: any = { rows: [] };
      if (ecueIds.length > 0 && studentIds.length > 0) {
        submissions = await client.query(
          `SELECT a.ecue_id, sub.student_id, a.id AS assignment_id, a.titre,
                  a.type, a.evaluation_type,
                  sub.note::float8 AS note, a.note_max::float8 AS note_max
           FROM professional_assignment_submissions sub
           JOIN professional_assignments a ON a.id = sub.assignment_id
           WHERE sub.tenant_id=$1 AND sub.note IS NOT NULL
             AND a.ecue_id = ANY($2::uuid[]) AND sub.student_id = ANY($3::uuid[])
             AND (a.ue_session_id=$4 OR a.ue_session_id IS NULL)
           ORDER BY a.type DESC, a.titre`,
          [tenantId, ecueIds, studentIds, ueSessionId]
        );
      }
      return ok({
        session: {
          id: ueSessionId,
          ue_id: ueId,
          ue_code: sess.rows[0].ue_code,
          ue_libelle: sess.rows[0].ue_libelle,
          session_libelle: sess.rows[0].session_libelle,
        },
        ecues: ecues.rows,
        students: students.rows,
        results: resultsRows.rows,
        notes: notes.rows,
        submissions: submissions.rows,
      });
    });
  }

  /**
   * Étudiants en rattrapage (Session 2) d'un semestre — une ligne par couple
   * (étudiant, ECUE) dont le résultat est CALCULÉ mais NON validé (< 10).
   *
   * Alimente la page « Rattrapages » : dès que la note d'examen de Session 2
   * fait passer l'ECUE à ≥ 10, le résultat devient validé et la ligne sort
   * d'elle-même de la liste. Les ECUE sans note calculée (`moyenne IS NULL`)
   * ne sont pas des rattrapages : l'étudiant n'a simplement pas encore été
   * noté en Session 1.
   *
   * Enseignant (`teacherUserId`) : limité aux ECUE qui lui sont affectées.
   */
  async listSemestreRattrapages(
    tenantId: string,
    semestreId: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId, semestreId];
      let teacherFilter = "";
      if (teacherUserId) {
        params.push(teacherUserId);
        teacherFilter = teacherEcueFilterSql("$3");
      }
      const rows = await client.query(
        `SELECT r.id AS result_id, r.student_id, r.ecue_id, s.id AS ue_session_id,
                s.statut AS session_statut, s.libelle AS session_libelle,
                u.id AS ue_id, u.code AS ue_code, u.libelle AS ue_libelle,
                e.code AS ecue_code, e.libelle AS ecue_libelle, e.credits::int AS credits,
                r.moyenne::float8 AS moyenne,
                r.moyenne_devoirs::float8 AS moyenne_devoirs,
                r.note_examen::float8 AS note_examen, r.eliminee,
                usr.first_name, usr.last_name, sp.student_number AS matricule,
                n1.note::float8 AS note_examen_s1,
                n2.id AS note_s2_id, n2.note::float8 AS note_examen_s2
         ${RATTRAPAGE_FROM}
         JOIN student_profiles sp ON sp.id = r.student_id
         JOIN users usr ON usr.id = sp.user_id
         LEFT JOIN professional_ecue_notes n1
           ON n1.tenant_id = r.tenant_id AND n1.ecue_id = r.ecue_id
          AND n1.student_id = r.student_id AND n1.ue_session_id = s.id
          AND n1.nature = 'examen' AND n1.session = 1
         LEFT JOIN professional_ecue_notes n2
           ON n2.tenant_id = r.tenant_id AND n2.ecue_id = r.ecue_id
          AND n2.student_id = r.student_id AND n2.ue_session_id = s.id
          AND n2.nature = 'examen' AND n2.session = 2
         WHERE r.tenant_id = $1
           AND ${RATTRAPAGE_PREDICATE}
           AND ${semestreLinkSql("$2")} ${teacherFilter}
         ORDER BY usr.last_name, usr.first_name, u.code, e.code`,
        params
      );
      return ok(rows.rows);
    });
  }

  /**
   * Filières ayant au moins un rattrapage en attente — sélecteur de la page
   * « Rattrapages ». Une filière dont tout est validé n'y figure pas : l'écran
   * ne propose que des choix qui donnent quelque chose à voir.
   */
  async listRattrapageFilieres(
    tenantId: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId];
      let teacherFilter = "";
      if (teacherUserId) {
        params.push(teacherUserId);
        teacherFilter = teacherEcueFilterSql("$2");
      }
      const rows = await client.query(
        `SELECT DISTINCT p.id, p.name, p.code
         ${RATTRAPAGE_FROM}
         JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = u.tenant_id
         WHERE r.tenant_id = $1 AND ${RATTRAPAGE_PREDICATE} ${teacherFilter}
         ORDER BY p.name`,
        params
      );
      return ok(rows.rows);
    });
  }

  /**
   * Semestres d'une filière ayant au moins un rattrapage en attente, avec le
   * nombre d'ECUE concernées. Même règle que `listRattrapageFilieres`.
   */
  async listRattrapageSemestres(
    tenantId: string,
    filiereId: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId, filiereId];
      let teacherFilter = "";
      if (teacherUserId) {
        params.push(teacherUserId);
        teacherFilter = teacherEcueFilterSql("$3");
      }
      const rows = await client.query(
        `SELECT sm.id, sm.libelle,
                (SELECT count(*)::int
                 ${RATTRAPAGE_FROM}
                 WHERE r.tenant_id = sm.tenant_id AND ${RATTRAPAGE_PREDICATE}
                   AND ${semestreLinkSql("sm.id", "sm.tenant_id")} ${teacherFilter}
                ) AS nb_rattrapages
         FROM professional_semestres sm
         WHERE sm.tenant_id = $1 AND sm.filiere_id = $2
         ORDER BY sm.libelle`,
        params
      );
      // Le comptage sert aussi de filtre : pas de rattrapage, pas de semestre.
      return ok(rows.rows.filter((x: any) => Number(x.nb_rattrapages ?? 0) > 0));
    });
  }

  /** Capitalisation des UV par UE pour un étudiant. */
  async listStudentUeResults(tenantId: string, studentId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT r.id, r.ue_id, r.student_id, r.ue_session_id, r.statut,
                r.uv_acquises, r.date_validation,
                u.code AS ue_code, u.libelle AS ue_libelle, u.nb_uv AS ue_nb_uv
         FROM student_professional_ue_results r
         JOIN professional_ue u ON u.id = r.ue_id
         WHERE r.student_id=$1 AND r.tenant_id=$2
         ORDER BY u.code`,
        [studentId, tenantId]
      );
      return ok(res.rows);
    });
  }
}
