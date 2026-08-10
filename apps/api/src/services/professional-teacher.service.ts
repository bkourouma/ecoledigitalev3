import type { PoolClient } from "pg";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Service enseignant — Module Professionnel (feature 030).
 *
 * Expose les cohortes d'UE affectées à l'enseignant, leurs séances d'ECUE et la
 * présence par séance (`professional_ecue_attendance`). Les supports sont gérés
 * au niveau ECUE (voir ProfessionalEcueMaterialsService).
 */

const ATTENDANCE_STATUTS = ["present", "absent", "retard", "excuse"] as const;

export interface AttendanceRecordInput {
  student_id: string;
  statut: string;
}

export class ProfessionalTeacherService extends ProfessionalBaseService {
  private async getTeacherId(
    client: PoolClient,
    tenantId: string,
    userId: string
  ): Promise<string | null> {
    const res = await client.query(
      `SELECT id FROM teachers WHERE user_id=$1 AND tenant_id=$2 LIMIT 1`,
      [userId, tenantId]
    );
    return res.rowCount && res.rowCount > 0 ? (res.rows[0].id as string) : null;
  }

  /** L'enseignant intervient dans la session (affecté à au moins un de ses ECUE). */
  private async teacherOwnsSession(
    client: PoolClient,
    teacherId: string,
    ueSessionId: string
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM professional_session_ecue_teachers
       WHERE ue_session_id=$1 AND enseignant_id=$2 LIMIT 1`,
      [ueSessionId, teacherId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** L'enseignant est affecté à l'ECUE de cette séance dans sa session. */
  private async teacherOwnsSeance(
    client: PoolClient,
    teacherId: string,
    seanceId: string
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM professional_ecue_seances se
       JOIN professional_session_ecue_teachers a
         ON a.ue_session_id = se.ue_session_id AND a.ecue_id = se.ecue_id
       WHERE se.id=$1 AND a.enseignant_id=$2 LIMIT 1`,
      [seanceId, teacherId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** L'enseignant est affecté à cet ECUE dans cette session. */
  private async teacherOwnsSessionEcue(
    client: PoolClient,
    teacherId: string,
    ueSessionId: string,
    ecueId: string
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM professional_session_ecue_teachers
       WHERE ue_session_id=$1 AND ecue_id=$2 AND enseignant_id=$3 LIMIT 1`,
      [ueSessionId, ecueId, teacherId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Cohortes d'UE affectées à l'enseignant authentifié. */
  async listTeacherSessions(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      const res = await client.query(
        `SELECT DISTINCT s.id, s.libelle, s.date_debut::text AS date_debut,
                s.date_fin::text AS date_fin, s.statut, s.capacite_max,
                s.ue_id, ue.code AS ue_code, ue.libelle AS ue_libelle,
                ue.filiere_id, p.name AS filiere_nom, p.code AS filiere_code,
                (SELECT count(*)::int FROM professional_enrollments e
                 WHERE e.ue_session_id = s.id AND e.statut IN ('confirmee','terminee'))
                  AS nb_inscrits
         FROM professional_ue_sessions s
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         JOIN professional_session_ecue_teachers a ON a.ue_session_id = s.id
         WHERE a.enseignant_id = $1
         ORDER BY date_debut DESC`,
        [teacherId]
      );
      return ok(res.rows);
    });
  }

  /** Emploi du temps hebdomadaire de l'enseignant authentifié (ses créneaux). */
  /**
   * Étudiants de l'enseignant : inscrits (confirmés) des cohortes où il enseigne
   * une ECUE, avec le contexte filière / session (une ligne par étudiant×session).
   */
  async listTeacherStudents(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      const res = await client.query(
        `SELECT DISTINCT en.student_id, u.first_name, u.last_name, u.email,
                sp.student_number AS matricule, sp.phone,
                s.id AS ue_session_id, s.libelle AS session_libelle, s.statut AS session_statut,
                s.date_debut::text AS date_debut, s.date_fin::text AS date_fin,
                ue.code AS ue_code, ue.libelle AS ue_libelle,
                ue.filiere_id, p.name AS filiere_nom, p.code AS filiere_code
         FROM professional_session_ecue_teachers t
         JOIN teachers te ON te.id = t.enseignant_id
         JOIN professional_ue_sessions s ON s.id = t.ue_session_id AND s.tenant_id = t.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         JOIN professional_enrollments en ON en.ue_session_id = s.id
           AND en.statut IN ('confirmee','terminee')
         JOIN student_profiles sp ON sp.id = en.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE t.tenant_id = $1 AND te.id = $2
         ORDER BY p.name, s.libelle, u.last_name, u.first_name`,
        [tenantId, teacherId]
      );
      return ok(res.rows);
    });
  }

  /**
   * Historique des séances de l'enseignant (toutes ses séances planifiées),
   * avec le décompte de présence par statut (0 si l'appel n'a pas encore été
   * fait) et le contexte (ECUE, session, UE, filière).
   */
  async listTeacherAttendanceHistory(
    tenantId: string,
    userId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      const res = await client.query(
        `SELECT se.id AS seance_id, se.libelle AS seance_libelle,
                se.date::text AS date, se.heure_debut::text AS heure_debut,
                se.heure_fin::text AS heure_fin,
                se.ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                se.ue_session_id, s.libelle AS session_libelle, s.statut AS session_statut,
                ue.code AS ue_code, ue.libelle AS ue_libelle,
                ue.filiere_id, p.name AS filiere_nom, p.code AS filiere_code,
                count(a.*) FILTER (WHERE a.statut='present')::int AS nb_present,
                count(a.*) FILTER (WHERE a.statut='absent')::int  AS nb_absent,
                count(a.*) FILTER (WHERE a.statut='retard')::int  AS nb_retard,
                count(a.*) FILTER (WHERE a.statut='excuse')::int  AS nb_excuse,
                count(a.*)::int AS nb_marques
         FROM professional_ecue_seances se
         JOIN professional_session_ecue_teachers t
           ON t.ue_session_id = se.ue_session_id AND t.ecue_id = se.ecue_id
         JOIN teachers te ON te.id = t.enseignant_id
         JOIN professional_ecue e ON e.id = se.ecue_id
         JOIN professional_ue_sessions s ON s.id = se.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         LEFT JOIN professional_ecue_attendance a ON a.seance_id = se.id
         WHERE se.tenant_id = $1 AND te.id = $2
         GROUP BY se.id, se.libelle, se.date, se.heure_debut, se.heure_fin,
                  se.ecue_id, e.code, e.libelle, se.ue_session_id, s.libelle, s.statut,
                  ue.code, ue.libelle, ue.filiere_id, p.name, p.code
         ORDER BY se.date DESC, se.heure_debut DESC NULLS LAST`,
        [tenantId, teacherId]
      );
      return ok(res.rows);
    });
  }

  /**
   * Historique complet des évaluations rattachées aux ECUE affectés à
   * l'enseignant (toutes les évaluations qu'il a pu créer), avec le contexte
   * (ECUE, session, UE, filière) et le décompte des soumissions / copies notées.
   */
  async listTeacherAssignments(
    tenantId: string,
    userId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      const res = await client.query(
        `SELECT * FROM (
           SELECT DISTINCT ON (a.id)
                  a.id, a.titre, a.description, a.type, a.evaluation_type,
                  a.note_max::float8 AS note_max, a.coefficient::float8 AS coefficient,
                  a.statut, a.starts_at, a.due_at, a.created_at,
                  a.subject_document_url, a.subject_content,
                  a.duration_minutes, a.max_attempts, a.shuffle_questions,
                  a.show_results_mode,
                  a.max_file_size_mb::float8 AS max_file_size_mb,
                  a.late_submission_allowed,
                  a.late_penalty_percent::float8 AS late_penalty_percent,
                  a.ai_config,
                  a.ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                  a.ue_session_id, s.libelle AS session_libelle,
                  s.statut AS session_statut,
                  ue.code AS ue_code, ue.libelle AS ue_libelle,
                  ue.filiere_id, p.name AS filiere_nom, p.code AS filiere_code,
                  (SELECT count(*)::int FROM professional_assignment_submissions sub
                     WHERE sub.assignment_id = a.id
                       AND sub.statut IN ('soumis','en_correction','note')) AS nb_soumis,
                  (SELECT count(*)::int FROM professional_assignment_submissions sub
                     WHERE sub.assignment_id = a.id AND sub.statut = 'note') AS nb_notes
           FROM professional_assignments a
           JOIN professional_session_ecue_teachers t
             ON t.ecue_id = a.ecue_id AND t.tenant_id = a.tenant_id
           JOIN teachers te ON te.id = t.enseignant_id
           JOIN professional_ecue e ON e.id = a.ecue_id
           LEFT JOIN professional_ue_sessions s
             ON s.id = COALESCE(a.ue_session_id, t.ue_session_id)
           LEFT JOIN professional_ue ue ON ue.id = s.ue_id
           LEFT JOIN programmes p ON p.id = ue.filiere_id
           WHERE a.tenant_id = $1 AND te.id = $2
           ORDER BY a.id, (a.ue_session_id IS NOT NULL) DESC
         ) x
         ORDER BY due_at DESC NULLS LAST, created_at DESC`,
        [tenantId, teacherId]
      );
      return ok(res.rows);
    });
  }

  async listTeacherEmploiTemps(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      const res = await client.query(
        `SELECT et.id, et.jour,
                et.heure_debut::text AS heure_debut, et.heure_fin::text AS heure_fin,
                et.date_debut::text AS date_debut, et.date_fin::text AS date_fin,
                et.ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                ue.code AS ue_code, ue.libelle AS ue_libelle,
                p.name AS filiere_nom, p.code AS filiere_code,
                et.classroom_id, c.name AS classroom_name, c.code AS classroom_code
         FROM professional_emploi_temps et
         JOIN professional_ue_sessions s ON s.id = et.ue_session_id AND s.tenant_id = et.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         JOIN professional_ecue e ON e.id = et.ecue_id
         LEFT JOIN classrooms c ON c.id = et.classroom_id
         WHERE et.tenant_id = $1 AND et.enseignant_id = $2
         ORDER BY et.jour, et.heure_debut`,
        [tenantId, teacherId]
      );
      return ok(res.rows);
    });
  }

  /** ECUE (matières) affectées à l'enseignant authentifié, avec leur contexte. */
  async listTeacherEcue(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      const res = await client.query(
        `SELECT a.ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                e.credits::int AS credits,
                a.ue_session_id, s.libelle AS session_libelle,
                s.date_debut::text AS date_debut, s.date_fin::text AS date_fin, s.statut,
                ue.id AS ue_id, ue.code AS ue_code, ue.libelle AS ue_libelle,
                p.name AS filiere_nom, p.code AS filiere_code,
                (SELECT count(*)::int FROM professional_enrollments en
                 WHERE en.ue_session_id = s.id AND en.statut IN ('confirmee','terminee'))
                  AS nb_inscrits,
                (SELECT count(*)::int FROM professional_ecue_seances se
                 WHERE se.ue_session_id = s.id AND se.ecue_id = a.ecue_id) AS nb_seances
         FROM professional_session_ecue_teachers a
         JOIN professional_ue_sessions s ON s.id = a.ue_session_id AND s.tenant_id = a.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         JOIN professional_ecue e ON e.id = a.ecue_id
         WHERE a.enseignant_id = $1 AND a.tenant_id = $2
         ORDER BY s.date_debut DESC, ue.code, e.code`,
        [teacherId, tenantId]
      );
      return ok(res.rows);
    });
  }

  /** Séances d'une cohorte que l'enseignant anime. */
  async listSessionSeances(
    tenantId: string,
    userId: string,
    ueSessionId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      if (!(await this.teacherOwnsSession(client, teacherId, ueSessionId))) {
        return fail("FORBIDDEN", "Cette session ne vous est pas affectée.");
      }
      // Uniquement les séances des ECUE affectés à cet enseignant.
      const res = await client.query(
        `SELECT se.id, se.ecue_id, se.ue_session_id, se.libelle,
                se.date::text AS date, se.heure_debut::text AS heure_debut,
                se.heure_fin::text AS heure_fin,
                e.code AS ecue_code, e.libelle AS ecue_libelle
         FROM professional_ecue_seances se
         JOIN professional_ecue e ON e.id = se.ecue_id
         JOIN professional_session_ecue_teachers a
           ON a.ue_session_id = se.ue_session_id AND a.ecue_id = se.ecue_id
         WHERE se.ue_session_id=$1 AND a.enseignant_id=$2
         ORDER BY se.date, se.heure_debut NULLS FIRST`,
        [ueSessionId, teacherId]
      );
      return ok(res.rows);
    });
  }

  /**
   * Crée une séance dans une session pour un ECUE affecté à l'enseignant. La
   * séance est attribuée à l'enseignant.
   */
  async createSessionSeance(
    tenantId: string,
    userId: string,
    ueSessionId: string,
    input: {
      ecue_id: string;
      libelle?: string | null;
      date: string;
      heure_debut?: string | null;
      heure_fin?: string | null;
    }
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      // L'enseignant ne peut créer une séance que pour un ECUE qui lui est
      // affecté dans cette session.
      if (!(await this.teacherOwnsSessionEcue(client, teacherId, ueSessionId, input.ecue_id))) {
        return fail("FORBIDDEN", "Cet ECUE ne vous est pas affecté dans cette session.");
      }
      try {
        const res = await client.query(
          `INSERT INTO professional_ecue_seances
             (tenant_id, ecue_id, ue_session_id, libelle, date, heure_debut, heure_fin,
              enseignant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, ecue_id, ue_session_id, libelle, date::text AS date,
                     heure_debut::text AS heure_debut, heure_fin::text AS heure_fin`,
          [
            tenantId,
            input.ecue_id,
            ueSessionId,
            input.libelle ?? null,
            input.date,
            input.heure_debut ?? null,
            input.heure_fin ?? null,
            teacherId,
          ]
        );
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23514") return fail("VALIDATION_ERROR", "Horaires de séance invalides.");
        if (e?.code === "23503") return fail("VALIDATION_ERROR", "ECUE introuvable.");
        throw e;
      }
    });
  }

  /** Supprime une séance que l'enseignant anime (sa séance ou de sa session). */
  async deleteSeance(
    tenantId: string,
    userId: string,
    seanceId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      if (!(await this.teacherOwnsSeance(client, teacherId, seanceId))) {
        return fail("FORBIDDEN", "Cette séance ne vous est pas affectée.");
      }
      const res = await client.query(
        `DELETE FROM professional_ecue_seances WHERE id=$1 AND tenant_id=$2 RETURNING id`,
        [seanceId, tenantId]
      );
      if (res.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");
      return ok({ id: seanceId });
    });
  }

  /**
   * ECUE de la session **affectés à l'enseignant** (pour créer des séances et
   * rattacher les évaluations à ses propres ECUE).
   */
  async listSessionEcue(
    tenantId: string,
    userId: string,
    ueSessionId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      if (!(await this.teacherOwnsSession(client, teacherId, ueSessionId))) {
        return fail("FORBIDDEN", "Cette session ne vous est pas affectée.");
      }
      const res = await client.query(
        `SELECT e.id, e.code, e.libelle,
                l.est_obligatoire, l.coefficient::float8 AS coefficient, l.ordre
         FROM professional_session_ecue_teachers a
         JOIN professional_ue_sessions s ON s.id = a.ue_session_id
         JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.ecue_id = a.ecue_id
         JOIN professional_ecue e ON e.id = a.ecue_id
         WHERE a.ue_session_id=$1 AND a.enseignant_id=$2
         ORDER BY l.ordre, e.code`,
        [ueSessionId, teacherId]
      );
      return ok(res.rows);
    });
  }

  /* ----------------------------- Présences ---------------------------- */

  /** Inscrits confirmés de la cohorte avec leur présence pour une séance. */
  async listSeanceAttendance(
    tenantId: string,
    userId: string,
    seanceId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      if (!(await this.teacherOwnsSeance(client, teacherId, seanceId))) {
        return fail("FORBIDDEN", "Cette séance ne vous est pas affectée.");
      }
      const res = await client.query(
        `SELECT sp.id AS student_id, u.first_name, u.last_name,
                e.statut AS enrollment_statut, a.statut AS attendance_statut
         FROM professional_ecue_seances se
         JOIN professional_enrollments e ON e.ue_session_id = se.ue_session_id
         JOIN student_profiles sp ON sp.id = e.student_id
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN professional_ecue_attendance a
           ON a.seance_id = se.id AND a.student_id = e.student_id
         WHERE se.id=$1 AND e.statut IN ('confirmee','terminee')
         ORDER BY u.last_name, u.first_name`,
        [seanceId]
      );
      return ok(res.rows);
    });
  }

  /** Upsert de la présence des étudiants pour une séance. */
  async markSeanceAttendance(
    tenantId: string,
    userId: string,
    seanceId: string,
    records: AttendanceRecordInput[]
  ): Promise<ServiceResult<any>> {
    for (const r of records) {
      if (!ATTENDANCE_STATUTS.includes(r.statut as any)) {
        return fail("VALIDATION_ERROR", `Statut de présence invalide : ${r.statut}.`);
      }
    }
    return this.withTenantTx(tenantId, async (client) => {
      const teacherId = await this.getTeacherId(client, tenantId, userId);
      if (!teacherId) return fail("NOT_FOUND", "Profil enseignant introuvable.");
      if (!(await this.teacherOwnsSeance(client, teacherId, seanceId))) {
        return fail("FORBIDDEN", "Cette séance ne vous est pas affectée.");
      }
      for (const record of records) {
        await client.query(
          `INSERT INTO professional_ecue_attendance
             (tenant_id, seance_id, student_id, statut, marked_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, seance_id, student_id)
           DO UPDATE SET statut = EXCLUDED.statut,
                         marked_by = EXCLUDED.marked_by,
                         updated_at = now()`,
          [tenantId, seanceId, record.student_id, record.statut, userId]
        );
      }
      return ok({ updated: records.length });
    });
  }
}
