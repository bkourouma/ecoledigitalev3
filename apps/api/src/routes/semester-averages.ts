import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateAttendanceCertificatesPdfFromHtml,
  generateAttendanceCertificatesPdfFromWordTemplate,
} from "../services/attendance-certificate-template.service";
import {
  generateReportCardsPdfFromHtml,
  type ReportCardDocumentInput,
  type ReportCardSection,
  type ReportCardStudentIdentity,
  type ReportCardSubjectLine,
} from "../services/report-card-template.service";

const ManualGradesSchema = z.object({
  classId: z.string().uuid(),
  courseId: z.string().uuid(),
  periodId: z.string().uuid(),
  grades: z.array(
    z.object({
      studentId: z.string().uuid(),
      average: z.union([z.number().min(0).max(20), z.null()]),
    })
  ),
});

const MatrixUpsertSchema = z.object({
  classId: z.string().uuid(),
  periodId: z.string().uuid(),
  cells: z.array(
    z.object({
      studentId: z.string().uuid(),
      courseId: z.string().uuid(),
      average: z.union([z.number().min(0).max(20), z.null()]),
    })
  ),
  attendance: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        absenceHours: z.union([z.number().min(0), z.null()]),
        justifiedHours: z.union([z.number().min(0), z.null()]),
      })
    )
    .default([]),
});

const AttendanceCertificatesSchema = z.object({
  classId: z.string().uuid(),
  periodId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
});

export async function semesterAveragesRoutes(fastify: FastifyInstance) {
  async function assertClassPeriodAlignment(
    client: any,
    tenantId: string,
    classId: string,
    periodId: string
  ): Promise<{ ok: boolean; message?: string }> {
    const r = await client.query(
      `SELECT c.academic_year_id, p.academic_year_id AS period_ay
       FROM classes c
       JOIN academic_year_periods p ON p.tenant_id = c.tenant_id AND p.academic_year_id = c.academic_year_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND p.id = $3 AND p.tenant_id = $2`,
      [classId, tenantId, periodId]
    );
    if (r.rows.length === 0) {
      return { ok: false, message: "Classe ou période introuvable, ou la période n'appartient pas à la même année que la classe." };
    }
    return { ok: true };
  }

  async function assertCourseInClass(client: any, tenantId: string, classId: string, courseId: string): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM class_courses WHERE class_id = $1 AND course_id = $2 AND tenant_id = $3`,
      [classId, courseId, tenantId]
    );
    return r.rows.length > 0;
  }

  /**
   * Matières de la matrice : même périmètre que la page Matières (/academic/courses)
   * filtrée sur le programme de la classe (classe → programme → cours), sans passer par class_courses.
   * Ordre aligné sur GET /api/v1/courses (created_at DESC). Tous les statuts (draft / active / inactive).
   */
  async function fetchMatrixCourses(
    client: any,
    tenantId: string,
    classId: string
  ): Promise<{ id: string; code: string; name: string; coef: number }[]> {
    const progQ = `
      SELECT c.id, c.code, c.name, COALESCE(c.coef, 1) AS coef
      FROM classes cl
      JOIN courses c ON c.programme_id = cl.programme_id AND c.tenant_id = cl.tenant_id
      WHERE cl.id = $1 AND cl.tenant_id = $2
        AND cl.programme_id IS NOT NULL
      ORDER BY c.created_at DESC
    `;
    const progRes = await client.query(progQ, [classId, tenantId]);
    return progRes.rows.map((row: any) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      coef: Number(row.coef) || 1,
    }));
  }

  /** IDs de matières autorisées pour la saisie (aligné sur fetchMatrixCourses). */
  async function fetchAllowedCourseIds(client: any, tenantId: string, classId: string): Promise<Set<string>> {
    const prog = await client.query(
      `SELECT c.id
       FROM classes cl
       JOIN courses c ON c.programme_id = cl.programme_id AND c.tenant_id = cl.tenant_id
       WHERE cl.id = $1 AND cl.tenant_id = $2
         AND cl.programme_id IS NOT NULL`,
      [classId, tenantId]
    );
    return new Set(prog.rows.map((r: any) => r.id));
  }

  type ReportCardCourse = {
    id: string;
    code: string;
    name: string;
    coef: number;
    bilanTypeName: string;
  };

  type ReportCardStudent = ReportCardStudentIdentity;

  type WeightedStats = {
    totalCoef: number;
    weightedTotal: number;
    average: number | null;
  };

  function sanitizeFilenamePart(value: string): string {
    return String(value || "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "document";
  }

  function computeCompetitionRanks(entries: { key: string; score: number | null }[]): Record<string, number | null> {
    const result: Record<string, number | null> = {};
    for (const entry of entries) {
      result[entry.key] = null;
    }

    const scored = entries
      .filter((entry): entry is { key: string; score: number } => entry.score != null && !Number.isNaN(entry.score))
      .sort((left, right) => right.score - left.score);

    let previousScore: number | null = null;
    let previousRank = 0;

    scored.forEach((entry, index) => {
      const isTie = previousScore != null && Math.abs(entry.score - previousScore) < 0.0001;
      const rank = isTie ? previousRank : index + 1;
      result[entry.key] = rank;
      previousScore = entry.score;
      previousRank = rank;
    });

    return result;
  }

  function buildAverageMention(score: number | null): string {
    if (score == null) return "En attente";
    if (score >= 16) return "Excellent";
    if (score >= 14) return "Très bien";
    if (score >= 12) return "Bien";
    if (score >= 10) return "Assez bien";
    if (score >= 8) return "Passable";
    return "Insuffisant";
  }

  function buildCouncilDecision(score: number | null): string {
    if (score == null) return "Notes incompletes";
    if (score >= 10) return "Periode validee";
    if (score >= 8) return "Renforcement recommande";
    return "Periode non validee";
  }

  function isSecondYearBtsClass(className: string): boolean {
    const normalized = String(className || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    if (!normalized.includes("BTS")) return false;
    return /\b2\b/.test(normalized) || normalized.includes("DEUXIEME");
  }

  function buildEndYearDecision(
    score: number | null,
    options?: { isSecondSemester?: boolean; isSecondYearBts?: boolean }
  ): string {
    if (score == null) return "Décision en attente";
    if (options?.isSecondSemester && options?.isSecondYearBts) {
      return "Redouble en cas d'échec au BTS";
    }
    if (score >= 10) return "Admis(e) en année supérieure";
    return "Redoublement";
  }

  function buildAssignmentFlagsFromDecision(decision: string): { affected: boolean; repeating: boolean } {
    const normalized = String(decision || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const repeating = normalized.includes("REDOUBL");
    const pending = normalized.includes("ATTENTE");
    const affected = !repeating && !pending;
    return { affected, repeating };
  }

  function buildDistinctionSanctionsFromAverage(annual: number | null): string {
    if (annual == null) return "";
    if (annual >= 17) return "Tableau d'honneur + félicitations";
    if (annual >= 15) return "Tableau d'honneur + Encouragement";
    if (annual >= 12) return "Tableau d'honneur";
    return "";
  }

  function buildCouncilAppreciationFromAverage(annual: number | null): string {
    if (annual == null) return "";
    if (annual < 8) return "Travail insuffisant.";
    if (annual < 10) return "Travail fragile.";
    if (annual < 12) return "Travail passable.";
    if (annual < 14) return "Travail assez bon.";
    if (annual < 16) return "Bon travail.";
    if (annual < 18) return "Très bon travail.";
    return "Excellent travail.";
  }

  function formatHours(hours: number): string {
    const rounded = Math.round(hours * 100) / 100;
    if (Number.isInteger(rounded)) return String(Math.trunc(rounded)).padStart(2, "0");
    return String(rounded).replace(/\.?0+$/, "").replace(".", ",");
  }

  function buildAttendanceSummary(absenceHours: number | null, justifiedHours: number | null): string {
    if (absenceHours == null && justifiedHours == null) {
      return "00 heure(s) d'abscence (dont 00 justifiée(s))";
    }
    const absence = Math.max(0, absenceHours ?? 0);
    const justified = Math.max(0, justifiedHours ?? 0);
    return `${formatHours(absence)} heure(s) d'abscence (dont ${formatHours(justified)} justifiée(s))`;
  }

  async function fetchClassPeriodMeta(
    client: any,
    tenantId: string,
    classId: string,
    periodId: string
  ): Promise<{ className: string; schoolYearName: string; periodName: string; filiereName?: string }> {
    let metaRow: { class_name?: string; year_name?: string; period_name?: string; filiere_name?: string } | undefined;
    const metaQ = await client.query(
      `SELECT c.name AS class_name, ay.name AS year_name, p.name AS period_name, pr.name AS filiere_name
       FROM classes c
       JOIN academic_years ay ON ay.id = c.academic_year_id
       LEFT JOIN programmes pr ON pr.id = c.programme_id AND pr.tenant_id = c.tenant_id
       JOIN academic_year_periods p ON p.id = $3 AND p.tenant_id = c.tenant_id AND p.academic_year_id = c.academic_year_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [classId, tenantId, periodId]
    );

    if (metaQ.rows.length > 0) {
      metaRow = metaQ.rows[0];
    } else {
      const fallback = await client.query(
        `SELECT c.name AS class_name, ay.name AS year_name, pr.name AS filiere_name
         FROM classes c
         JOIN academic_years ay ON ay.id = c.academic_year_id
         LEFT JOIN programmes pr ON pr.id = c.programme_id AND pr.tenant_id = c.tenant_id
         WHERE c.id = $1 AND c.tenant_id = $2`,
        [classId, tenantId]
      );
      const periodOnly = await client.query(
        `SELECT name AS period_name FROM academic_year_periods WHERE id = $1 AND tenant_id = $2`,
        [periodId, tenantId]
      );
      metaRow = {
        ...fallback.rows[0],
        period_name: periodOnly.rows[0]?.period_name,
      };
    }

    return {
      className: metaRow?.class_name || "Classe",
      schoolYearName: metaRow?.year_name || "Annee scolaire",
      periodName: metaRow?.period_name || "Periode",
      filiereName: metaRow?.filiere_name || undefined,
    };
  }

  async function fetchReportCardCourses(
    client: any,
    tenantId: string,
    classId: string
  ): Promise<ReportCardCourse[]> {
    const result = await client.query(
      `SELECT
          c.id,
          c.code,
          c.name,
          COALESCE(c.coef, 1) AS coef,
          COALESCE(bt.name, 'Sans type de bilan') AS bilan_type_name
       FROM classes cl
       JOIN courses c ON c.programme_id = cl.programme_id AND c.tenant_id = cl.tenant_id
       LEFT JOIN bilan_types bt ON bt.id = c.bilan_type_id AND bt.tenant_id = c.tenant_id
       WHERE cl.id = $1 AND cl.tenant_id = $2
         AND cl.programme_id IS NOT NULL
       ORDER BY COALESCE(bt.name, 'Sans type de bilan') ASC, c.created_at DESC`,
      [classId, tenantId]
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      code: row.code || "",
      name: row.name,
      coef: Number(row.coef) || 1,
      bilanTypeName: row.bilan_type_name || "Sans type de bilan",
    }));
  }

  async function fetchReportCardStudents(
    client: any,
    tenantId: string,
    classId: string
  ): Promise<ReportCardStudent[]> {
    const result = await client.query(
      `SELECT
          se.student_id,
          sp.student_number,
          sp.date_of_birth,
          sp.place_of_birth,
          sp.nationality,
          u.first_name,
          u.last_name
       FROM student_enrollments se
       JOIN student_profiles sp ON sp.id = se.student_id
       JOIN users u ON u.id = sp.user_id
       WHERE se.class_id = $1 AND se.tenant_id = $2 AND se.status = 'active'
       ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST`,
      [classId, tenantId]
    );

    return result.rows.map((row: any) => ({
      studentId: row.student_id,
      studentNumber: row.student_number,
      firstName: row.first_name,
      lastName: row.last_name,
      dateOfBirth: row.date_of_birth,
      placeOfBirth: row.place_of_birth,
      nationality: row.nationality,
    }));
  }

  function computeWeightedStats(
    studentId: string,
    courses: ReportCardCourse[],
    averagesByStudent: Record<string, Record<string, number>>
  ): WeightedStats {
    let weightedTotal = 0;
    let totalCoef = 0;

    for (const course of courses) {
      const score = averagesByStudent[studentId]?.[course.id];
      if (score == null || Number.isNaN(score)) {
        continue;
      }

      weightedTotal += score * course.coef;
      totalCoef += course.coef;
    }

    return {
      totalCoef,
      weightedTotal,
      average: totalCoef > 0 ? weightedTotal / totalCoef : null,
    };
  }

  // GET /manual?classId=&courseId=&periodId=
  fastify.get("/manual", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }
    const q = request.query as { classId?: string; courseId?: string; periodId?: string };
    const parse = z
      .object({
        classId: z.string().uuid(),
        courseId: z.string().uuid(),
        periodId: z.string().uuid(),
      })
      .safeParse(q);
    if (!parse.success) {
      return reply.status(400).send({ error: "Validation Error", message: "classId, courseId et periodId sont requis" });
    }
    const { classId, courseId, periodId } = parse.data;

    const client = await fastify.pg.connect();
    try {
      const align = await assertClassPeriodAlignment(client, request.tenantId, classId, periodId);
      if (!align.ok) {
        return reply.status(400).send({ error: "Bad Request", message: align.message });
      }
      const inClass = await assertCourseInClass(client, request.tenantId, classId, courseId);
      if (!inClass) {
        return reply.status(400).send({ error: "Bad Request", message: "Cette matière n'est pas associée à cette classe." });
      }

      const studentsQ = `
        SELECT sp.id AS student_id, sp.student_number, u.first_name, u.last_name,
               a.average
        FROM student_enrollments se
        JOIN student_profiles sp ON sp.id = se.student_id
        JOIN users u ON u.id = sp.user_id
        LEFT JOIN student_period_course_averages a
          ON a.student_id = sp.id
         AND a.course_id = $3
         AND a.academic_year_period_id = $4
         AND a.tenant_id = $2
        WHERE se.class_id = $1 AND se.tenant_id = $2 AND se.status = 'active'
        ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST
      `;
      const res = await client.query(studentsQ, [classId, request.tenantId, courseId, periodId]);
      const students = res.rows.map((row: any) => ({
        studentId: row.student_id,
        studentNumber: row.student_number,
        firstName: row.first_name,
        lastName: row.last_name,
        average: row.average != null ? parseFloat(row.average) : null,
      }));

      return reply.send({ data: { students } });
    } catch (e) {
      fastify.log.error(`semester-averages manual GET: ${e}`);
      return reply.status(500).send({ error: "Internal Server Error", message: "Échec du chargement" });
    } finally {
      client.release();
    }
  });

  // PUT /manual
  fastify.put("/manual", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }
    let body: z.infer<typeof ManualGradesSchema>;
    try {
      body = ManualGradesSchema.parse(request.body);
    } catch (err: any) {
      return reply.status(400).send({ error: "Validation Error", message: err?.message || "Invalid body" });
    }

    const client = await fastify.pg.connect();
    try {
      await client.query("BEGIN");
      const align = await assertClassPeriodAlignment(client, request.tenantId, body.classId, body.periodId);
      if (!align.ok) {
        await client.query("ROLLBACK");
        return reply.status(400).send({ error: "Bad Request", message: align.message });
      }
      const inClass = await assertCourseInClass(client, request.tenantId, body.classId, body.courseId);
      if (!inClass) {
        await client.query("ROLLBACK");
        return reply.status(400).send({ error: "Bad Request", message: "Cette matière n'est pas associée à cette classe." });
      }

      const enrolled = await client.query(
        `SELECT student_id FROM student_enrollments WHERE class_id = $1 AND tenant_id = $2 AND status = 'active'`,
        [body.classId, request.tenantId]
      );
      const allowed = new Set(enrolled.rows.map((r: any) => r.student_id));

      for (const g of body.grades) {
        if (!allowed.has(g.studentId)) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Bad Request", message: `Étudiant non inscrit dans cette classe: ${g.studentId}` });
        }
        if (g.average === null) {
          await client.query(
            `DELETE FROM student_period_course_averages
             WHERE tenant_id = $1 AND academic_year_period_id = $2 AND student_id = $3 AND course_id = $4`,
            [request.tenantId, body.periodId, g.studentId, body.courseId]
          );
        } else {
          await client.query(
            `INSERT INTO student_period_course_averages (
               tenant_id, academic_year_period_id, class_id, student_id, course_id, average
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, academic_year_period_id, student_id, course_id)
             DO UPDATE SET average = EXCLUDED.average, class_id = EXCLUDED.class_id, updated_at = NOW()`,
            [request.tenantId, body.periodId, body.classId, g.studentId, body.courseId, g.average]
          );
        }
      }

      await client.query("COMMIT");
      return reply.send({ success: true });
    } catch (e) {
      await client.query("ROLLBACK");
      fastify.log.error(`semester-averages manual PUT: ${e}`);
      return reply.status(500).send({ error: "Internal Server Error", message: "Échec de l'enregistrement" });
    } finally {
      client.release();
    }
  });

  // GET /matrix?classId=&periodId=
  fastify.get("/matrix", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }
    const q = request.query as { classId?: string; periodId?: string };
    const parse = z.object({ classId: z.string().uuid(), periodId: z.string().uuid() }).safeParse(q);
    if (!parse.success) {
      return reply.status(400).send({ error: "Validation Error", message: "classId et periodId sont requis" });
    }
    const { classId, periodId } = parse.data;

    const client = await fastify.pg.connect();
    try {
      const align = await assertClassPeriodAlignment(client, request.tenantId, classId, periodId);
      if (!align.ok) {
        return reply.status(400).send({ error: "Bad Request", message: align.message });
      }

      const meta = await client.query(
        `SELECT c.name AS class_name, ay.name AS year_name, p.name AS period_name
         FROM classes c
         JOIN academic_years ay ON ay.id = c.academic_year_id
         JOIN academic_year_periods p ON p.id = $2 AND p.academic_year_id = c.academic_year_id
         WHERE c.id = $1 AND c.tenant_id = $3`,
        [classId, periodId, request.tenantId]
      );
      const m = meta.rows[0];

      const courses = await fetchMatrixCourses(client, request.tenantId, classId);

      const studentsQ = `
        SELECT sp.id AS student_id, sp.student_number,
               u.first_name, u.last_name
        FROM student_enrollments se
        JOIN student_profiles sp ON sp.id = se.student_id
        JOIN users u ON u.id = sp.user_id
        WHERE se.class_id = $1 AND se.tenant_id = $2 AND se.status = 'active'
        ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST
      `;
      const stRes = await client.query(studentsQ, [classId, request.tenantId]);
      const students = stRes.rows.map((row: any) => ({
        studentId: row.student_id,
        studentNumber: row.student_number,
        firstName: row.first_name,
        lastName: row.last_name,
      }));

      const avgQ = `
        SELECT student_id, course_id, average
        FROM student_period_course_averages
        WHERE tenant_id = $1 AND academic_year_period_id = $2 AND class_id = $3
      `;
      const avgRes = await client.query(avgQ, [request.tenantId, periodId, classId]);
      const averages: Record<string, Record<string, number>> = {};
      for (const row of avgRes.rows) {
        const sid = row.student_id;
        const cid = row.course_id;
        if (!averages[sid]) averages[sid] = {};
        averages[sid][cid] = parseFloat(row.average);
      }

      const attendanceQ = `
        SELECT student_id, absence_hours, justified_hours
        FROM student_period_attendance_summaries
        WHERE tenant_id = $1 AND academic_year_period_id = $2 AND class_id = $3
      `;
      const attendanceRes = await client.query(attendanceQ, [request.tenantId, periodId, classId]);
      const attendance: Record<string, { absenceHours: number; justifiedHours: number }> = {};
      for (const row of attendanceRes.rows) {
        attendance[row.student_id] = {
          absenceHours: parseFloat(row.absence_hours),
          justifiedHours: parseFloat(row.justified_hours),
        };
      }

      return reply.send({
        data: {
          className: m?.class_name,
          academicYearName: m?.year_name,
          periodName: m?.period_name,
          courses,
          students,
          averages,
          attendance,
        },
      });
    } catch (e) {
      fastify.log.error(`semester-averages matrix GET: ${e}`);
      return reply.status(500).send({ error: "Internal Server Error", message: "Échec du chargement" });
    } finally {
      client.release();
    }
  });

  // PUT /matrix
  fastify.put("/matrix", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }
    let body: z.infer<typeof MatrixUpsertSchema>;
    try {
      body = MatrixUpsertSchema.parse(request.body);
    } catch (err: any) {
      return reply.status(400).send({ error: "Validation Error", message: err?.message || "Invalid body" });
    }

    const client = await fastify.pg.connect();
    try {
      await client.query("BEGIN");
      const align = await assertClassPeriodAlignment(client, request.tenantId, body.classId, body.periodId);
      if (!align.ok) {
        await client.query("ROLLBACK");
        return reply.status(400).send({ error: "Bad Request", message: align.message });
      }

      const enrolled = await client.query(
        `SELECT student_id FROM student_enrollments WHERE class_id = $1 AND tenant_id = $2 AND status = 'active'`,
        [body.classId, request.tenantId]
      );
      const allowedStudents = new Set(enrolled.rows.map((r: any) => r.student_id));

      const allowedCourses = await fetchAllowedCourseIds(client, request.tenantId, body.classId);

      for (const cell of body.cells) {
        if (!allowedStudents.has(cell.studentId)) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Bad Request", message: "Étudiant non inscrit dans cette classe" });
        }
        if (!allowedCourses.has(cell.courseId)) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Bad Request", message: "Matière non associée à cette classe" });
        }
        if (cell.average === null) {
          await client.query(
            `DELETE FROM student_period_course_averages
             WHERE tenant_id = $1 AND academic_year_period_id = $2 AND student_id = $3 AND course_id = $4`,
            [request.tenantId, body.periodId, cell.studentId, cell.courseId]
          );
        } else {
          await client.query(
            `INSERT INTO student_period_course_averages (
               tenant_id, academic_year_period_id, class_id, student_id, course_id, average
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, academic_year_period_id, student_id, course_id)
             DO UPDATE SET average = EXCLUDED.average, class_id = EXCLUDED.class_id, updated_at = NOW()`,
            [request.tenantId, body.periodId, body.classId, cell.studentId, cell.courseId, cell.average]
          );
        }
      }

      for (const row of body.attendance) {
        if (!allowedStudents.has(row.studentId)) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Bad Request", message: "Etudiant non inscrit dans cette classe" });
        }

        const absenceHours = row.absenceHours ?? 0;
        const justifiedHours = row.justifiedHours ?? 0;
        if (justifiedHours > absenceHours) {
          await client.query("ROLLBACK");
          return reply.status(400).send({
            error: "Bad Request",
            message: "Les heures justifiees ne peuvent pas depasser les heures d'absence",
          });
        }

        if (row.absenceHours === null && row.justifiedHours === null) {
          await client.query(
            `DELETE FROM student_period_attendance_summaries
             WHERE tenant_id = $1 AND academic_year_period_id = $2 AND class_id = $3 AND student_id = $4`,
            [request.tenantId, body.periodId, body.classId, row.studentId]
          );
          continue;
        }

        await client.query(
          `INSERT INTO student_period_attendance_summaries (
             tenant_id, academic_year_period_id, class_id, student_id, absence_hours, justified_hours
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, academic_year_period_id, class_id, student_id)
           DO UPDATE SET
             absence_hours = EXCLUDED.absence_hours,
             justified_hours = EXCLUDED.justified_hours,
             updated_at = NOW()`,
          [request.tenantId, body.periodId, body.classId, row.studentId, absenceHours, justifiedHours]
        );
      }

      await client.query("COMMIT");
      return reply.send({ success: true, updated: body.cells.length, attendanceUpdated: body.attendance.length });
    } catch (e) {
      await client.query("ROLLBACK");
      fastify.log.error(`semester-averages matrix PUT: ${e}`);
      return reply.status(500).send({ error: "Internal Server Error", message: "Échec de l'enregistrement" });
    } finally {
      client.release();
    }
  });

  // POST /attendance-certificates/pdf
  fastify.post("/attendance-certificates/pdf", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }

    let body: z.infer<typeof AttendanceCertificatesSchema>;
    try {
      body = AttendanceCertificatesSchema.parse(request.body);
    } catch (err: any) {
      return reply.status(400).send({ error: "Validation Error", message: err?.message || "Invalid body" });
    }

    const client = await fastify.pg.connect();
    try {
      const align = await assertClassPeriodAlignment(client, request.tenantId, body.classId, body.periodId);
      if (!align.ok) {
        return reply.status(400).send({ error: "Bad Request", message: align.message });
      }

      let metaRow: { class_name?: string; year_name?: string; period_name?: string } | undefined;
      const metaQ = await client.query(
        `SELECT c.name AS class_name, ay.name AS year_name, p.name AS period_name
         FROM classes c
         JOIN academic_years ay ON ay.id = c.academic_year_id
         JOIN academic_year_periods p ON p.id = $3 AND p.tenant_id = c.tenant_id AND p.academic_year_id = c.academic_year_id
         WHERE c.id = $1 AND c.tenant_id = $2`,
        [body.classId, request.tenantId, body.periodId]
      );
      if (metaQ.rows.length > 0) {
        metaRow = metaQ.rows[0];
      } else {
        const fallback = await client.query(
          `SELECT c.name AS class_name, ay.name AS year_name
           FROM classes c
           JOIN academic_years ay ON ay.id = c.academic_year_id
           WHERE c.id = $1 AND c.tenant_id = $2`,
          [body.classId, request.tenantId]
        );
        const periodOnly = await client.query(
          `SELECT name AS period_name FROM academic_year_periods WHERE id = $1 AND tenant_id = $2`,
          [body.periodId, request.tenantId]
        );
        metaRow = {
          ...fallback.rows[0],
          period_name: periodOnly.rows[0]?.period_name,
        };
      }

      const className = metaRow?.class_name || "Classe";
      const schoolYearName = metaRow?.year_name || "Année scolaire";
      const periodName = metaRow?.period_name ?? null;

      const studentsQ = await client.query(
        `SELECT sp.student_number, sp.date_of_birth, sp.place_of_birth, sp.father_name, sp.mother_name, sp.scholarship_level,
                u.first_name, u.last_name
         FROM student_enrollments se
         JOIN student_profiles sp ON sp.id = se.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE se.class_id = $1 AND se.tenant_id = $2 AND se.status = 'active'
           AND ($3::uuid IS NULL OR se.student_id = $3)
         ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST`,
        [body.classId, request.tenantId, body.studentId ?? null]
      );

      if (studentsQ.rows.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Aucun élève actif trouvé dans cette classe.",
        });
      }

      let pdf: Buffer;
      try {
        pdf = await generateAttendanceCertificatesPdfFromWordTemplate(
          studentsQ.rows.map((row: any) => ({
            firstName: row.first_name,
            lastName: row.last_name,
            studentNumber: row.student_number,
            dateOfBirth: row.date_of_birth,
            placeOfBirth: row.place_of_birth,
            fatherName: row.father_name,
            motherName: row.mother_name,
            scholarshipLevel: row.scholarship_level,
          })),
          { schoolYearName, className, periodName },
          {
            log: {
              info: (m) => fastify.log.info(m),
              warn: (m) => fastify.log.warn(m),
              error: (m) => fastify.log.error(m),
            },
          }
        );
      } catch (genErr: any) {
        const msg = genErr?.message || String(genErr);
        if (
          msg.includes("Modèle Word introuvable") ||
          msg.includes("Modele.docx") ||
          msg.includes("LibreOffice") ||
          msg.includes("fidèle au modèle")
        ) {
          return reply.status(400).send({
            error: "Bad Request",
            message: msg,
          });
        }
        throw genErr;
      }

      const safeClass = String(className).replace(/[\\/:*?"<>|]/g, "-");
      const safeYear = String(schoolYearName).replace(/[\\/:*?"<>|]/g, "-");

      return reply
        .type("application/pdf")
        .header(
          "Content-Disposition",
          `inline; filename=\"attestations-frequentation-${safeClass}-${safeYear}.pdf\"`
        )
        .send(pdf);
    } catch (e) {
      fastify.log.error(`semester-averages attendance-certificates POST: ${e}`);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: e instanceof Error ? e.message : "Échec de la génération des attestations",
      });
    } finally {
      client.release();
    }
  });

  // POST /attendance-certificates/pdf-html
  fastify.post("/attendance-certificates/pdf-html", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }

    let body: z.infer<typeof AttendanceCertificatesSchema>;
    try {
      body = AttendanceCertificatesSchema.parse(request.body);
    } catch (err: any) {
      return reply.status(400).send({ error: "Validation Error", message: err?.message || "Invalid body" });
    }

    const client = await fastify.pg.connect();
    try {
      const align = await assertClassPeriodAlignment(client, request.tenantId, body.classId, body.periodId);
      if (!align.ok) {
        return reply.status(400).send({ error: "Bad Request", message: align.message });
      }

      let metaRow: { class_name?: string; year_name?: string; period_name?: string } | undefined;
      const metaQ = await client.query(
        `SELECT c.name AS class_name, ay.name AS year_name, p.name AS period_name
         FROM classes c
         JOIN academic_years ay ON ay.id = c.academic_year_id
         JOIN academic_year_periods p ON p.id = $3 AND p.tenant_id = c.tenant_id AND p.academic_year_id = c.academic_year_id
         WHERE c.id = $1 AND c.tenant_id = $2`,
        [body.classId, request.tenantId, body.periodId]
      );
      if (metaQ.rows.length > 0) {
        metaRow = metaQ.rows[0];
      } else {
        const fallback = await client.query(
          `SELECT c.name AS class_name, ay.name AS year_name
           FROM classes c
           JOIN academic_years ay ON ay.id = c.academic_year_id
           WHERE c.id = $1 AND c.tenant_id = $2`,
          [body.classId, request.tenantId]
        );
        const periodOnly = await client.query(
          `SELECT name AS period_name FROM academic_year_periods WHERE id = $1 AND tenant_id = $2`,
          [body.periodId, request.tenantId]
        );
        metaRow = {
          ...fallback.rows[0],
          period_name: periodOnly.rows[0]?.period_name,
        };
      }

      const className = metaRow?.class_name || "Classe";
      const schoolYearName = metaRow?.year_name || "Annee scolaire";
      const periodName = metaRow?.period_name ?? null;

      const studentsQ = await client.query(
        `SELECT sp.student_number, sp.date_of_birth, sp.place_of_birth, sp.father_name, sp.mother_name, sp.scholarship_level,
                u.first_name, u.last_name
         FROM student_enrollments se
         JOIN student_profiles sp ON sp.id = se.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE se.class_id = $1 AND se.tenant_id = $2 AND se.status = 'active'
           AND ($3::uuid IS NULL OR se.student_id = $3)
         ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST`,
        [body.classId, request.tenantId, body.studentId ?? null]
      );

      if (studentsQ.rows.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Aucun eleve actif trouve dans cette classe.",
        });
      }

      const pdf = await generateAttendanceCertificatesPdfFromHtml(
        studentsQ.rows.map((row: any) => ({
          firstName: row.first_name,
          lastName: row.last_name,
          studentNumber: row.student_number,
          dateOfBirth: row.date_of_birth,
          placeOfBirth: row.place_of_birth,
          fatherName: row.father_name,
          motherName: row.mother_name,
          scholarshipLevel: row.scholarship_level,
        })),
        { schoolYearName, className, periodName },
        {
          log: {
            info: (m) => fastify.log.info(m),
            warn: (m) => fastify.log.warn(m),
            error: (m) => fastify.log.error(m),
          },
        }
      );

      const safeClass = String(className).replace(/[\\/:*?"<>|]/g, "-");
      const safeYear = String(schoolYearName).replace(/[\\/:*?"<>|]/g, "-");

      return reply
        .type("application/pdf")
        .header(
          "Content-Disposition",
          `inline; filename=\"attestations-frequentation-html-${safeClass}-${safeYear}.pdf\"`
        )
        .send(pdf);
    } catch (e) {
      fastify.log.error(`semester-averages attendance-certificates HTML POST: ${e}`);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: e instanceof Error ? e.message : "Echec de la generation HTML des attestations",
      });
    } finally {
      client.release();
    }
  });

  // POST /report-cards/pdf
  fastify.post("/report-cards/pdf", async (request, reply) => {
    if (!request.tenantId) {
      return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
    }

    let body: z.infer<typeof AttendanceCertificatesSchema>;
    try {
      body = AttendanceCertificatesSchema.parse(request.body);
    } catch (err: any) {
      return reply.status(400).send({ error: "Validation Error", message: err?.message || "Invalid body" });
    }

    const client = await fastify.pg.connect();
    try {
      const align = await assertClassPeriodAlignment(client, request.tenantId, body.classId, body.periodId);
      if (!align.ok) {
        return reply.status(400).send({ error: "Bad Request", message: align.message });
      }

      const meta = await fetchClassPeriodMeta(client, request.tenantId, body.classId, body.periodId);
      const courses = await fetchReportCardCourses(client, request.tenantId, body.classId);
      if (courses.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Aucune matiere trouvee pour cette classe. Verifiez le programme et les types de bilan.",
        });
      }

      const students = await fetchReportCardStudents(client, request.tenantId, body.classId);
      if (students.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Aucun eleve actif trouve dans cette classe.",
        });
      }

      if (body.studentId && !students.some((student) => student.studentId === body.studentId)) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Cet eleve n'est pas actif dans la classe selectionnee.",
        });
      }

      const averagesResult = await client.query(
        `SELECT student_id, course_id, average
         FROM student_period_course_averages
         WHERE tenant_id = $1 AND academic_year_period_id = $2 AND class_id = $3`,
        [request.tenantId, body.periodId, body.classId]
      );

      const averagesByStudent: Record<string, Record<string, number>> = {};
      for (const row of averagesResult.rows) {
        if (!averagesByStudent[row.student_id]) {
          averagesByStudent[row.student_id] = {};
        }
        averagesByStudent[row.student_id][row.course_id] = parseFloat(row.average);
      }

      const attendanceResult = await client.query(
        `SELECT student_id, absence_hours, justified_hours
         FROM student_period_attendance_summaries
         WHERE tenant_id = $1 AND academic_year_period_id = $2 AND class_id = $3`,
        [request.tenantId, body.periodId, body.classId]
      );
      const attendanceByStudent: Record<string, { absenceHours: number; justifiedHours: number }> = {};
      for (const row of attendanceResult.rows) {
        attendanceByStudent[row.student_id] = {
          absenceHours: parseFloat(row.absence_hours),
          justifiedHours: parseFloat(row.justified_hours),
        };
      }

      const courseRanksById: Record<string, Record<string, number | null>> = {};
      for (const course of courses) {
        courseRanksById[course.id] = computeCompetitionRanks(
          students.map((student) => ({
            key: student.studentId,
            score: averagesByStudent[student.studentId]?.[course.id] ?? null,
          }))
        );
      }

      const coursesBySection = new Map<string, ReportCardCourse[]>();
      for (const course of courses) {
        const sectionName = course.bilanTypeName || "Sans type de bilan";
        const existing = coursesBySection.get(sectionName);
        if (existing) {
          existing.push(course);
        } else {
          coursesBySection.set(sectionName, [course]);
        }
      }

      const sectionOrder = Array.from(coursesBySection.keys());
      const sectionStatsByName: Record<string, Record<string, WeightedStats>> = {};
      const sectionRanksByName: Record<string, Record<string, number | null>> = {};

      for (const sectionName of sectionOrder) {
        const sectionCourses = coursesBySection.get(sectionName) || [];
        const statsByStudent: Record<string, WeightedStats> = {};
        const rankEntries = students.map((student) => {
          const stats = computeWeightedStats(student.studentId, sectionCourses, averagesByStudent);
          statsByStudent[student.studentId] = stats;
          return {
            key: student.studentId,
            score: stats.average,
          };
        });

        sectionStatsByName[sectionName] = statsByStudent;
        sectionRanksByName[sectionName] = computeCompetitionRanks(rankEntries);
      }

      const overallStatsByStudent: Record<string, WeightedStats> = {};
      const overallRanks = computeCompetitionRanks(
        students.map((student) => {
          const stats = computeWeightedStats(student.studentId, courses, averagesByStudent);
          overallStatsByStudent[student.studentId] = stats;
          return {
            key: student.studentId,
            score: stats.average,
          };
        })
      );

      const periodRows = await client.query(
        `SELECT id, name, start_date, end_date, created_at
         FROM academic_year_periods
         WHERE tenant_id = $1
           AND academic_year_id = (
             SELECT academic_year_id FROM classes WHERE id = $2 AND tenant_id = $1
           )
         ORDER BY COALESCE(start_date, created_at) ASC, created_at ASC`,
        [request.tenantId, body.classId]
      );

      const normalize = (v: string) =>
        String(v || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toUpperCase();

      const currentPeriodRow = periodRows.rows.find((p: any) => p.id === body.periodId);
      const currentPeriodNormalized = normalize(currentPeriodRow?.name || "");
      const isSecondSemester =
        currentPeriodNormalized.includes("SEMESTRE 2") ||
        currentPeriodNormalized.includes("DEUXIEME SEMESTRE");
      const isSecondYearBts = isSecondYearBtsClass(meta.className);

      let firstSemesterPeriodId: string | null = null;
      if (isSecondSemester) {
        const sem1ByName = periodRows.rows.find((p: any) => normalize(p.name || "").includes("SEMESTRE 1"));
        if (sem1ByName) {
          firstSemesterPeriodId = sem1ByName.id;
        } else {
          const currentIndex = periodRows.rows.findIndex((p: any) => p.id === body.periodId);
          if (currentIndex > 0) {
            firstSemesterPeriodId = periodRows.rows[currentIndex - 1].id;
          }
        }
      }

      const sem1AveragesByStudent: Record<string, Record<string, number>> = {};
      if (firstSemesterPeriodId) {
        const sem1AveragesResult = await client.query(
          `SELECT student_id, course_id, average
           FROM student_period_course_averages
           WHERE tenant_id = $1 AND academic_year_period_id = $2 AND class_id = $3`,
          [request.tenantId, firstSemesterPeriodId, body.classId]
        );
        for (const row of sem1AveragesResult.rows) {
          if (!sem1AveragesByStudent[row.student_id]) {
            sem1AveragesByStudent[row.student_id] = {};
          }
          sem1AveragesByStudent[row.student_id][row.course_id] = parseFloat(row.average);
        }
      }

      const sem1OverallByStudent: Record<string, number | null> = {};
      const annualAverageByStudent: Record<string, number | null> = {};
      for (const student of students) {
        const sem1Stats = computeWeightedStats(student.studentId, courses, sem1AveragesByStudent);
        const sem2Stats = overallStatsByStudent[student.studentId] || {
          totalCoef: 0,
          weightedTotal: 0,
          average: null,
        };
        sem1OverallByStudent[student.studentId] = sem1Stats.average;

        if (isSecondSemester && sem1Stats.average != null && sem2Stats.average != null) {
          annualAverageByStudent[student.studentId] = (sem1Stats.average + sem2Stats.average * 2) / 3;
        } else {
          annualAverageByStudent[student.studentId] = sem2Stats.average;
        }
      }

      const annualRanks = computeCompetitionRanks(
        students.map((student) => ({
          key: student.studentId,
          score: annualAverageByStudent[student.studentId] ?? null,
        }))
      );

      const selectedStudents = body.studentId
        ? students.filter((student) => student.studentId === body.studentId)
        : students;

      const documents: ReportCardDocumentInput[] = selectedStudents.map((student) => {
        const sections: ReportCardSection[] = sectionOrder.map((sectionName) => {
          const sectionCourses = coursesBySection.get(sectionName) || [];
          const lines: ReportCardSubjectLine[] = sectionCourses.map((course) => {
            const average = averagesByStudent[student.studentId]?.[course.id] ?? null;
            return {
              courseName: course.name,
              courseCode: course.code || null,
              coef: course.coef,
              average,
              weightedScore: average != null ? average * course.coef : null,
              rank: courseRanksById[course.id]?.[student.studentId] ?? null,
              appreciation: buildAverageMention(average),
            };
          });

          const stats = sectionStatsByName[sectionName]?.[student.studentId] || {
            totalCoef: 0,
            weightedTotal: 0,
            average: null,
          };

          return {
            bilanTypeName: sectionName,
            lines,
            totalCoef: stats.totalCoef,
            weightedTotal: stats.weightedTotal,
            average: stats.average,
            rank: sectionRanksByName[sectionName]?.[student.studentId] ?? null,
            appreciation: buildAverageMention(stats.average),
          };
        });

        const overallStats = overallStatsByStudent[student.studentId] || {
          totalCoef: 0,
          weightedTotal: 0,
          average: null,
        };
        const sem1Average = sem1OverallByStudent[student.studentId] ?? null;
        const sem2Average = overallStats.average;
        const annualAverage = annualAverageByStudent[student.studentId] ?? sem2Average;
        const annualRank = annualRanks[student.studentId] ?? null;
        const distinctionSanctions = buildDistinctionSanctionsFromAverage(annualAverage);
        const councilAppreciation = buildCouncilAppreciationFromAverage(annualAverage);
        const endYearDecision = buildEndYearDecision(annualAverage, {
          isSecondSemester,
          isSecondYearBts,
        });
        const assignmentFlags = buildAssignmentFlagsFromDecision(endYearDecision);
        const attendance = attendanceByStudent[student.studentId];
        const attendanceSummary = buildAttendanceSummary(
          attendance?.absenceHours ?? null,
          attendance?.justifiedHours ?? null
        );

        return {
          student,
          schoolYearName: meta.schoolYearName,
          className: meta.className,
          filiereName: meta.filiereName,
          periodName: meta.periodName,
          sections,
          summary: {
            totalCoef: overallStats.totalCoef,
            weightedTotal: overallStats.weightedTotal,
            overallAverage: overallStats.average,
            rank: overallRanks[student.studentId] ?? null,
            totalStudents: students.length,
            mention: buildAverageMention(overallStats.average),
            decision: buildCouncilDecision(overallStats.average),
            firstSemesterAverage: sem1Average,
            secondSemesterAverage: sem2Average,
            annualAverage,
            annualRank,
            distinctionSanctions,
            attendanceSummary,
            councilAppreciation,
            endYearDecision,
            affected: assignmentFlags.affected,
            repeating: assignmentFlags.repeating,
          },
        };
      });

      const pdf = await generateReportCardsPdfFromHtml(documents, {
        log: {
          info: (message) => fastify.log.info(message),
          warn: (message) => fastify.log.warn(message),
          error: (message) => fastify.log.error(message),
        },
      });

      const safeClass = sanitizeFilenamePart(meta.className);
      const safePeriod = sanitizeFilenamePart(meta.periodName);
      const fileName =
        documents.length === 1
          ? `bulletin-${sanitizeFilenamePart(
              documents[0].student.studentNumber ||
                `${documents[0].student.lastName ?? ""}-${documents[0].student.firstName ?? ""}`
            )}-${safePeriod}.pdf`
          : `bulletins-${safeClass}-${safePeriod}.pdf`;

      return reply
        .type("application/pdf")
        .header("Content-Disposition", `inline; filename=\"${fileName}\"`)
        .send(pdf);
    } catch (e) {
      fastify.log.error(`semester-averages report-cards POST: ${e}`);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: e instanceof Error ? e.message : "Echec de la generation des bulletins",
      });
    } finally {
      client.release();
    }
  });
}
