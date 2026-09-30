import type { PoolClient } from "pg";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import { messageCloture, semestreClotureDeEvaluation } from "./professional-cloture-guard";

/**
 * Évaluations professionnelles (feature 030) — rattachées à l'ECUE
 * (`ecue_id`), avec un contexte de cohorte optionnel (`ue_session_id`).
 *  - création / liste / modification / suppression
 *  - soumission par les étudiants (en ligne / PDF)
 *  - correction (auto QCM/vrai-faux, manuelle réponses libres)
 */

const ASSIGNMENT_TYPES = ["devoir", "controle", "examen", "projet", "qcm", "autre"] as const;
type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

const EVALUATION_TYPES = ["online", "pdf", "ai_generated"] as const;
type EvaluationType = (typeof EVALUATION_TYPES)[number];

const ASSIGNMENT_STATUTS = ["brouillon", "publie", "cloture"] as const;
type AssignmentStatut = (typeof ASSIGNMENT_STATUTS)[number];

const SHOW_RESULTS_MODES = ["immediately", "after_correction", "never"] as const;
type ShowResultsMode = (typeof SHOW_RESULTS_MODES)[number];

export interface AiConfig {
  mcq?: number;
  short_answer?: number;
  long_answer?: number;
  true_false?: number;
  difficulty?: "easy" | "medium" | "hard";
  instructions?: string | null;
}

export interface CreateAssignmentInput {
  ecue_id: string;
  ue_session_id?: string | null;
  titre: string;
  description?: string | null;
  type?: AssignmentType;
  evaluation_type?: EvaluationType;
  note_max?: number;
  coefficient?: number;
  consigne_url?: string | null;
  starts_at?: string | null;
  due_at?: string | null;
  statut?: AssignmentStatut;
  // online / ai_generated
  duration_minutes?: number | null;
  max_attempts?: number;
  shuffle_questions?: boolean;
  show_results_mode?: ShowResultsMode;
  // pdf / homework
  subject_content?: string | null;
  subject_document_url?: string | null;
  max_file_size_mb?: number;
  late_submission_allowed?: boolean;
  late_penalty_percent?: number;
  // ai_generated
  ai_config?: AiConfig | null;
  ai_source_material_ids?: string[] | null;
}

export interface UpdateAssignmentInput extends Partial<Omit<CreateAssignmentInput, "ecue_id">> {}

const QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "short_answer",
  "long_answer",
  "true_false",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface CreateQuestionInput {
  type: QuestionType;
  question_text: string;
  position?: number;
  points?: number;
  options?: Array<{ id: string; text: string }> | null;
  correct_answer?: string | null;
  explanation?: string | null;
}

export class ProfessionalAssignmentsService extends ProfessionalBaseService {
  /** Met à jour l'URL du document sujet (après upload). */
  async setSubjectDocumentUrl(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    assignmentId: string,
    url: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const cur = await client.query(
        `SELECT ecue_id FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (cur.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, cur.rows[0].ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      const res = await client.query(
        `UPDATE professional_assignments
         SET subject_document_url = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3 RETURNING *`,
        [url, assignmentId, tenantId]
      );
      return ok(res.rows[0]);
    });
  }

  /** Accès lecture au sujet : admin, enseignant de l'ECUE, ou étudiant inscrit. */
  async getAssignmentForRead(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    assignmentId: string
  ): Promise<ServiceResult<{ subject_document_url: string | null; titre: string }>> {
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT id, ecue_id, titre, subject_document_url
         FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (r.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      const a = r.rows[0];
      if (isAdmin) return ok(a);
      if (await this.teacherTeachesEcue(client, userId, a.ecue_id)) return ok(a);
      if (await this.studentEnrolledInEcue(client, userId, a.ecue_id)) return ok(a);
      return fail("FORBIDDEN", "Vous n'avez pas accès à cette évaluation.");
    });
  }

  /* --------------------------- Helpers d'accès --------------------------- */

  private async teacherTeachesEcue(
    client: PoolClient,
    userId: string,
    ecueId: string
  ): Promise<boolean> {
    if (!userId) return false;
    const r = await client.query(
      `SELECT 1
       FROM professional_session_ecue_teachers a
       JOIN teachers t ON t.id = a.enseignant_id
       WHERE a.ecue_id = $1 AND t.user_id = $2
       UNION
       SELECT 1
       FROM professional_ue_ecue l
       JOIN professional_ue_sessions s ON s.ue_id = l.ue_id
       JOIN teachers t ON t.id = s.enseignant_id
       WHERE l.ecue_id = $1 AND t.user_id = $2
       UNION
       SELECT 1 FROM professional_ecue_seances se
       JOIN teachers t ON t.id = se.enseignant_id
       WHERE se.ecue_id = $1 AND t.user_id = $2
       LIMIT 1`,
      [ecueId, userId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  private async studentEnrolledInEcue(
    client: PoolClient,
    userId: string,
    ecueId: string
  ): Promise<{ studentProfileId: string } | null> {
    const r = await client.query(
      `SELECT sp.id AS student_profile_id
       FROM student_profiles sp
       JOIN professional_enrollments e ON e.student_id = sp.id
       JOIN professional_ue_sessions s ON s.id = e.ue_session_id
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id
       WHERE l.ecue_id = $1
         AND sp.user_id = $2
         AND e.statut IN ('confirmee','terminee')
       LIMIT 1`,
      [ecueId, userId]
    );
    if (r.rowCount === 0) return null;
    return { studentProfileId: r.rows[0].student_profile_id as string };
  }

  /* --------------------------------- CRUD -------------------------------- */

  async list(
    tenantId: string,
    filters: { ecue_id?: string; ue_session_id?: string }
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["a.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;
      if (filters.ecue_id) {
        where.push(`a.ecue_id = $${i++}`);
        params.push(filters.ecue_id);
      }
      if (filters.ue_session_id) {
        where.push(`(a.ue_session_id = $${i} OR a.ue_session_id IS NULL)`);
        params.push(filters.ue_session_id);
        i++;
      }
      const res = await client.query(
        `SELECT a.*,
                (SELECT count(*)::int FROM professional_assignment_submissions s
                   WHERE s.assignment_id = a.id AND s.statut IN ('soumis','en_correction','note')) AS nb_soumis,
                (SELECT count(*)::int FROM professional_assignment_submissions s
                   WHERE s.assignment_id = a.id AND s.statut = 'note') AS nb_notes
         FROM professional_assignments a
         WHERE ${where.join(" AND ")}
         ORDER BY a.due_at DESC NULLS LAST, a.created_at DESC`,
        params
      );
      return ok(res.rows);
    });
  }

  async create(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    input: CreateAssignmentInput
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ecue = await client.query(
        `SELECT 1 FROM professional_ecue WHERE id = $1 AND tenant_id = $2`,
        [input.ecue_id, tenantId]
      );
      if (ecue.rowCount === 0) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");

      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, input.ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }

      if (input.ue_session_id) {
        const sess = await client.query(
          `SELECT 1 FROM professional_ue_sessions s
           JOIN professional_ue_ecue l ON l.ue_id = s.ue_id
           WHERE s.id = $1 AND l.ecue_id = $2`,
          [input.ue_session_id, input.ecue_id]
        );
        if (sess.rowCount === 0)
          return fail("VALIDATION_ERROR", "La cohorte ne contient pas cette ECUE.");
      }

      // Un seul examen par ECUE et par cohorte (note d'examen unique / semestre).
      if ((input.type ?? "devoir") === "examen" && input.ue_session_id) {
        const dup = await client.query(
          `SELECT 1 FROM professional_assignments
           WHERE tenant_id=$1 AND ecue_id=$2 AND ue_session_id=$3
             AND type='examen' AND statut <> 'brouillon'`,
          [tenantId, input.ecue_id, input.ue_session_id]
        );
        if ((dup.rowCount ?? 0) > 0)
          return fail(
            "EXAMEN_ALREADY_EXISTS",
            "Une évaluation de type « examen » existe déjà pour cette ECUE dans cette cohorte."
          );
      }

      const evalType: EvaluationType = input.evaluation_type ?? "pdf";
      const res = await client.query(
        `INSERT INTO professional_assignments
           (tenant_id, ecue_id, ue_session_id, titre, description,
            type, evaluation_type, note_max, coefficient, consigne_url,
            starts_at, due_at, statut, created_by,
            duration_minutes, max_attempts, shuffle_questions, show_results_mode,
            subject_content, subject_document_url,
            max_file_size_mb, late_submission_allowed, late_penalty_percent,
            ai_config, ai_source_material_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         RETURNING *`,
        [
          tenantId,
          input.ecue_id,
          input.ue_session_id ?? null,
          input.titre,
          input.description ?? null,
          input.type ?? "devoir",
          evalType,
          input.note_max ?? 20,
          input.coefficient ?? 1,
          input.consigne_url ?? null,
          input.starts_at ?? null,
          input.due_at ?? null,
          input.statut ?? "publie",
          userId,
          input.duration_minutes ?? null,
          input.max_attempts ?? 1,
          input.shuffle_questions ?? false,
          input.show_results_mode ?? "after_correction",
          input.subject_content ?? null,
          input.subject_document_url ?? null,
          input.max_file_size_mb ?? 10,
          input.late_submission_allowed ?? false,
          input.late_penalty_percent ?? 0,
          input.ai_config ? JSON.stringify(input.ai_config) : null,
          input.ai_source_material_ids ?? null,
        ]
      );
      return ok(res.rows[0]);
    });
  }

  /**
   * Extrait le nom de fichier du sujet à partir de son URL protégée
   * (`…/assignments/{id}/subject-document/{filename}`) pour permettre la recopie
   * du fichier lors d'une duplication. Retourne `null` si aucun document.
   */
  private subjectDocFilename(url?: string | null): string | null {
    if (!url) return null;
    const marker = "/subject-document/";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const raw = url.slice(idx + marker.length).split(/[?#]/)[0];
    if (!raw) return null;
    try {
      const name = decodeURIComponent(raw);
      // Sécurité : refuse tout traversal.
      if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
      return name;
    } catch {
      return null;
    }
  }

  /**
   * Duplique une évaluation existante vers d'autres cibles (ECUE × cohorte)
   * affectées à l'enseignant — pour « assigner » un même devoir à d'autres
   * filières. Copie la configuration complète ET les questions interactives ; le
   * fichier sujet éventuel est recopié côté route (fs) via la métadonnée
   * `document_to_copy` retournée pour chaque duplicata créé.
   *
   * Chaque cible invalide (non enseignée, hors cohorte, examen déjà présent,
   * identique à la source…) est ignorée et rapportée dans `skipped` ; la
   * duplication continue pour les autres cibles.
   */
  async duplicateToTargets(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    sourceAssignmentId: string,
    targets: Array<{ ecue_id: string; ue_session_id?: string | null }>,
    overrides?: { due_at?: string | null; starts_at?: string | null; statut?: string | null }
  ): Promise<
    ServiceResult<{
      created: any[];
      skipped: Array<{
        ecue_id: string;
        ue_session_id: string | null;
        reason: string;
        message: string;
      }>;
    }>
  > {
    return this.withTenant(tenantId, async (client) => {
      if (!Array.isArray(targets) || targets.length === 0) {
        return fail("VALIDATION_ERROR", "Aucune cible sélectionnée.");
      }

      const srcRes = await client.query(
        `SELECT * FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [sourceAssignmentId, tenantId]
      );
      if (srcRes.rowCount === 0) return fail("NOT_FOUND", "Évaluation source introuvable.");
      const src = srcRes.rows[0];

      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, src.ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas l'ECUE de cette évaluation.");
      }

      const srcDocFilename = this.subjectDocFilename(src.subject_document_url);

      const created: any[] = [];
      const skipped: Array<{
        ecue_id: string;
        ue_session_id: string | null;
        reason: string;
        message: string;
      }> = [];

      for (const t of targets) {
        const ecueId = t.ecue_id;
        const sessionId = t.ue_session_id ?? null;
        const tag = { ecue_id: ecueId, ue_session_id: sessionId };

        if (!ecueId) {
          skipped.push({ ...tag, reason: "INVALID", message: "ECUE cible manquante." });
          continue;
        }
        if (ecueId === src.ecue_id && sessionId === (src.ue_session_id ?? null)) {
          skipped.push({
            ...tag,
            reason: "SAME_AS_SOURCE",
            message: "Cible identique à la source.",
          });
          continue;
        }

        const ecueExists = await client.query(
          `SELECT 1 FROM professional_ecue WHERE id = $1 AND tenant_id = $2`,
          [ecueId, tenantId]
        );
        if (ecueExists.rowCount === 0) {
          skipped.push({ ...tag, reason: "ECUE_NOT_FOUND", message: "ECUE introuvable." });
          continue;
        }

        if (!isAdmin) {
          const allowed = await this.teacherTeachesEcue(client, userId, ecueId);
          if (!allowed) {
            skipped.push({
              ...tag,
              reason: "FORBIDDEN",
              message: "Vous n'enseignez pas cette ECUE.",
            });
            continue;
          }
        }

        if (sessionId) {
          const sess = await client.query(
            `SELECT 1 FROM professional_ue_sessions s
             JOIN professional_ue_ecue l ON l.ue_id = s.ue_id
             WHERE s.id = $1 AND l.ecue_id = $2`,
            [sessionId, ecueId]
          );
          if (sess.rowCount === 0) {
            skipped.push({
              ...tag,
              reason: "ECUE_NOT_IN_COHORT",
              message: "La cohorte ne contient pas cette ECUE.",
            });
            continue;
          }
        }

        const targetStatut = (overrides?.statut ?? src.statut) as string;
        if (src.type === "examen" && sessionId && targetStatut !== "brouillon") {
          const dup = await client.query(
            `SELECT 1 FROM professional_assignments
             WHERE tenant_id=$1 AND ecue_id=$2 AND ue_session_id=$3
               AND type='examen' AND statut <> 'brouillon'`,
            [tenantId, ecueId, sessionId]
          );
          if ((dup.rowCount ?? 0) > 0) {
            skipped.push({
              ...tag,
              reason: "EXAMEN_EXISTS",
              message: "Un examen existe déjà pour cette ECUE dans cette cohorte.",
            });
            continue;
          }
        }

        // Copie de la ligne (sans le fichier sujet — recopié ensuite côté route).
        const ins = await client.query(
          `INSERT INTO professional_assignments
             (tenant_id, ecue_id, ue_session_id, titre, description, type, evaluation_type,
              note_max, coefficient, consigne_url, starts_at, due_at, statut, created_by,
              duration_minutes, max_attempts, shuffle_questions, show_results_mode,
              subject_content, subject_document_url, max_file_size_mb,
              late_submission_allowed, late_penalty_percent, ai_config, ai_source_material_ids)
           SELECT tenant_id, $2, $3, titre, description, type, evaluation_type,
              note_max, coefficient, consigne_url,
              COALESCE($5::timestamptz, starts_at), COALESCE($6::timestamptz, due_at),
              COALESCE($7, statut), $4,
              duration_minutes, max_attempts, shuffle_questions, show_results_mode,
              subject_content, NULL, max_file_size_mb,
              late_submission_allowed, late_penalty_percent, ai_config, ai_source_material_ids
           FROM professional_assignments
           WHERE id = $1 AND tenant_id = $8
           RETURNING *`,
          [
            sourceAssignmentId,
            ecueId,
            sessionId,
            userId,
            overrides?.starts_at ?? null,
            overrides?.due_at ?? null,
            overrides?.statut ?? null,
            tenantId,
          ]
        );
        const dup = ins.rows[0];

        // Copie des questions interactives (QCM, réponses, vrai/faux…).
        await client.query(
          `INSERT INTO professional_assignment_questions
             (tenant_id, assignment_id, position, type, question_text, points,
              options, correct_answer, explanation)
           SELECT tenant_id, $1, position, type, question_text, points,
              options, correct_answer, explanation
           FROM professional_assignment_questions
           WHERE assignment_id = $2 AND tenant_id = $3
           ORDER BY position, created_at`,
          [dup.id, sourceAssignmentId, tenantId]
        );

        created.push({
          ...dup,
          document_to_copy: srcDocFilename
            ? { source_assignment_id: sourceAssignmentId, filename: srcDocFilename }
            : null,
        });
      }

      return ok({ created, skipped });
    });
  }

  async update(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    assignmentId: string,
    input: UpdateAssignmentInput
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const cur = await client.query(
        `SELECT * FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (cur.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      const a = cur.rows[0];
      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, a.ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}`);
        if (k === "ai_config" && v !== null && typeof v === "object") {
          params.push(JSON.stringify(v));
        } else {
          params.push(v);
        }
      }
      if (sets.length === 0) return ok(a);
      sets.push(`updated_at = now()`);
      params.push(assignmentId, tenantId);
      const res = await client.query(
        `UPDATE professional_assignments SET ${sets.join(", ")}
         WHERE id = $${i++} AND tenant_id = $${i++} RETURNING *`,
        params
      );
      return ok(res.rows[0]);
    });
  }

  async delete(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    assignmentId: string
  ): Promise<ServiceResult<{ deleted: boolean }>> {
    return this.withTenant(tenantId, async (client) => {
      const cur = await client.query(
        `SELECT ecue_id FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (cur.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, cur.rows[0].ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      await client.query(`DELETE FROM professional_assignments WHERE id = $1`, [assignmentId]);
      return ok({ deleted: true });
    });
  }

  /* ------------------------------- Soumission ----------------------------- */

  async getAssignmentForStudent(
    tenantId: string,
    userId: string,
    assignmentId: string
  ): Promise<ServiceResult<{ studentProfileId: string }>> {
    return this.withTenant(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id, statut FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      if (ar.rows[0].statut === "cloture") return fail("FORBIDDEN", "Évaluation clôturée.");
      const enrolled = await this.studentEnrolledInEcue(client, userId, ar.rows[0].ecue_id);
      if (!enrolled) return fail("FORBIDDEN", "Vous n'êtes pas inscrit à cette ECUE.");
      return ok({ studentProfileId: enrolled.studentProfileId });
    });
  }

  async getSubmissionFileAccess(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    submissionId: string,
    expectedUrl: string
  ): Promise<ServiceResult<{ assignmentId: string }>> {
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT s.id, s.assignment_id, s.student_id, s.file_url,
                a.ecue_id, sp.user_id AS student_user_id
         FROM professional_assignment_submissions s
         JOIN professional_assignments a ON a.id = s.assignment_id
         JOIN student_profiles sp ON sp.id = s.student_id
         WHERE s.id = $1 AND s.tenant_id = $2 AND s.file_url = $3`,
        [submissionId, tenantId, expectedUrl]
      );
      if (r.rowCount === 0) return fail("NOT_FOUND", "Fichier de soumission introuvable.");
      const row = r.rows[0];
      if (isAdmin) return ok({ assignmentId: row.assignment_id });
      if (row.student_user_id === userId) return ok({ assignmentId: row.assignment_id });
      if (await this.teacherTeachesEcue(client, userId, row.ecue_id))
        return ok({ assignmentId: row.assignment_id });
      return fail("FORBIDDEN", "Accès refusé.");
    });
  }

  async submit(
    tenantId: string,
    userId: string,
    assignmentId: string,
    input: { contenu?: string | null; file_url?: string | null }
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id, statut FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      if (ar.rows[0].statut === "cloture") return fail("FORBIDDEN", "Évaluation clôturée.");
      const enrolled = await this.studentEnrolledInEcue(client, userId, ar.rows[0].ecue_id);
      if (!enrolled) return fail("FORBIDDEN", "Vous n'êtes pas inscrit à cette ECUE.");

      const existing = await client.query(
        `SELECT statut FROM professional_assignment_submissions
         WHERE assignment_id = $1 AND student_id = $2`,
        [assignmentId, enrolled.studentProfileId]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        const cur = existing.rows[0].statut;
        if (cur === "soumis" || cur === "en_correction" || cur === "note") {
          return fail(
            "ALREADY_SUBMITTED",
            "Votre copie a déjà été soumise et ne peut plus être modifiée."
          );
        }
      }

      const res = await client.query(
        `INSERT INTO professional_assignment_submissions
           (tenant_id, assignment_id, student_id, statut, contenu, file_url, submitted_at)
         VALUES ($1, $2, $3, 'soumis', $4, $5, now())
         ON CONFLICT (assignment_id, student_id) DO UPDATE
           SET contenu = EXCLUDED.contenu,
               file_url = EXCLUDED.file_url,
               statut = 'soumis',
               submitted_at = now(),
               updated_at = now()
         RETURNING *`,
        [tenantId, assignmentId, enrolled.studentProfileId, input.contenu ?? null, input.file_url ?? null]
      );
      return ok(res.rows[0]);
    });
  }

  /** Liste des soumissions d'une évaluation (enseignant/admin). */
  async listSubmissions(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    assignmentId: string
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id, ue_session_id FROM professional_assignments
         WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, ar.rows[0].ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      // Inscrits aux cohortes des UE contenant l'ECUE, joints aux soumissions.
      const res = await client.query(
        `SELECT DISTINCT ON (sp.id)
                sp.id AS student_id,
                u.first_name, u.last_name, u.email,
                sub.id AS submission_id, sub.statut, sub.contenu, sub.file_url,
                sub.note, sub.appreciation, sub.submitted_at, sub.graded_at
         FROM professional_enrollments e
         JOIN student_profiles sp ON sp.id = e.student_id
         JOIN users u ON u.id = sp.user_id
         JOIN professional_ue_sessions s ON s.id = e.ue_session_id
         JOIN professional_ue_ecue l ON l.ue_id = s.ue_id
         LEFT JOIN professional_assignment_submissions sub
                ON sub.assignment_id = $1 AND sub.student_id = sp.id
         WHERE l.ecue_id = $2
           AND e.statut IN ('confirmee','terminee')
         ORDER BY sp.id, u.last_name, u.first_name`,
        [assignmentId, ar.rows[0].ecue_id]
      );
      return ok(res.rows);
    });
  }

  async getMySubmission(
    tenantId: string,
    userId: string,
    assignmentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      const enrolled = await this.studentEnrolledInEcue(client, userId, ar.rows[0].ecue_id);
      if (!enrolled) return fail("FORBIDDEN", "Pas inscrit.");
      const res = await client.query(
        `SELECT * FROM professional_assignment_submissions
         WHERE assignment_id = $1 AND student_id = $2`,
        [assignmentId, enrolled.studentProfileId]
      );
      return ok(res.rows[0] ?? null);
    });
  }

  /** Évaluations à passer / passées pour l'étudiant connecté. */
  async listForStudent(tenantId: string, userId: string): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT a.id, a.titre, a.description, a.type, a.evaluation_type,
                a.note_max, a.coefficient,
                a.starts_at, a.due_at, a.statut,
                a.ecue_id,
                a.subject_content, a.subject_document_url,
                a.duration_minutes, a.max_attempts, a.shuffle_questions,
                a.show_results_mode,
                a.max_file_size_mb, a.late_submission_allowed,
                a.late_penalty_percent,
                ec.code AS ecue_code, ec.libelle AS ecue_libelle,
                sub.id AS submission_id, sub.statut AS submission_statut,
                sub.note, sub.appreciation, sub.submitted_at, sub.graded_at,
                sub.contenu AS submission_contenu, sub.file_url AS submission_file_url
         FROM professional_assignments a
         JOIN professional_ecue ec ON ec.id = a.ecue_id
         JOIN professional_ue_ecue l ON l.ecue_id = a.ecue_id
         JOIN professional_ue_sessions s ON s.ue_id = l.ue_id
         JOIN professional_enrollments e ON e.ue_session_id = s.id
         JOIN student_profiles sp ON sp.id = e.student_id
         LEFT JOIN professional_assignment_submissions sub
                ON sub.assignment_id = a.id AND sub.student_id = sp.id
         WHERE sp.user_id = $1
           AND e.statut IN ('confirmee','terminee')
           AND a.statut <> 'brouillon'
           AND a.tenant_id = $2
         GROUP BY a.id, ec.code, ec.libelle, sub.id
         ORDER BY a.due_at DESC NULLS LAST, a.created_at DESC`,
        [userId, tenantId]
      );
      return ok(res.rows);
    });
  }

  /** Devoirs & évaluations d'un enfant (parent authentifié, lecture seule). */
  async listForChild(
    tenantId: string,
    parentUserId: string,
    childStudentId: string
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const link = await client.query(
        `SELECT 1 FROM student_parents
         WHERE tenant_id = $1 AND parent_id = $2 AND student_id = $3 LIMIT 1`,
        [tenantId, parentUserId, childStudentId]
      );
      if ((link.rowCount ?? 0) === 0) {
        return fail("FORBIDDEN", "Cet élève n'est pas rattaché à votre compte.");
      }
      const res = await client.query(
        `SELECT a.id, a.titre, a.description, a.type, a.evaluation_type,
                a.note_max, a.coefficient,
                a.starts_at, a.due_at, a.statut,
                a.ecue_id,
                a.subject_content, a.subject_document_url,
                a.duration_minutes, a.max_attempts, a.shuffle_questions,
                a.show_results_mode,
                a.max_file_size_mb, a.late_submission_allowed,
                a.late_penalty_percent,
                ec.code AS ecue_code, ec.libelle AS ecue_libelle,
                sub.id AS submission_id, sub.statut AS submission_statut,
                sub.note, sub.appreciation, sub.submitted_at, sub.graded_at,
                sub.contenu AS submission_contenu, sub.file_url AS submission_file_url,
                -- Contexte de la cohorte, pour les filtres de l'espace parent
                -- (année scolaire → nom de classe → semestre).
                btrim(split_part(coh.libelle, ' ' || chr(8212) || ' ', 1)) AS classe_nom,
                CASE WHEN EXTRACT(MONTH FROM coh.date_debut) >= 9
                     THEN EXTRACT(YEAR FROM coh.date_debut)::int || '-' ||
                          (EXTRACT(YEAR FROM coh.date_debut)::int + 1)
                     ELSE (EXTRACT(YEAR FROM coh.date_debut)::int - 1) || '-' ||
                          EXTRACT(YEAR FROM coh.date_debut)::int
                END AS annee_scolaire,
                sem.id AS semestre_id, sem.libelle AS semestre_libelle
         FROM professional_assignments a
         JOIN professional_ecue ec ON ec.id = a.ecue_id
         -- UNE cohorte par devoir : celle, la plus récente, où l'enfant est
         -- inscrit et qui porte l'ECUE du devoir. Un JOIN direct dupliquerait
         -- le devoir autant de fois que l'ECUE apparaît dans des UE suivies —
         -- c'est ce que dédoublonnait le GROUP BY d'avant, au prix d'un
         -- contexte inexploitable.
         JOIN LATERAL (
           SELECT s.id, s.libelle, s.date_debut, s.ue_id
           FROM professional_ue_ecue l
           JOIN professional_ue_sessions s ON s.ue_id = l.ue_id
           JOIN professional_enrollments e ON e.ue_session_id = s.id
           WHERE l.ecue_id = a.ecue_id
             AND e.student_id = $1
             AND e.statut IN ('confirmee','terminee')
           ORDER BY s.date_debut DESC NULLS LAST
           LIMIT 1
         ) coh ON TRUE
         -- Semestre de la cohorte : rattachement direct, ou via son UE.
         LEFT JOIN LATERAL (
           SELECT sm.id, sm.libelle
           FROM professional_semestres sm
           WHERE sm.tenant_id = a.tenant_id
             AND (EXISTS (SELECT 1 FROM professional_semestre_sessions ss
                          WHERE ss.semestre_id = sm.id AND ss.ue_session_id = coh.id
                            AND ss.tenant_id = a.tenant_id)
               OR EXISTS (SELECT 1 FROM professional_semestre_ue su
                          WHERE su.semestre_id = sm.id AND su.ue_id = coh.ue_id
                            AND su.tenant_id = a.tenant_id))
           ORDER BY sm.libelle
           LIMIT 1
         ) sem ON TRUE
         LEFT JOIN professional_assignment_submissions sub
                ON sub.assignment_id = a.id AND sub.student_id = $1
         WHERE a.statut <> 'brouillon'
           AND a.tenant_id = $2
         ORDER BY a.due_at DESC NULLS LAST, a.created_at DESC`,
        [childStudentId, tenantId]
      );
      return ok(res.rows);
    });
  }

  /* ----------------------------- Questions ----------------------------- */

  async listQuestions(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    assignmentId: string
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      const ecueId = ar.rows[0].ecue_id;

      const isTeacher = await this.teacherTeachesEcue(client, userId, ecueId);
      const enrolled = await this.studentEnrolledInEcue(client, userId, ecueId);
      if (!isAdmin && !isTeacher && !enrolled) {
        return fail("FORBIDDEN", "Vous n'avez pas accès à cette évaluation.");
      }

      const hideAnswers = !isAdmin && !isTeacher; // étudiant : masque la solution
      const res = await client.query(
        `SELECT id, position, type, question_text, points, options
                ${hideAnswers ? "" : ", correct_answer, explanation"}
         FROM professional_assignment_questions
         WHERE assignment_id = $1 AND tenant_id = $2
         ORDER BY position, created_at`,
        [assignmentId, tenantId]
      );
      return ok(res.rows);
    });
  }

  async createQuestion(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    assignmentId: string,
    input: CreateQuestionInput
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      if (!isAdmin) {
        const ok2 = await this.teacherTeachesEcue(client, userId, ar.rows[0].ecue_id);
        if (!ok2) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      if (!QUESTION_TYPES.includes(input.type)) {
        return fail("VALIDATION_ERROR", "Type de question invalide.");
      }
      if (!input.question_text?.trim()) {
        return fail("VALIDATION_ERROR", "Le libellé de la question est requis.");
      }
      const res = await client.query(
        `INSERT INTO professional_assignment_questions
          (tenant_id, assignment_id, position, type, question_text, points,
           options, correct_answer, explanation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          assignmentId,
          input.position ?? 0,
          input.type,
          input.question_text,
          input.points ?? 1,
          input.options ? JSON.stringify(input.options) : null,
          input.correct_answer ?? null,
          input.explanation ?? null,
        ]
      );
      return ok(res.rows[0]);
    });
  }

  async updateQuestion(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    questionId: string,
    input: Partial<CreateQuestionInput>
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const q = await client.query(
        `SELECT q.assignment_id, a.ecue_id
         FROM professional_assignment_questions q
         JOIN professional_assignments a ON a.id = q.assignment_id
         WHERE q.id = $1 AND q.tenant_id = $2`,
        [questionId, tenantId]
      );
      if (q.rowCount === 0) return fail("NOT_FOUND", "Question introuvable.");
      if (!isAdmin) {
        const ok2 = await this.teacherTeachesEcue(client, userId, q.rows[0].ecue_id);
        if (!ok2) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}`);
        params.push(k === "options" && v != null && typeof v === "object" ? JSON.stringify(v) : v);
      }
      if (sets.length === 0) {
        const cur = await client.query(`SELECT * FROM professional_assignment_questions WHERE id = $1`, [questionId]);
        return ok(cur.rows[0]);
      }
      sets.push(`updated_at = now()`);
      params.push(questionId, tenantId);
      const res = await client.query(
        `UPDATE professional_assignment_questions SET ${sets.join(", ")}
         WHERE id = $${i++} AND tenant_id = $${i++} RETURNING *`,
        params
      );
      return ok(res.rows[0]);
    });
  }

  async deleteQuestion(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    questionId: string
  ): Promise<ServiceResult<{ deleted: boolean }>> {
    return this.withTenant(tenantId, async (client) => {
      const q = await client.query(
        `SELECT q.assignment_id, a.ecue_id
         FROM professional_assignment_questions q
         JOIN professional_assignments a ON a.id = q.assignment_id
         WHERE q.id = $1 AND q.tenant_id = $2`,
        [questionId, tenantId]
      );
      if (q.rowCount === 0) return fail("NOT_FOUND", "Question introuvable.");
      if (!isAdmin) {
        const ok2 = await this.teacherTeachesEcue(client, userId, q.rows[0].ecue_id);
        if (!ok2) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      await client.query(`DELETE FROM professional_assignment_questions WHERE id = $1`, [questionId]);
      return ok({ deleted: true });
    });
  }

  async submitOnlineAnswers(
    tenantId: string,
    userId: string,
    assignmentId: string,
    answers: Array<{
      question_id: string;
      answer_text?: string | null;
      selected_option_ids?: string[] | null;
    }>
  ): Promise<ServiceResult<{ submission_id: string; auto_score: number; max_auto: number }>> {
    return this.withTenantTx(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id, statut FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      if (ar.rows[0].statut === "cloture") return fail("FORBIDDEN", "Évaluation clôturée.");
      const enrolled = await this.studentEnrolledInEcue(client, userId, ar.rows[0].ecue_id);
      if (!enrolled) return fail("FORBIDDEN", "Vous n'êtes pas inscrit à cette ECUE.");

      const existing = await client.query(
        `SELECT id, statut FROM professional_assignment_submissions
         WHERE assignment_id = $1 AND student_id = $2`,
        [assignmentId, enrolled.studentProfileId]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        const s = existing.rows[0].statut;
        if (s === "soumis" || s === "en_correction" || s === "note") {
          return fail("ALREADY_SUBMITTED", "Votre copie a déjà été soumise et ne peut plus être modifiée.");
        }
      }

      const sub = await client.query(
        `INSERT INTO professional_assignment_submissions
          (tenant_id, assignment_id, student_id, statut, submitted_at)
         VALUES ($1, $2, $3, 'soumis', now())
         ON CONFLICT (assignment_id, student_id) DO UPDATE
           SET statut = 'soumis', submitted_at = now(), updated_at = now()
         RETURNING id`,
        [tenantId, assignmentId, enrolled.studentProfileId]
      );
      const submissionId = sub.rows[0].id;

      const qs = await client.query(
        `SELECT id, type, points, correct_answer
         FROM professional_assignment_questions
         WHERE assignment_id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      const qById = new Map<string, any>();
      qs.rows.forEach((q) => qById.set(q.id, q));

      let autoScore = 0;
      let maxAuto = 0;

      for (const a of answers) {
        const q = qById.get(a.question_id);
        if (!q) continue;
        let isCorrect: boolean | null = null;
        let pointsEarned: number | null = null;
        let gradedManually = false;

        if (q.type === "true_false" || q.type === "mcq_single") {
          maxAuto += parseFloat(q.points);
          const selected = (a.selected_option_ids ?? [])[0] ?? null;
          isCorrect = selected != null && selected === q.correct_answer;
          pointsEarned = isCorrect ? parseFloat(q.points) : 0;
          autoScore += pointsEarned;
        } else if (q.type === "mcq_multi") {
          maxAuto += parseFloat(q.points);
          let expected: string[] = [];
          try {
            expected = q.correct_answer ? JSON.parse(q.correct_answer) : [];
          } catch {
            expected = [];
          }
          const given = a.selected_option_ids ?? [];
          isCorrect = expected.length === given.length && expected.every((e) => given.includes(e));
          pointsEarned = isCorrect ? parseFloat(q.points) : 0;
          autoScore += pointsEarned;
        } else if (q.type === "short_answer") {
          if (q.correct_answer != null && a.answer_text != null) {
            const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
            isCorrect = norm(String(a.answer_text)) === norm(String(q.correct_answer));
            pointsEarned = isCorrect ? parseFloat(q.points) : 0;
            maxAuto += parseFloat(q.points);
            autoScore += pointsEarned;
          } else {
            gradedManually = true;
          }
        } else {
          gradedManually = true; // long_answer : correction manuelle
        }

        await client.query(
          `INSERT INTO professional_assignment_question_answers
            (tenant_id, submission_id, question_id, answer_text, selected_option_ids,
             is_correct, points_earned, graded_manually)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (submission_id, question_id) DO UPDATE
             SET answer_text = EXCLUDED.answer_text,
                 selected_option_ids = EXCLUDED.selected_option_ids,
                 is_correct = EXCLUDED.is_correct,
                 points_earned = EXCLUDED.points_earned,
                 graded_manually = EXCLUDED.graded_manually,
                 updated_at = now()`,
          [
            tenantId,
            submissionId,
            a.question_id,
            a.answer_text ?? null,
            a.selected_option_ids ? JSON.stringify(a.selected_option_ids) : null,
            isCorrect,
            pointsEarned,
            gradedManually,
          ]
        );
      }

      return ok({ submission_id: submissionId, auto_score: autoScore, max_auto: maxAuto });
    });
  }

  async getMyAnswers(
    tenantId: string,
    userId: string,
    assignmentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      const enrolled = await this.studentEnrolledInEcue(client, userId, ar.rows[0].ecue_id);
      if (!enrolled) return fail("FORBIDDEN", "Pas inscrit.");

      const sub = await client.query(
        `SELECT id, statut, note FROM professional_assignment_submissions
         WHERE assignment_id = $1 AND student_id = $2`,
        [assignmentId, enrolled.studentProfileId]
      );
      if (sub.rowCount === 0) return ok({ submission: null, answers: [] });
      const answers = await client.query(
        `SELECT question_id, answer_text, selected_option_ids,
                is_correct, points_earned, feedback
         FROM professional_assignment_question_answers
         WHERE submission_id = $1`,
        [sub.rows[0].id]
      );
      return ok({ submission: sub.rows[0], answers: answers.rows });
    });
  }

  async getSubmissionDetail(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    submissionId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const subRes = await client.query(
        `SELECT s.id, s.assignment_id, s.student_id, s.statut, s.note,
                s.appreciation, s.submitted_at, s.graded_at,
                a.titre, a.note_max, a.evaluation_type, a.ecue_id,
                sp.user_id AS student_user_id,
                u.first_name, u.last_name, u.email
         FROM professional_assignment_submissions s
         JOIN professional_assignments a ON a.id = s.assignment_id
         JOIN student_profiles sp ON sp.id = s.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE s.id = $1 AND s.tenant_id = $2`,
        [submissionId, tenantId]
      );
      if (subRes.rowCount === 0) return fail("NOT_FOUND", "Soumission introuvable.");
      const sub = subRes.rows[0];
      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, sub.ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      const qRes = await client.query(
        `SELECT q.id AS question_id, q.position, q.type, q.question_text, q.points,
                q.options, q.correct_answer, q.explanation,
                ans.id AS answer_id, ans.answer_text, ans.selected_option_ids,
                ans.is_correct, ans.points_earned, ans.graded_manually, ans.feedback
         FROM professional_assignment_questions q
         LEFT JOIN professional_assignment_question_answers ans
                ON ans.question_id = q.id AND ans.submission_id = $1
         WHERE q.assignment_id = $2 AND q.tenant_id = $3
         ORDER BY q.position, q.created_at`,
        [submissionId, sub.assignment_id, tenantId]
      );
      const totalEarned = qRes.rows.reduce(
        (sum, r) => sum + (r.points_earned != null ? Number(r.points_earned) : 0),
        0
      );
      const totalQuestionPoints = qRes.rows.reduce((sum, r) => sum + Number(r.points || 0), 0);
      return ok({
        submission: sub,
        questions: qRes.rows,
        totals: { earned: totalEarned, max_questions: totalQuestionPoints },
      });
    });
  }

  async gradeQuestionAnswer(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    answerId: string,
    input: { points: number; feedback?: string | null }
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const r = await client.query(
        `SELECT ans.id, ans.submission_id, ans.question_id,
                q.points AS max_points, q.type,
                a.ecue_id, a.note_max, s.assignment_id, s.student_id
         FROM professional_assignment_question_answers ans
         JOIN professional_assignment_questions q ON q.id = ans.question_id
         JOIN professional_assignment_submissions s ON s.id = ans.submission_id
         JOIN professional_assignments a ON a.id = s.assignment_id
         WHERE ans.id = $1 AND ans.tenant_id = $2`,
        [answerId, tenantId]
      );
      if (r.rowCount === 0) return fail("NOT_FOUND", "Réponse introuvable.");
      const row = r.rows[0];
      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, row.ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      const max = parseFloat(row.max_points);
      if (input.points < 0 || input.points > max) {
        return fail("VALIDATION_ERROR", `Points hors plage (0 → ${max}).`);
      }
      const cloture = await semestreClotureDeEvaluation(
        client,
        tenantId,
        row.assignment_id,
        row.student_id
      );
      if (cloture) return fail("SEMESTRE_CLOTURE", messageCloture(cloture));
      await client.query(
        `UPDATE professional_assignment_question_answers
         SET points_earned = $1, feedback = $2, graded_manually = true,
             is_correct = ($1::numeric = $3::numeric),
             updated_at = now()
         WHERE id = $4`,
        [input.points, input.feedback ?? null, max, answerId]
      );

      const totRes = await client.query(
        `SELECT
           COALESCE(SUM(points_earned), 0)::float8 AS total_earned,
           COALESCE(SUM(q.points), 0)::float8 AS total_question_points,
           COUNT(*) FILTER (WHERE points_earned IS NULL) AS nb_ungraded
         FROM professional_assignment_question_answers ans
         JOIN professional_assignment_questions q ON q.id = ans.question_id
         WHERE ans.submission_id = $1`,
        [row.submission_id]
      );
      const { total_earned, total_question_points, nb_ungraded } = totRes.rows[0];

      let finalNote: number | null = null;
      if (Number(total_question_points) > 0) {
        finalNote =
          Math.round(
            ((Number(total_earned) * Number(row.note_max ?? 0)) / Number(total_question_points)) * 100
          ) / 100;
      }
      const newStatut = Number(nb_ungraded) === 0 ? "note" : "en_correction";
      await client.query(
        `UPDATE professional_assignment_submissions
         SET note = $1, statut = $2, graded_at = now(), graded_by = $3, updated_at = now()
         WHERE id = $4`,
        [finalNote, newStatut, userId, row.submission_id]
      );
      return ok({
        answer_id: answerId,
        points_earned: input.points,
        submission_note: finalNote,
        submission_statut: newStatut,
        assignment_id: row.assignment_id,
        student_id: row.student_id,
      });
    });
  }

  /* ------------------------------- Correction ----------------------------- */

  async grade(
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    assignmentId: string,
    studentId: string,
    input: { note: number; appreciation?: string | null }
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ar = await client.query(
        `SELECT ecue_id, note_max FROM professional_assignments WHERE id = $1 AND tenant_id = $2`,
        [assignmentId, tenantId]
      );
      if (ar.rowCount === 0) return fail("NOT_FOUND", "Évaluation introuvable.");
      if (!isAdmin) {
        const allowed = await this.teacherTeachesEcue(client, userId, ar.rows[0].ecue_id);
        if (!allowed) return fail("FORBIDDEN", "Vous n'enseignez pas cette ECUE.");
      }
      const noteMax = parseFloat(ar.rows[0].note_max);
      if (input.note < 0 || input.note > noteMax) {
        return fail("VALIDATION_ERROR", `Note hors plage (0 → ${noteMax}).`);
      }
      const cloture = await semestreClotureDeEvaluation(client, tenantId, assignmentId, studentId);
      if (cloture) return fail("SEMESTRE_CLOTURE", messageCloture(cloture));
      const res = await client.query(
        `INSERT INTO professional_assignment_submissions
           (tenant_id, assignment_id, student_id, statut, note, appreciation, graded_at, graded_by)
         VALUES ($1, $2, $3, 'note', $4, $5, now(), $6)
         ON CONFLICT (assignment_id, student_id) DO UPDATE
           SET statut = 'note', note = EXCLUDED.note,
               appreciation = EXCLUDED.appreciation,
               graded_at = now(), graded_by = EXCLUDED.graded_by, updated_at = now()
         RETURNING *`,
        [tenantId, assignmentId, studentId, input.note, input.appreciation ?? null, userId]
      );
      return ok(res.rows[0]);
    });
  }
}
