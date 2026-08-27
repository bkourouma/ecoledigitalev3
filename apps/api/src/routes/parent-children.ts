import { FastifyInstance } from "fastify";
import { z } from "zod";

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    roles?: string[];
  };
  headers?: any;
  query?: any;
  params?: any;
  body?: any;
}

// Verify parent-child relationship utility
async function verifyParentChildRelationship(
  pool: any,
  parentId: string,
  childId: string,
  tenantId: string
): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM student_parents 
     WHERE parent_id = $1 AND student_id = $2 AND tenant_id = $3`,
    [parentId, childId, tenantId]
  );
  return result.rows.length > 0;
}

/**
 * Emploi du temps du module professionnel, décliné en dates réelles.
 *
 * Les élèves du module professionnel n'ont ni `student_enrollments` ni
 * `session_instances` : leurs cours vivent dans `professional_ecue_seances`,
 * projection datée de la grille hebdomadaire `professional_emploi_temps`
 * (cf. owner-assiduite.service.ts : la grille = le PLANIFIÉ, les séances = les
 * occurrences réelles). On lit donc les séances, qui portent déjà la date,
 * l'horaire, l'enseignant et le statut.
 *
 * Retourne des lignes au même format que la requête « classique » du portail
 * parent, pour que les deux sources se concatènent sans conversion.
 */
async function fetchProfessionalSchedule(
  pool: any,
  options: {
    tenantId: string;
    childId: string;
    fromDate: string;
    toDate: string;
    limit?: number;
  }
): Promise<any[]> {
  const { tenantId, childId, fromDate, toDate, limit } = options;

  const result = await pool.query(
    `SELECT
       s.id,
       s.date::text          AS date,
       s.heure_debut::text   AS start_time,
       s.heure_fin::text     AS end_time,
       e.libelle             AS course_name,
       e.code                AS course_code,
       COALESCE(cr.name, grille.classroom_name) AS classroom,
       NULLIF(BTRIM(t.first_name || ' ' || t.last_name), '') AS teacher_name
     FROM professional_ecue_seances s
     -- Une séance concerne l'élève s'il est inscrit à la cohorte (session d'UE).
     JOIN professional_enrollments en
       ON en.ue_session_id = s.ue_session_id
      AND en.tenant_id = s.tenant_id
      AND en.student_id = $1
      AND en.statut IN ('confirmee', 'terminee')
     JOIN professional_ecue e ON e.id = s.ecue_id
     LEFT JOIN teachers t ON t.id = s.enseignant_id
     LEFT JOIN classrooms cr ON cr.id = s.classroom_id
     -- La salle n'est le plus souvent saisie que sur la grille hebdomadaire :
     -- on la rapproche par (cohorte, ECUE, jour de semaine, heure de début).
     LEFT JOIN LATERAL (
       SELECT c2.name AS classroom_name
       FROM professional_emploi_temps et
       JOIN classrooms c2 ON c2.id = et.classroom_id
       WHERE et.tenant_id = s.tenant_id
         AND et.ue_session_id = s.ue_session_id
         AND et.ecue_id = s.ecue_id
         AND et.jour = EXTRACT(ISODOW FROM s.date)
         AND et.heure_debut = s.heure_debut
       LIMIT 1
     ) grille ON TRUE
     WHERE s.tenant_id = $2
       AND s.date >= $3::date
       AND s.date <= $4::date
       AND s.statut <> 'annulee'
       -- La Conduite est une note de comportement, pas une matière : elle est
       -- exclue de l'emploi du temps (même règle que le portail étudiant,
       -- cf. ProfessionalEmploiTempsService.listStudentEmploiTemps).
       AND NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
     ORDER BY s.date ASC, s.heure_debut ASC
     ${limit ? `LIMIT ${Number(limit)}` : ''}`,
    [childId, tenantId, fromDate, toDate]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    courseName: row.course_name,
    courseCode: row.course_code,
    classroom: row.classroom,
    teacherName: row.teacher_name,
  }));
}

/**
 * Clé de tri commune aux deux sources : le portail « classique » renvoie une
 * Date (colonne `date`), le module professionnel une chaîne `YYYY-MM-DD`.
 */
function scheduleSortKey(item: { date: any; startTime?: string }): string {
  const date =
    item.date instanceof Date
      ? item.date.toISOString().split('T')[0]
      : String(item.date ?? '').split('T')[0];
  return `${date} ${item.startTime ?? ''}`;
}

export async function parentChildrenRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/children - List all children linked to the authenticated parent
  fastify.get('/', {
    schema: {
      tags: ['Parent Children'],
      summary: 'List all children linked to the authenticated parent',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                children: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      currentYear: { type: 'number' },
                      status: { type: 'string', enum: ['active', 'suspended', 'dropped', 'transfer', 'graduated'] },
                      studentNumber: { type: 'string' },
                      professionalMatricule: { type: 'string', nullable: true },
                      summaryIndicator: {
                        type: 'object',
                        properties: {
                          gradeAverage: { type: 'number', nullable: true },
                          attendanceStatus: { type: 'string', enum: ['good', 'warning'], nullable: true },
                        },
                      },
                    },
                  },
                },
                total: { type: 'number' },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query children linked to parent via student_parents
        const childrenQuery = `
          SELECT 
            sp.id,
            sp.current_year,
            sp.status,
            sp.student_number,
            pm.matricule AS professional_matricule,
            u.id as user_id,
            u.first_name,
            u.last_name,
            u.email,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as name
          FROM student_parents sp_rel
          JOIN student_profiles sp ON sp_rel.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          -- Matricule IPAM (IPAM<CODE FILIÈRE><NNN>) du module professionnel :
          -- un par filière, on expose le plus récent quand il y en a plusieurs.
          LEFT JOIN LATERAL (
            SELECT psm.matricule
            FROM professional_student_matricules psm
            WHERE psm.student_id = sp.id
              AND psm.tenant_id = sp.tenant_id
            ORDER BY psm.created_at DESC, psm.seq DESC
            LIMIT 1
          ) pm ON TRUE
          WHERE sp_rel.parent_id = $1
            AND sp_rel.tenant_id = $2
            AND (
              $3::uuid IS NULL
              OR EXISTS (
                SELECT 1
                FROM student_enrollments se_ay
                JOIN classes cl_ay ON cl_ay.id = se_ay.class_id
                WHERE se_ay.student_id = sp.id
                  AND se_ay.tenant_id = sp.tenant_id
                  AND se_ay.status = 'active'
                  AND cl_ay.academic_year_id = $3::uuid
              )
              -- Élèves inscrits en module professionnel : ils n'ont pas de
              -- student_enrollments classiques, mais restent des enfants du
              -- parent quelle que soit l'année académique sélectionnée.
              OR EXISTS (
                SELECT 1
                FROM professional_enrollments pe
                WHERE pe.student_id = sp.id
                  AND pe.tenant_id = sp.tenant_id
                  AND pe.statut IN ('confirmee', 'terminee')
              )
            )
          ORDER BY u.last_name, u.first_name
        `;

        const childrenResult = await pool.query(childrenQuery, [userId, tenantId, activeAcademicYearId || null]);

        // Get summary indicators for each child (grade average and attendance status)
        const children = await Promise.all(
          childrenResult.rows.map(async (row: any) => {
            const studentId = row.id;

            // Get grade average (all-time)
            const gradeQuery = `
              SELECT AVG(COALESCE(s.final_score, s.manual_score)) as average_grade
              FROM assignment_submissions s
              WHERE s.student_id = $1
                AND s.tenant_id = $2
                AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
            `;
            const gradeResult = await pool.query(gradeQuery, [studentId, tenantId]);
            const gradeAverage = gradeResult.rows[0]?.average_grade 
              ? parseFloat(gradeResult.rows[0].average_grade) 
              : null;

            // Get recent attendance status (last 30 days)
            const attendanceQuery = `
              SELECT 
                COUNT(*) FILTER (WHERE sa.attendance_status IN ('absent', 'late')) as warning_count,
                COUNT(*) FILTER (WHERE sa.attendance_status = 'present') as present_count
              FROM student_attendance sa
              WHERE sa.student_id = $1
                AND sa.tenant_id = $2
                AND sa.marked_at >= NOW() - INTERVAL '30 days'
            `;
            const attendanceResult = await pool.query(attendanceQuery, [studentId, tenantId]);
            const warningCount = parseInt(attendanceResult.rows[0]?.warning_count || '0');
            const presentCount = parseInt(attendanceResult.rows[0]?.present_count || '0');
            const totalRecent = warningCount + presentCount;
            
            // Determine attendance status: warning if more than 20% absences/late in last 30 days
            const attendanceStatus = totalRecent > 0 && (warningCount / totalRecent) > 0.2 
              ? 'warning' 
              : totalRecent > 0 
                ? 'good' 
                : null;

            return {
              id: row.id,
              name: row.name || `${row.first_name} ${row.last_name}`,
              email: row.email,
              currentYear: row.current_year,
              status: row.status,
              studentNumber: row.student_number,
              professionalMatricule: row.professional_matricule ?? null,
              summaryIndicator: {
                gradeAverage: gradeAverage ? Math.round(gradeAverage * 100) / 100 : null,
                attendanceStatus: attendanceStatus,
              },
            };
          })
        );

        return reply.send({
          success: true,
          data: {
            children,
            total: children.length,
          },
        });
      } catch (error) {
        fastify.log.error({
          msg: 'Error fetching parent children',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
          tenantId,
        }, 'Failed to fetch children list');
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching children list',
        });
      }
    },
  });

  // GET /api/v1/parent/children/:childId - Get child details
  fastify.get('/:childId', {
    schema: {
      tags: ['Parent Children'],
      summary: 'Get child details',
      params: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
        required: ['childId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                child: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                    currentYear: { type: 'number' },
                    status: { type: 'string', enum: ['active', 'suspended', 'dropped', 'transfer', 'graduated'] },
                    studentNumber: { type: 'string' },
                    dateOfBirth: { type: 'string', nullable: true },
                    phone: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { childId } = request.params as { childId: string };
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship
        const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
        if (!relationshipExists) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Query child details
        const childQuery = `
          SELECT 
            sp.id,
            sp.current_year,
            sp.status,
            sp.student_number,
            sp.date_of_birth,
            sp.phone,
            u.id as user_id,
            u.first_name,
            u.last_name,
            u.email,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as name
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.id = $1
            AND sp.tenant_id = $2
            AND (
              $3::uuid IS NULL
              OR EXISTS (
                SELECT 1
                FROM student_enrollments se_ay
                JOIN classes cl_ay ON cl_ay.id = se_ay.class_id
                WHERE se_ay.student_id = sp.id
                  AND se_ay.tenant_id = sp.tenant_id
                  AND se_ay.status = 'active'
                  AND cl_ay.academic_year_id = $3::uuid
              )
              -- Élèves inscrits en module professionnel : ils n'ont pas de
              -- student_enrollments classiques, mais restent des enfants du
              -- parent quelle que soit l'année académique sélectionnée.
              OR EXISTS (
                SELECT 1
                FROM professional_enrollments pe
                WHERE pe.student_id = sp.id
                  AND pe.tenant_id = sp.tenant_id
                  AND pe.statut IN ('confirmee', 'terminee')
              )
            )
        `;

        const childResult = await pool.query(childQuery, [childId, tenantId, activeAcademicYearId || null]);

        if (childResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Child not found',
          });
        }

        const row = childResult.rows[0];

        return reply.send({
          success: true,
          data: {
            child: {
              id: row.id,
              name: row.name || `${row.first_name} ${row.last_name}`,
              email: row.email,
              currentYear: row.current_year,
              status: row.status,
              studentNumber: row.student_number,
              dateOfBirth: row.date_of_birth ? row.date_of_birth.toISOString().split('T')[0] : null,
              phone: row.phone,
            },
          },
        });
      } catch (error) {
        fastify.log.error({
          msg: 'Error fetching child details',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
          childId,
          tenantId,
        }, 'Failed to fetch child details');
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching child details',
        });
      }
    },
  });

  // GET /api/v1/parent/children/:childId/grades-summary - Get grades summary for a child
  fastify.get('/:childId/grades-summary', {
    schema: {
      tags: ['Parent Children'],
      summary: 'Get grades summary for a child',
      params: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
        required: ['childId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                gradesSummary: {
                  type: 'object',
                  properties: {
                    averageGrade: { type: 'number' },
                    totalAssignments: { type: 'number' },
                    gradedAssignments: { type: 'number' },
                    bestScore: { type: 'number' },
                    gradeDistribution: {
                      type: 'object',
                      properties: {
                        excellent: { type: 'number' },
                        good: { type: 'number' },
                        average: { type: 'number' },
                        belowAverage: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { childId } = request.params as { childId: string };
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship
        const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
        if (!relationshipExists) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Query all graded assignments for the child (all-time)
        const gradesQuery = `
          SELECT 
            s.id,
            COALESCE(s.final_score, s.manual_score) as grade,
            s.status
          FROM assignment_submissions s
          WHERE s.student_id = $1
            AND s.tenant_id = $2
            AND (s.final_score IS NOT NULL OR s.manual_score IS NOT NULL)
            AND (
              $3::uuid IS NULL
              OR EXISTS (
                SELECT 1
                FROM assignment_instances ai
                JOIN classes cl ON cl.id = ai.class_id
                WHERE ai.assignment_id = s.assignment_id
                  AND ai.tenant_id = s.tenant_id
                  AND cl.academic_year_id = $3::uuid
              )
            )
          ORDER BY s.graded_at DESC NULLS LAST, s.submitted_at DESC
        `;

        const gradesResult = await pool.query(gradesQuery, [childId, tenantId, activeAcademicYearId || null]);
        const grades = gradesResult.rows.map((row: any) => ({
          grade: parseFloat(row.grade) || 0,
          status: row.status,
        }));

        // Query total assignments (including ungraded)
        const totalAssignmentsQuery = `
          SELECT COUNT(*) as total
          FROM assignment_submissions s
          WHERE s.student_id = $1
            AND s.tenant_id = $2
            AND (
              $3::uuid IS NULL
              OR EXISTS (
                SELECT 1
                FROM assignment_instances ai
                JOIN classes cl ON cl.id = ai.class_id
                WHERE ai.assignment_id = s.assignment_id
                  AND ai.tenant_id = s.tenant_id
                  AND cl.academic_year_id = $3::uuid
              )
            )
        `;

        const totalResult = await pool.query(totalAssignmentsQuery, [childId, tenantId, activeAcademicYearId || null]);
        const totalAssignments = parseInt(totalResult.rows[0]?.total || '0');

        // Calculate statistics
        const gradedAssignments = grades.length;
        const averageGrade = gradedAssignments > 0
          ? grades.reduce((sum, g) => sum + g.grade, 0) / gradedAssignments
          : 0;
        const bestScore = gradedAssignments > 0
          ? Math.max(...grades.map(g => g.grade))
          : 0;

        // Calculate grade distribution (based on 0-20 scale)
        const gradeDistribution = {
          excellent: grades.filter(g => g.grade >= 16).length,
          good: grades.filter(g => g.grade >= 14 && g.grade < 16).length,
          average: grades.filter(g => g.grade >= 12 && g.grade < 14).length,
          belowAverage: grades.filter(g => g.grade < 12).length,
        };

        return reply.send({
          success: true,
          data: {
            gradesSummary: {
              averageGrade: Math.round(averageGrade * 100) / 100,
              totalAssignments,
              gradedAssignments,
              bestScore: Math.round(bestScore * 100) / 100,
              gradeDistribution,
            },
          },
        });
      } catch (error) {
        fastify.log.error({
          msg: 'Error fetching grades summary',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
          childId,
          tenantId,
        }, 'Failed to fetch grades summary');
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching grades summary',
        });
      }
    },
  });

  // GET /api/v1/parent/children/:childId/schedule - Get weekly schedule for a child
  fastify.get('/:childId/schedule', {
    schema: {
      tags: ['Parent Children'],
      summary: 'Get weekly schedule for a child',
      params: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
        required: ['childId'],
      },
      querystring: {
        type: 'object',
        properties: {
          week: { type: 'string', description: 'Week date in ISO format (YYYY-MM-DD) or week number' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                schedule: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      date: { type: 'string' },
                      startTime: { type: 'string' },
                      endTime: { type: 'string' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string' },
                      classroom: { type: 'string', nullable: true },
                      teacherName: { type: 'string', nullable: true },
                    },
                  },
                },
                weekStart: { type: 'string' },
                weekEnd: { type: 'string' },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { childId } = request.params as { childId: string };
      const { week } = request.query as { week?: string };
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship
        const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
        if (!relationshipExists) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Calculate week start and end dates
        // Use local date to avoid timezone issues (same as upcoming-classes)
        let weekStart: Date;
        let weekEnd: Date;

        // Helper function to get Monday of a week using local date
        const getMonday = (date: Date): Date => {
          const year = date.getFullYear();
          const month = date.getMonth();
          const day = date.getDate();
          const dayOfWeek = date.getDay();
          // Calculate days to subtract to get to Monday (0 = Sunday, 1 = Monday, etc.)
          const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          const mondayDate = day - daysToMonday;
          const monday = new Date(year, month, mondayDate, 0, 0, 0, 0);
          return monday;
        };

        if (week) {
          // Parse week parameter (ISO date string YYYY-MM-DD)
          const weekParts = week.split('-');
          if (weekParts.length !== 3) {
            return reply.status(400).send({
              success: false,
              error: 'Invalid Week Parameter',
              message: 'Week parameter must be a valid ISO date (YYYY-MM-DD)',
            });
          }
          const year = parseInt(weekParts[0], 10);
          const month = parseInt(weekParts[1], 10) - 1; // Month is 0-indexed
          const day = parseInt(weekParts[2], 10);
          const weekDate = new Date(year, month, day, 0, 0, 0, 0);
          if (isNaN(weekDate.getTime())) {
            return reply.status(400).send({
              success: false,
              error: 'Invalid Week Parameter',
              message: 'Week parameter must be a valid ISO date (YYYY-MM-DD)',
            });
          }
          weekStart = getMonday(weekDate);
        } else {
          // Default to current week using local date
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          weekStart = getMonday(today);
        }

        // Calculate week end (Sunday) using local date
        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        // Format dates as YYYY-MM-DD strings for SQL comparison
        // Use local date formatting to avoid timezone issues
        const formatDateForSQL = (date: Date): string => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        
        const weekStartStr = formatDateForSQL(weekStart);
        const weekEndStr = formatDateForSQL(weekEnd);

        fastify.log.info('=== SCHEDULE ENDPOINT DEBUG ===');
        fastify.log.info('Request params:', {
          childId,
          tenantId,
          week,
          userId,
        });
        fastify.log.info('Calculated dates:', {
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          weekStartISO: weekStart.toISOString(),
          weekEndISO: weekEnd.toISOString(),
          weekStartLocal: weekStart.toString(),
          weekEndLocal: weekEnd.toString(),
        });

        // First, verify that the student has active enrollments
        const enrollmentCheckQuery = `
          SELECT se.class_id, se.status
          FROM student_enrollments se
          JOIN classes cl ON cl.id = se.class_id
          WHERE student_id = $1
            AND se.tenant_id = $2
            AND se.status = 'active'
            AND ($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)
        `;
        const enrollmentCheck = await pool.query(enrollmentCheckQuery, [childId, tenantId, activeAcademicYearId || null]);
        
        fastify.log.info('Student enrollments check:', {
          enrollmentsCount: enrollmentCheck.rows.length,
          enrollments: enrollmentCheck.rows,
        });

        // Emploi du temps du module professionnel : indépendant des classes,
        // il se lit toujours (un élève peut cumuler les deux parcours).
        const professionalSchedule = await fetchProfessionalSchedule(pool, {
          tenantId,
          childId,
          fromDate: weekStartStr,
          toDate: weekEndStr,
        });

        if (enrollmentCheck.rows.length === 0) {
          fastify.log.info('No classic enrollments — falling back to professional schedule:', {
            childId,
            tenantId,
            professionalCount: professionalSchedule.length,
          });
          return reply.send({
            success: true,
            data: {
              schedule: professionalSchedule,
              weekStart: weekStartStr,
              weekEnd: weekEndStr,
            },
          });
        }

        // Query weekly schedule for the child
        // Join session_instances with student_enrollments to get sessions for enrolled classes
        // Use the same query structure as upcoming-classes for consistency
        const scheduleQuery = `
          SELECT 
            si.id,
            si.session_date as date,
            si.start_time::text as start_time,
            si.end_time::text as end_time,
            c.name as course_name,
            c.code as course_code,
            si.classroom,
            COALESCE(u.first_name || ' ' || u.last_name, u.name, 'TBD') as teacher_name,
            si.class_id,
            se.class_id as enrollment_class_id
          FROM session_instances si
          JOIN student_enrollments se ON si.class_id = se.class_id
          JOIN courses c ON si.course_id = c.id
          LEFT JOIN teachers t ON si.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE se.student_id = $1
            AND se.tenant_id = $2
            AND se.status = 'active'
            AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM classes cl WHERE cl.id = se.class_id AND cl.academic_year_id = $5::uuid))
            AND si.tenant_id = $2
            AND si.session_date >= $3
            AND si.session_date <= $4
            AND (si.status IS NULL OR si.status = 'scheduled' OR si.status = 'completed')
          ORDER BY si.session_date ASC, si.start_time ASC
        `;

        // Log the query for debugging
        fastify.log.info('Schedule query details:', {
          query: scheduleQuery,
          params: [childId, tenantId, weekStartStr, weekEndStr, activeAcademicYearId || null],
          paramTypes: ['childId (UUID)', 'tenantId (UUID)', 'weekStart (DATE)', 'weekEnd (DATE)'],
        });

        const scheduleResult = await pool.query(scheduleQuery, [
          childId,
          tenantId,
          weekStartStr,
          weekEndStr,
          activeAcademicYearId || null,
        ]);

        fastify.log.info('Schedule query result:', {
          rowsCount: scheduleResult.rows.length,
          sampleRow: scheduleResult.rows[0],
          allRows: scheduleResult.rows,
        });

        // If no results, try multiple debug queries to understand the issue
        if (scheduleResult.rows.length === 0) {
          fastify.log.warn('=== NO SESSIONS FOUND - DEBUGGING ===');
          
          // Debug 1: Check all sessions in date range (without student filter)
          const debugQuery1 = `
            SELECT 
              si.id,
              si.session_date,
              si.class_id,
              si.tenant_id,
              si.status,
              si.start_time,
              si.end_time
            FROM session_instances si
            WHERE si.tenant_id = $1
              AND si.session_date >= $2
              AND si.session_date <= $3
            ORDER BY si.session_date ASC
            LIMIT 20
          `;
          const debugResult1 = await pool.query(debugQuery1, [tenantId, weekStartStr, weekEndStr]);
          fastify.log.info('Debug 1 - All sessions in date range:', {
            rowsCount: debugResult1.rows.length,
            sampleRows: debugResult1.rows.slice(0, 5),
          });

          // Debug 2: Check student enrollments with class_ids
          const debugQuery2 = `
            SELECT 
              se.id,
              se.student_id,
              se.class_id,
              se.status,
              cl.name as class_name
            FROM student_enrollments se
            LEFT JOIN classes cl ON se.class_id = cl.id
            WHERE se.student_id = $1
              AND se.tenant_id = $2
              AND se.status = 'active'
          `;
          const debugResult2 = await pool.query(debugQuery2, [childId, tenantId]);
          fastify.log.info('Debug 2 - Student enrollments:', {
            rowsCount: debugResult2.rows.length,
            enrollments: debugResult2.rows,
          });

          // Debug 3: Check sessions for enrolled classes (without date filter)
          if (debugResult2.rows.length > 0) {
            const classIds = debugResult2.rows.map((r: any) => r.class_id);
            const debugQuery3 = `
              SELECT 
                si.id,
                si.session_date,
                si.class_id,
                si.tenant_id,
                si.status,
                si.start_time,
                si.end_time,
                c.name as course_name
              FROM session_instances si
              JOIN courses c ON si.course_id = c.id
              WHERE si.tenant_id = $1
                AND si.class_id = ANY($2::uuid[])
              ORDER BY si.session_date DESC
              LIMIT 20
            `;
            const debugResult3 = await pool.query(debugQuery3, [tenantId, classIds]);
            fastify.log.info('Debug 3 - Sessions for enrolled classes (all dates):', {
              rowsCount: debugResult3.rows.length,
              sampleRows: debugResult3.rows.slice(0, 5),
            });
          }

          // Debug 4: Check sessions for enrolled classes WITH date filter
          if (debugResult2.rows.length > 0) {
            const classIds = debugResult2.rows.map((r: any) => r.class_id);
            const debugQuery4 = `
              SELECT 
                si.id,
                si.session_date,
                si.class_id,
                si.tenant_id,
                si.status,
                si.start_time,
                si.end_time,
                c.name as course_name
              FROM session_instances si
              JOIN courses c ON si.course_id = c.id
              WHERE si.tenant_id = $1
                AND si.class_id = ANY($2::uuid[])
                AND si.session_date >= $3
                AND si.session_date <= $4
              ORDER BY si.session_date ASC
              LIMIT 20
            `;
            const debugResult4 = await pool.query(debugQuery4, [tenantId, classIds, weekStartStr, weekEndStr]);
            fastify.log.info('Debug 4 - Sessions for enrolled classes (with date filter):', {
              rowsCount: debugResult4.rows.length,
              sampleRows: debugResult4.rows,
              dateRange: { weekStartStr, weekEndStr },
            });
          }

          fastify.log.warn('=== END DEBUG ===');
        }

        const schedule = [
          ...scheduleResult.rows.map((row: any) => ({
            id: row.id,
            date: row.date,
            startTime: row.start_time,
            endTime: row.end_time,
            courseName: row.course_name,
            courseCode: row.course_code,
            classroom: row.classroom,
            teacherName: row.teacher_name,
          })),
          ...professionalSchedule,
        ].sort((a, b) => scheduleSortKey(a).localeCompare(scheduleSortKey(b)));

        return reply.send({
          success: true,
          data: {
            schedule,
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
          },
        });
      } catch (error) {
        fastify.log.error({
          msg: 'Error fetching child schedule',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
          childId,
          tenantId,
          week: week || 'current',
        }, 'Failed to fetch child schedule');
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching child schedule',
        });
      }
    },
  });

  // GET /api/v1/parent/children/:childId/upcoming-classes - Get upcoming classes for a child (next 7 days, max 10)
  fastify.get('/:childId/upcoming-classes', {
    schema: {
      tags: ['Parent Children'],
      summary: 'Get upcoming classes for a child (next 7 days, max 10)',
      params: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
        required: ['childId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                upcomingClasses: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      date: { type: 'string' },
                      startTime: { type: 'string' },
                      endTime: { type: 'string' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string' },
                      classroom: { type: 'string', nullable: true },
                      teacherName: { type: 'string', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { childId } = request.params as { childId: string };
      const activeAcademicYearId = (request.headers as any)?.['x-academic-year-id'] as string | undefined;

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship
        const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
        if (!relationshipExists) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Calculate date range (today to next 7 days)
        // Use local date to avoid timezone issues
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const sevenDaysLater = new Date(today);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
        sevenDaysLater.setHours(23, 59, 59, 999);

        // Get current datetime for filtering future sessions
        // We want to include all sessions from today onwards
        // Use the start of today to include all sessions today and future
        const nowForFilter = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

        // First, verify that the student has active enrollments
        const enrollmentCheckQuery2 = `
          SELECT se.class_id, se.status
          FROM student_enrollments se
          JOIN classes cl ON cl.id = se.class_id
          WHERE student_id = $1
            AND se.tenant_id = $2
            AND se.status = 'active'
            AND ($3::uuid IS NULL OR cl.academic_year_id = $3::uuid)
        `;
        const enrollmentCheck2 = await pool.query(enrollmentCheckQuery2, [childId, tenantId, activeAcademicYearId || null]);
        
        fastify.log.info('Upcoming classes - Student enrollments check:', {
          childId,
          tenantId,
          enrollmentsCount: enrollmentCheck2.rows.length,
          enrollments: enrollmentCheck2.rows,
        });

        // Prochains cours du module professionnel : indépendants des classes,
        // ils se lisent toujours (un élève peut cumuler les deux parcours).
        const formatLocalDate = (date: Date): string => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        const professionalUpcoming = await fetchProfessionalSchedule(pool, {
          tenantId,
          childId,
          fromDate: formatLocalDate(today),
          toDate: formatLocalDate(sevenDaysLater),
          limit: 10,
        });

        if (enrollmentCheck2.rows.length === 0) {
          fastify.log.info('No classic enrollments — falling back to professional upcoming classes:', {
            childId,
            tenantId,
            professionalCount: professionalUpcoming.length,
          });
          return reply.send({
            success: true,
            data: {
              upcomingClasses: professionalUpcoming,
            },
          });
        }

        // Query upcoming classes for the child (next 7 days, max 10)
        // Join session_instances with student_enrollments to get sessions for enrolled classes
        const upcomingClassesQuery = `
          SELECT 
            si.id,
            si.session_date as date,
            si.start_time::text as start_time,
            si.end_time::text as end_time,
            si.start_datetime,
            c.name as course_name,
            c.code as course_code,
            si.classroom,
            COALESCE(u.first_name || ' ' || u.last_name, u.name, 'TBD') as teacher_name,
            si.class_id,
            se.class_id as enrollment_class_id
          FROM session_instances si
          JOIN student_enrollments se ON si.class_id = se.class_id
          JOIN courses c ON si.course_id = c.id
          LEFT JOIN teachers t ON si.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE se.student_id = $1
            AND se.tenant_id = $2
            AND se.status = 'active'
            AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM classes cl WHERE cl.id = se.class_id AND cl.academic_year_id = $6::uuid))
            AND si.tenant_id = $2
            AND si.session_date >= $3
            AND si.session_date <= $4
            AND (
              si.session_date > CURRENT_DATE 
              OR (si.session_date = CURRENT_DATE AND si.start_datetime >= $5)
            )
          ORDER BY si.session_date ASC, si.start_time ASC
          LIMIT 10
        `;

        const todayStr = today.toISOString().split('T')[0];
        const sevenDaysLaterStr = sevenDaysLater.toISOString().split('T')[0];
        const nowStr = nowForFilter.toISOString();
        
        fastify.log.info('Upcoming classes query params:', {
          childId,
          tenantId,
          today: todayStr,
          sevenDaysLater: sevenDaysLaterStr,
          now: nowStr,
          nowActual: now.toISOString(),
        });

        const upcomingClassesResult = await pool.query(upcomingClassesQuery, [
          childId,
          tenantId,
          todayStr,
          sevenDaysLaterStr,
          nowStr,
          activeAcademicYearId || null,
        ]);

        fastify.log.info('Upcoming classes query result:', {
          rowsCount: upcomingClassesResult.rows.length,
          sampleRow: upcomingClassesResult.rows[0],
        });

        const upcomingClasses = [
          ...upcomingClassesResult.rows.map((row: any) => ({
            id: row.id,
            date: row.date,
            startTime: row.start_time,
            endTime: row.end_time,
            courseName: row.course_name,
            courseCode: row.course_code,
            classroom: row.classroom,
            teacherName: row.teacher_name,
          })),
          ...professionalUpcoming,
        ]
          .sort((a, b) => scheduleSortKey(a).localeCompare(scheduleSortKey(b)))
          .slice(0, 10);

        return reply.send({
          success: true,
          data: {
            upcomingClasses,
          },
        });
      } catch (error) {
        fastify.log.error({
          msg: 'Error fetching upcoming classes',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
          childId,
          tenantId,
        }, 'Failed to fetch upcoming classes');
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching upcoming classes',
        });
      }
    },
  });

  // GET /api/v1/parent/children/:childId/attendance - Get attendance records for a child (paginated)
  fastify.get('/:childId/attendance', {
    schema: {
      tags: ['Parent Children'],
      summary: 'Get attendance records for a child (paginated, 20 per page)',
      params: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
        required: ['childId'],
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                attendanceRecords: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      date: { type: 'string' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string', nullable: true },
                      status: { type: 'string' },
                      arrivalTime: { type: 'string', nullable: true },
                      excuseReason: { type: 'string', nullable: true },
                      notes: { type: 'string', nullable: true },
                    },
                  },
                },
                pagination: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    page: { type: 'number' },
                    limit: { type: 'number' },
                    pages: { type: 'number' },
                    hasMore: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { childId } = request.params as { childId: string };
      const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship
        const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
        if (!relationshipExists) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Calculate pagination
        const pageNumber = Math.max(1, page);
        const pageLimit = Math.min(Math.max(1, limit), 100);
        const offset = (pageNumber - 1) * pageLimit;

        // Query attendance records for the child from both systems
        // First, query from student_attendance (main attendance system)
        const attendanceQuery1 = `
          SELECT
            sa.id,
            sa.attendance_status as status,
            sa.arrival_time,
            sa.excuse_reason,
            sa.notes,
            sa.marked_at,
            s.session_date as date,
            s.session_time,
            co.name as course_name,
            co.code as course_code
          FROM student_attendance sa
          JOIN attendance_sessions s ON sa.session_id = s.id
          LEFT JOIN class_courses cc ON s.class_course_id = cc.id
          LEFT JOIN courses co ON cc.course_id = co.id
          WHERE sa.student_id = $1
            AND sa.tenant_id = $2
            AND s.tenant_id = $2
        `;

        // Second, query from teacher_attendance_records (teacher attendance system)
        const attendanceQuery2 = `
          SELECT
            tar.id,
            tar.attendance_status as status,
            NULL as arrival_time,
            NULL as excuse_reason,
            tar.notes,
            tar.marked_at,
            tas.session_date as date,
            NULL as session_time,
            co.name as course_name,
            co.code as course_code
          FROM teacher_attendance_records tar
          JOIN teacher_attendance_sessions tas ON tar.session_id = tas.id
          LEFT JOIN class_courses cc ON tas.class_course_id = cc.id
          LEFT JOIN courses co ON cc.course_id = co.id
          WHERE tar.student_id = $1
            AND tar.tenant_id = $2
            AND tas.tenant_id = $2
        `;

        // Count total records from both systems
        const countQuery1 = `
          SELECT COUNT(*) as total
          FROM student_attendance sa
          JOIN attendance_sessions s ON sa.session_id = s.id
          WHERE sa.student_id = $1
            AND sa.tenant_id = $2
            AND s.tenant_id = $2
        `;

        const countQuery2 = `
          SELECT COUNT(*) as total
          FROM teacher_attendance_records tar
          JOIN teacher_attendance_sessions tas ON tar.session_id = tas.id
          WHERE tar.student_id = $1
            AND tar.tenant_id = $2
            AND tas.tenant_id = $2
        `;

        // Execute all queries
        const [attendanceResult1, attendanceResult2, countResult1, countResult2] = await Promise.all([
          pool.query(attendanceQuery1, [childId, tenantId]),
          pool.query(attendanceQuery2, [childId, tenantId]),
          pool.query(countQuery1, [childId, tenantId]),
          pool.query(countQuery2, [childId, tenantId]),
        ]);

        // Combine results and sort by marked_at DESC
        const allRecords = [...attendanceResult1.rows, ...attendanceResult2.rows].sort((a: any, b: any) => {
          const dateA = new Date(a.marked_at).getTime();
          const dateB = new Date(b.marked_at).getTime();
          return dateB - dateA;
        });

        // Apply pagination
        const attendanceResult = {
          rows: allRecords.slice(offset, offset + pageLimit),
        };

        // Calculate total from both systems
        const total = parseInt(countResult1.rows[0]?.total || '0') + parseInt(countResult2.rows[0]?.total || '0');
        const pages = Math.ceil(total / pageLimit);
        const hasMore = pageNumber < pages;

        const attendanceRecords = attendanceResult.rows.map((row: any) => ({
          id: row.id,
          date: row.date,
          courseName: row.course_name || 'N/A',
          courseCode: row.course_code || null,
          status: row.status,
          arrivalTime: row.arrival_time || null,
          excuseReason: row.excuse_reason || null,
          notes: row.notes || null,
        }));

        return reply.send({
          success: true,
          data: {
            attendanceRecords,
            pagination: {
              total,
              page: pageNumber,
              limit: pageLimit,
              pages,
              hasMore,
            },
          },
        });
      } catch (error) {
        fastify.log.error({
          msg: 'Error fetching attendance records',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
          childId,
          tenantId,
          page: request.query?.page || 1,
        }, 'Failed to fetch attendance records');
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching attendance records',
        });
      }
    },
  });

  // GET /api/v1/parent/children/:childId/absence-history - Get absence history for a child with filters and statistics
  fastify.get('/:childId/absence-history', {
    schema: {
      tags: ['Parent Children'],
      summary: 'Get absence history for a child with filters and statistics',
      params: {
        type: 'object',
        properties: {
          childId: { type: 'string', format: 'uuid' },
        },
        required: ['childId'],
      },
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          absenceType: { type: 'string', enum: ['absent', 'excused', 'medical_leave'] },
          courseId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                absences: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      date: { type: 'string' },
                      courseName: { type: 'string' },
                      courseCode: { type: 'string', nullable: true },
                      absenceType: { type: 'string' },
                      excuseReason: { type: 'string', nullable: true },
                      markedAt: { type: 'string' },
                    },
                  },
                },
                statistics: {
                  type: 'object',
                  properties: {
                    totalAbsences: { type: 'number' },
                    excusedCount: { type: 'number' },
                    unexcusedCount: { type: 'number' },
                    medicalCount: { type: 'number' },
                    absenceRate: { type: 'number' },
                  },
                },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId;
      const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;
      const { childId } = request.params as { childId: string };
      const { startDate, endDate, absenceType, courseId } = request.query as {
        startDate?: string;
        endDate?: string;
        absenceType?: 'absent' | 'excused' | 'medical_leave';
        courseId?: string;
      };

      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Tenant Required',
          message: 'This endpoint requires tenant context',
        });
      }

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentication Required',
          message: 'User ID is required',
        });
      }

      // Check if user has parent role
      const userRoles = request.user?.roles || [];
      if (!userRoles.includes('parent')) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'This endpoint requires parent role',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify parent-child relationship
        const relationshipExists = await verifyParentChildRelationship(pool, userId, childId, tenantId);
        if (!relationshipExists) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden',
            message: 'Child not linked to parent',
          });
        }

        // Build query with filters
        const whereConditions = [
          'sa.student_id = $1',
          'sa.tenant_id = $2',
          's.tenant_id = $2',
          "sa.attendance_status IN ('absent', 'excused', 'medical_leave')",
        ];
        const queryParams: any[] = [childId, tenantId];
        let paramIndex = 3;

        // Date range filter
        if (startDate) {
          whereConditions.push(`s.session_date >= $${paramIndex}`);
          queryParams.push(startDate);
          paramIndex++;
        }

        if (endDate) {
          whereConditions.push(`s.session_date <= $${paramIndex}`);
          queryParams.push(endDate);
          paramIndex++;
        }

        // Absence type filter
        if (absenceType) {
          whereConditions.push(`sa.attendance_status = $${paramIndex}`);
          queryParams.push(absenceType);
          paramIndex++;
        }

        // Course filter
        if (courseId) {
          whereConditions.push(`co.id = $${paramIndex}`);
          queryParams.push(courseId);
          paramIndex++;
        }

        // Query absence records from both student_attendance and teacher_attendance_records
        // Build WHERE conditions for teacher_attendance_records query
        const teacherWhereConditions = [
          'tar.student_id = $1',
          'tar.tenant_id = $2',
          'tas.tenant_id = $2',
          "tar.attendance_status IN ('absent', 'excused', 'medical_leave')",
        ];
        const teacherQueryParams: any[] = [childId, tenantId];
        let teacherParamIndex = 3;

        // Add date filters to teacher query if provided
        if (startDate) {
          teacherWhereConditions.push(`tas.session_date >= $${teacherParamIndex}`);
          teacherQueryParams.push(startDate);
          teacherParamIndex++;
        }

        if (endDate) {
          teacherWhereConditions.push(`tas.session_date <= $${teacherParamIndex}`);
          teacherQueryParams.push(endDate);
          teacherParamIndex++;
        }

        // Course filter for teacher query
        if (courseId) {
          teacherWhereConditions.push(`co.id = $${teacherParamIndex}`);
          teacherQueryParams.push(courseId);
          teacherParamIndex++;
        }

        // First, query from student_attendance (main attendance system)
        const absenceQuery1 = `
          SELECT
            sa.id,
            sa.attendance_status as absence_type,
            sa.excuse_reason,
            sa.marked_at,
            s.session_date as date,
            co.name as course_name,
            co.code as course_code
          FROM student_attendance sa
          JOIN attendance_sessions s ON sa.session_id = s.id
          LEFT JOIN class_courses cc ON s.class_course_id = cc.id
          LEFT JOIN courses co ON cc.course_id = co.id
          WHERE ${whereConditions.join(' AND ')}
        `;
        
        // Second, query from teacher_attendance_records (teacher attendance system)
        const absenceQuery2 = `
          SELECT
            tar.id,
            tar.attendance_status as absence_type,
            NULL as excuse_reason,
            tar.marked_at,
            tas.session_date as date,
            co.name as course_name,
            co.code as course_code
          FROM teacher_attendance_records tar
          JOIN teacher_attendance_sessions tas ON tar.session_id = tas.id
          LEFT JOIN class_courses cc ON tas.class_course_id = cc.id
          LEFT JOIN courses co ON cc.course_id = co.id
          WHERE ${teacherWhereConditions.join(' AND ')}
        `;
        
        // Execute both queries separately and combine results
        const absenceResult1 = await pool.query(absenceQuery1, queryParams);
        const absenceResult2 = await pool.query(absenceQuery2, teacherQueryParams);
        
        // Combine results and sort by marked_at DESC
        const absenceResult = {
          rows: [...absenceResult1.rows, ...absenceResult2.rows].sort((a: any, b: any) => {
            const dateA = new Date(a.marked_at).getTime();
            const dateB = new Date(b.marked_at).getTime();
            return dateB - dateA;
          }),
        };

        // Calculate statistics
        const totalAbsences = absenceResult.rows.length;
        const excusedCount = absenceResult.rows.filter((row: any) => row.absence_type === 'excused').length;
        const unexcusedCount = absenceResult.rows.filter((row: any) => row.absence_type === 'absent').length;
        const medicalCount = absenceResult.rows.filter((row: any) => row.absence_type === 'medical_leave').length;

        // Calculate absence rate (need total sessions to calculate rate)
        // Build total sessions query with same filters (except absence status)
        const totalSessionsWhereConditions = [
          'sa.student_id = $1',
          'sa.tenant_id = $2',
          's.tenant_id = $2',
        ];
        const totalSessionsParams: any[] = [childId, tenantId];
        let totalSessionsParamIndex = 3;

        // Add date filters to total sessions query if provided
        if (startDate) {
          totalSessionsWhereConditions.push(`s.session_date >= $${totalSessionsParamIndex}`);
          totalSessionsParams.push(startDate);
          totalSessionsParamIndex++;
        }

        if (endDate) {
          totalSessionsWhereConditions.push(`s.session_date <= $${totalSessionsParamIndex}`);
          totalSessionsParams.push(endDate);
          totalSessionsParamIndex++;
        }

        // Course filter for total sessions
        if (courseId) {
          totalSessionsWhereConditions.push(`co.id = $${totalSessionsParamIndex}`);
          totalSessionsParams.push(courseId);
          totalSessionsParamIndex++;
        }

        // Count total sessions from student_attendance
        const totalSessionsQuery1 = `
          SELECT COUNT(*) as total
          FROM student_attendance sa
          JOIN attendance_sessions s ON sa.session_id = s.id
          LEFT JOIN class_courses cc ON s.class_course_id = cc.id
          LEFT JOIN courses co ON cc.course_id = co.id
          WHERE ${totalSessionsWhereConditions.join(' AND ')}
        `;

        // Build WHERE conditions for teacher_attendance_records total sessions query
        const teacherTotalSessionsWhereConditions = [
          'tar.student_id = $1',
          'tar.tenant_id = $2',
          'tas.tenant_id = $2',
        ];
        const teacherTotalSessionsParams: any[] = [childId, tenantId];
        let teacherTotalSessionsParamIndex = 3;

        // Add date filters to teacher total sessions query if provided
        if (startDate) {
          teacherTotalSessionsWhereConditions.push(`tas.session_date >= $${teacherTotalSessionsParamIndex}`);
          teacherTotalSessionsParams.push(startDate);
          teacherTotalSessionsParamIndex++;
        }

        if (endDate) {
          teacherTotalSessionsWhereConditions.push(`tas.session_date <= $${teacherTotalSessionsParamIndex}`);
          teacherTotalSessionsParams.push(endDate);
          teacherTotalSessionsParamIndex++;
        }

        // Course filter for teacher total sessions
        if (courseId) {
          teacherTotalSessionsWhereConditions.push(`co.id = $${teacherTotalSessionsParamIndex}`);
          teacherTotalSessionsParams.push(courseId);
          teacherTotalSessionsParamIndex++;
        }

        // Count total sessions from teacher_attendance_records
        const totalSessionsQuery2 = `
          SELECT COUNT(*) as total
          FROM teacher_attendance_records tar
          JOIN teacher_attendance_sessions tas ON tar.session_id = tas.id
          LEFT JOIN class_courses cc ON tas.class_course_id = cc.id
          LEFT JOIN courses co ON cc.course_id = co.id
          WHERE ${teacherTotalSessionsWhereConditions.join(' AND ')}
        `;

        // Execute both queries and sum the results
        const totalSessionsResult1 = await pool.query(totalSessionsQuery1, totalSessionsParams);
        const totalSessionsResult2 = await pool.query(totalSessionsQuery2, teacherTotalSessionsParams);
        const totalSessions = parseInt(totalSessionsResult1.rows[0]?.total || '0') + parseInt(totalSessionsResult2.rows[0]?.total || '0');
        const absenceRate = totalSessions > 0 ? (totalAbsences / totalSessions) * 100 : 0;

        const absences = absenceResult.rows.map((row: any) => ({
          id: row.id,
          date: row.date,
          courseName: row.course_name || 'N/A',
          courseCode: row.course_code || null,
          absenceType: row.absence_type,
          excuseReason: row.excuse_reason || null,
          markedAt: row.marked_at,
        }));

        return reply.send({
          success: true,
          data: {
            absences,
            statistics: {
              totalAbsences,
              excusedCount,
              unexcusedCount,
              medicalCount,
              absenceRate: Math.round(absenceRate * 100) / 100,
            },
          },
        });
      } catch (error) {
        fastify.log.error({
          msg: 'Error fetching absence history',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
          childId,
          tenantId,
          filters: { startDate, endDate, absenceType, courseId },
        }, 'Failed to fetch absence history');
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching absence history',
        });
      }
    },
  });
}

