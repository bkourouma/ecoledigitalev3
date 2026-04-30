import { FastifyInstance } from "fastify";
import {
  ClassSchema,
  CreateClassSchema as OriginalCreateClassSchema,
  UpdateClassSchema as OriginalUpdateClassSchema,
  ClassWithDetailsSchema
} from "@ecoledigitale/contracts/src/academic-year";
import { z } from "zod";

// Schémas temporaires avec classroomId jusqu'à ce que le package contracts soit mis à jour
const CreateClassSchema = z.object({
  programmeId: z.string().uuid("Le programme est requis"),
  academicYearId: z.string().uuid("L'année académique est requise"),
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
  code: z.string().min(1).max(50).optional(),
  maxStudents: z.number().int().positive("Le nombre maximum d'étudiants doit être positif").optional(),
  courseIds: z.array(z.string().uuid()).optional().default([]),
  classroomId: z.string().uuid().optional(),
});

const UpdateClassSchema = OriginalUpdateClassSchema.extend({
  classroomId: z.string().uuid().nullable().optional(),
});

function toIsoDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    return value.length >= 10 ? value.slice(0, 10) : null;
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function generateClassCode(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  const suffix = Math.floor(100 + Math.random() * 900);
  return `${base || "CLASSE"}-${suffix}`.slice(0, 50);
}

export async function classesRoutes(fastify: FastifyInstance) {
  // GET /api/v1/classes - List classes
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          programmeId: { type: "string", format: "uuid" },
          academicYearId: { type: "string", format: "uuid" },
          includeDetails: { type: "boolean", default: false },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  tenantId: { type: "string" },
                  programmeId: { type: "string" },
                  academicYearId: { type: "string" },
                  name: { type: "string" },
                  code: { type: "string" },
                  maxStudents: { type: "number" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  classroomId: { anyOf: [{ type: "string" }, { type: "null" }] },

                  programme: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      code: { type: "string" },
                    },
                  },
                  academicYear: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                    },
                  },
                  classroom: {
                    anyOf: [
                      {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          name: { type: "string" },
                          code: { type: "string" },
                          capacity: { type: "number" },
                        },
                      },
                      { type: "null" }
                    ]
                  },
                  courseCount: { type: "number" },
                  studentCount: { type: "number" },
                  courses: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        code: { type: "string" },
                        isRequired: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
            pagination: {
              type: "object",
              properties: {
                page: { type: "number" },
                limit: { type: "number" },
                total: { type: "number" },
                totalPages: { type: "number" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const query = request.query as {
        programmeId?: string;
        academicYearId?: string;
        includeDetails?: boolean;
        page: number;
        limit: number;
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = query.academicYearId || activeAcademicYearId;
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        // Build WHERE clause
        let whereClause = "WHERE c.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (query.programmeId) {
          whereClause += ` AND c.programme_id = $${paramIndex}`;
          params.push(query.programmeId);
          paramIndex++;
        }

        if (effectiveAcademicYearId) {
          whereClause += ` AND c.academic_year_id = $${paramIndex}`;
          params.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) FROM classes c
          JOIN programmes p ON c.programme_id = p.id
          JOIN academic_years ay ON c.academic_year_id = ay.id
          ${whereClause}
        `;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Base query for classes - UPDATED to include cycle_id
        let classesQuery = `
          SELECT c.id, c.tenant_id, c.programme_id, c.academic_year_id,
                 c.name, c.code, c.max_students, c.classroom_id as class_classroom_id, c.created_at, c.updated_at,
                 p.id as programme_id, p.name as programme_name, p.code as programme_code, p.cycle_id as programme_cycle_id,
                 ay.id as academic_year_id, ay.name as academic_year_name,
                 cr.id as classroom_id, cr.name as classroom_name, cr.code as classroom_code, cr.capacity as classroom_capacity
        `;

        // Add stats if requested
        if (query.includeDetails) {
          classesQuery += `,
            COALESCE(course_stats.course_count, 0) as course_count,
            COALESCE(enrollment_stats.student_count, 0) as student_count
          `;
        }

        classesQuery += `
          FROM classes c
          JOIN programmes p ON c.programme_id = p.id
          JOIN academic_years ay ON c.academic_year_id = ay.id
          LEFT JOIN classrooms cr ON cr.id = c.classroom_id AND cr.tenant_id = c.tenant_id
        `;

        // Add joins for stats if requested
        if (query.includeDetails) {
          classesQuery += `
            LEFT JOIN (
              SELECT class_id, COUNT(*) as course_count
              FROM class_courses
              WHERE tenant_id = $1
              GROUP BY class_id
            ) course_stats ON c.id = course_stats.class_id
            LEFT JOIN (
              SELECT class_id, COUNT(*) as student_count
              FROM student_enrollments
              WHERE tenant_id = $1
              GROUP BY class_id
            ) enrollment_stats ON c.id = enrollment_stats.class_id
          `;
        }

        classesQuery += `
          ${whereClause}
          ORDER BY c.created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const classesResult = await client.query(classesQuery, [...params, query.limit, offset]);

        // If includeDetails is true, fetch courses for each class
        let classesWithCourses = classesResult.rows.map(row => {
          const baseData = {
            id: row.id,
            tenantId: row.tenant_id,
            programmeId: row.programme_id,
            academicYearId: row.academic_year_id,
            name: row.name,
            code: row.code,
            maxStudents: row.max_students,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            programme: {
              id: row.programme_id,
              name: row.programme_name,
              code: row.programme_code,
              cycleId: row.programme_cycle_id,
            },
            academicYear: {
              id: row.academic_year_id,
              name: row.academic_year_name,
            },
            classroomId: row.class_classroom_id,
            classroom: row.classroom_id ? {
              id: row.classroom_id,
              name: row.classroom_name,
              code: row.classroom_code,
              capacity: row.classroom_capacity,
            } : null,
          };

          if (query.includeDetails) {
            return {
              ...baseData,
              courseCount: parseInt(row.course_count) || 0,
              studentCount: parseInt(row.student_count) || 0,
              courses: [], // Will be populated below
            };
          }

          return baseData;
        });

        // Fetch courses for each class if includeDetails is true
        if (query.includeDetails && classesWithCourses.length > 0) {
          const classIds = classesWithCourses.map(c => c.id);
          const coursesQuery = `
            SELECT cc.class_id, cc.is_required, c.id, c.name, c.code
            FROM class_courses cc
            JOIN courses c ON cc.course_id = c.id
            WHERE cc.tenant_id = $1 AND cc.class_id = ANY($2)
            ORDER BY c.name
          `;

          const coursesResult = await client.query(coursesQuery, [request.tenantId, classIds]);

          // Group courses by class_id
          const coursesByClass = coursesResult.rows.reduce((acc, row) => {
            if (!acc[row.class_id]) {
              acc[row.class_id] = [];
            }
            acc[row.class_id].push({
              id: row.id,
              name: row.name,
              code: row.code,
              isRequired: row.is_required,
            });
            return acc;
          }, {});

          // Add courses to each class
          classesWithCourses = classesWithCourses.map(classData => {
            if (query.includeDetails) {
              return {
                ...classData,
                courses: coursesByClass[classData.id] || [],
              };
            }
            return classData;
          });
        }

        const classes = classesWithCourses;

        const totalPages = Math.ceil(total / query.limit);

        return reply.send({
          data: classes,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages,
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching classes: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch classes",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/classes/:id - Get class by ID
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          includeCourses: { type: "boolean", default: false },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                programmeId: { type: "string" },
                academicYearId: { type: "string" },
                name: { type: "string" },
                code: { type: "string" },
                maxStudents: { type: "number" },
                classroomId: { anyOf: [{ type: "string" }, { type: "null" }] },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
                programme: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    code: { type: "string" },
                  },
                },
                academicYear: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                  },
                },
                classroom: {
                  anyOf: [
                    {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        code: { type: "string" },
                        capacity: { type: "number" },
                      },
                    },
                    { type: "null" }
                  ]
                },
                courseCount: { type: "number" },
                studentCount: { type: "number" },
                courses: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      code: { type: "string" },
                      isRequired: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const query = request.query as { includeCourses?: boolean };

      const client = await fastify.pg.connect();
      try {
        // Get class with programme and academic year info
        const classQuery = `
          SELECT c.id, c.tenant_id, c.programme_id, c.academic_year_id,
                 c.name, c.code, c.max_students, c.classroom_id as class_classroom_id, c.created_at, c.updated_at,
                 p.id as programme_id, p.name as programme_name, p.code as programme_code, p.cycle_id as programme_cycle_id,
                 ay.id as academic_year_id, ay.name as academic_year_name,
                 ay.start_date as academic_year_start_date, ay.end_date as academic_year_end_date,
                 cr.id as classroom_id, cr.name as classroom_name, cr.code as classroom_code, cr.capacity as classroom_capacity,
                 COALESCE(course_stats.course_count, 0) as course_count,
                 COALESCE(enrollment_stats.student_count, 0) as student_count
          FROM classes c
          JOIN programmes p ON c.programme_id = p.id
          JOIN academic_years ay ON c.academic_year_id = ay.id
          LEFT JOIN classrooms cr ON cr.id = c.classroom_id AND cr.tenant_id = c.tenant_id
          LEFT JOIN (
            SELECT class_id, COUNT(*) as course_count
            FROM class_courses
            WHERE tenant_id = $2
            GROUP BY class_id
          ) course_stats ON c.id = course_stats.class_id
          LEFT JOIN (
            SELECT class_id, COUNT(*) as student_count
            FROM student_enrollments
            WHERE tenant_id = $2 AND status = 'active'
            GROUP BY class_id
          ) enrollment_stats ON c.id = enrollment_stats.class_id
          WHERE c.id = $1 AND c.tenant_id = $2
        `;

        const classResult = await client.query(classQuery, [id, request.tenantId]);

        if (classResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Class not found",
          });
        }

        const classData = classResult.rows[0];
        const result = {
          id: classData.id,
          tenantId: classData.tenant_id,
          programmeId: classData.programme_id,
          academicYearId: classData.academic_year_id,
          name: classData.name,
          code: classData.code,
          maxStudents: classData.max_students,
          classroomId: classData.class_classroom_id,
          createdAt: classData.created_at,
          updatedAt: classData.updated_at,
          programme: {
            id: classData.programme_id,
            name: classData.programme_name,
            code: classData.programme_code,
            cycleId: classData.programme_cycle_id,
          },
          academicYear: {
            id: classData.academic_year_id,
            name: classData.academic_year_name,
            startDate: toIsoDateOnly(classData.academic_year_start_date),
            endDate: toIsoDateOnly(classData.academic_year_end_date),
          },
          classroom: classData.classroom_id ? {
            id: classData.classroom_id,
            name: classData.classroom_name,
            code: classData.classroom_code,
            capacity: classData.classroom_capacity,
          } : null,
          courseCount: parseInt(classData.course_count) || 0,
          studentCount: parseInt(classData.student_count) || 0,
          courses: [] as any[],
        };

        // Get courses if requested
        if (query.includeCourses) {
          const coursesQuery = `
            SELECT c.id, c.name, c.code, cc.is_required
            FROM class_courses cc
            JOIN courses c ON cc.course_id = c.id
            WHERE cc.class_id = $1 AND cc.tenant_id = $2
            ORDER BY c.name
          `;

          const coursesResult = await client.query(coursesQuery, [id, request.tenantId]);
          result.courses = coursesResult.rows.map(row => ({
            id: row.id,
            name: row.name,
            code: row.code,
            isRequired: row.is_required,
          }));
        }

        return reply.send({ data: result });
      } catch (error) {
        fastify.log.error(`Error fetching class: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch class",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/classes/:classId/courses - Get courses assigned to a specific class
  fastify.get("/:classId/courses", {
    schema: {
      params: {
        type: "object",
        required: ["classId"],
        properties: {
          classId: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  code: { type: "string" },
                  description: { type: "string" },
                  hoursTotal: { type: "number" },
                  hoursTheory: { type: "number" },
                  hoursPractical: { type: "number" },
                  isRequired: { type: "boolean" },
                  programme: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      code: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { classId } = request.params as { classId: string };

      const client = await fastify.pg.connect();
      try {
        // First verify the class exists and belongs to the tenant
        const classCheckQuery = `
          SELECT id, programme_id FROM classes
          WHERE id = $1 AND tenant_id = $2
        `;
        const classCheckResult = await client.query(classCheckQuery, [classId, request.tenantId]);

        if (classCheckResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Class not found",
          });
        }

        const classProgrammeId = classCheckResult.rows[0].programme_id as string;

        // Get courses assigned to the class (explicit class_courses links)
        const coursesQuery = `
          SELECT
            courses.id, courses.name, courses.code, courses.description,
            courses.hours_total, courses.hours_theory, courses.hours_practical,
            cc.is_required,
            p.id as programme_id, p.name as programme_name, p.code as programme_code
          FROM class_courses cc
          JOIN courses ON cc.course_id = courses.id
          JOIN programmes p ON courses.programme_id = p.id
          WHERE cc.tenant_id = $1 AND cc.class_id = $2
          ORDER BY courses.name
        `;

        let coursesResult = await client.query(coursesQuery, [request.tenantId, classId]);

        // If no rows in class_courses, fall back to all active courses for the class programme
        // (matières are defined on the programme; classes may not have been saved with courseIds)
        if (coursesResult.rows.length === 0 && classProgrammeId) {
          const programmeCoursesQuery = `
            SELECT
              c.id, c.name, c.code, c.description,
              c.hours_total, c.hours_theory, c.hours_practical,
              true as is_required,
              p.id as programme_id, p.name as programme_name, p.code as programme_code
            FROM courses c
            JOIN programmes p ON c.programme_id = p.id
            WHERE c.tenant_id = $1 AND c.programme_id = $2 AND c.status = 'active'
            ORDER BY c.name
          `;
          coursesResult = await client.query(programmeCoursesQuery, [
            request.tenantId,
            classProgrammeId,
          ]);
        }

        const courses = coursesResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          code: row.code,
          description: row.description,
          hoursTotal: row.hours_total,
          hoursTheory: row.hours_theory,
          hoursPractical: row.hours_practical,
          isRequired: row.is_required,
          programme: {
            id: row.programme_id,
            name: row.programme_name,
            code: row.programme_code,
          },
        }));

        return reply.send({ data: courses });
      } catch (error) {
        fastify.log.error(`Error fetching class courses: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch class courses",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/classes/programme/:programmeId/available-courses - Get available courses for a programme
  fastify.get("/programme/:programmeId/available-courses", {
    schema: {
      params: {
        type: "object",
        required: ["programmeId"],
        properties: {
          programmeId: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  code: { type: "string" },
                  credits: { type: "number" },
                  teachingUnitName: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { programmeId } = request.params as { programmeId: string };

      const client = await fastify.pg.connect();
      try {
        // Get courses for the programme directly (simplified structure)
        const coursesQuery = `
          SELECT c.id, c.name, c.code, c.hours_total as credits
          FROM courses c
          WHERE c.programme_id = $1 AND c.tenant_id = $2 AND c.status = 'active'
          ORDER BY c.name
        `;

        const coursesResult = await client.query(coursesQuery, [programmeId, request.tenantId]);

        const courses = coursesResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          code: row.code,
          credits: row.credits || 0,
          teachingUnitName: null, // Not using teaching units in current structure
        }));

        return reply.send({ data: courses });
      } catch (error) {
        fastify.log.error(`Error fetching available courses: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch available courses",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/classes - Create class
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["programmeId", "academicYearId", "name"],
        properties: {
          programmeId: { type: "string", format: "uuid" },
          academicYearId: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 50 },
          maxStudents: { type: "number", minimum: 1, default: 30 },
          courseIds: { type: "array", items: { type: "string", format: "uuid" } },
          classroomId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                programmeId: { type: "string" },
                academicYearId: { type: "string" },
                name: { type: "string" },
                code: { type: "string" },
                maxStudents: { type: "number" },
                classroomId: { anyOf: [{ type: "string" }, { type: "null" }] },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        const data = CreateClassSchema.parse(request.body);
        const maxStudents = data.maxStudents ?? 30;
        let generatedCode = data.code || generateClassCode(data.name);

        const client = await fastify.pg.connect();
        try {
          await client.query('BEGIN');

          // Check if programme exists and belongs to tenant
          const programmeQuery = `
            SELECT id FROM programmes
            WHERE id = $1 AND tenant_id = $2
          `;
          const programmeResult = await client.query(programmeQuery, [data.programmeId, request.tenantId]);

          if (programmeResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Programme not found",
            });
          }

          // Check if academic year exists and belongs to tenant
          const academicYearQuery = `
            SELECT id FROM academic_years
            WHERE id = $1 AND tenant_id = $2
          `;
          const academicYearResult = await client.query(academicYearQuery, [data.academicYearId, request.tenantId]);

          if (academicYearResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Academic year not found",
            });
          }

          // Check for code uniqueness within tenant and academic year
          const existingQuery = `
            SELECT id FROM classes
            WHERE tenant_id = $1 AND code = $2 AND academic_year_id = $3
          `;
          const existingResult = await client.query(existingQuery, [
            request.tenantId,
            generatedCode,
            data.academicYearId
          ]);

          if (existingResult.rows.length > 0) {
            generatedCode = generateClassCode(`${data.name}-${Date.now()}`);
          }

          // Verify all courses exist and belong to the programme (if any courses are selected)
          if (data.courseIds && data.courseIds.length > 0) {
            const coursesQuery = `
              SELECT c.id
              FROM courses c
              WHERE c.id = ANY($1) AND c.programme_id = $2 AND c.tenant_id = $3
            `;
            const coursesResult = await client.query(coursesQuery, [
              data.courseIds,
              data.programmeId,
              request.tenantId
            ]);

            if (coursesResult.rows.length !== data.courseIds.length) {
              await client.query('ROLLBACK');
              return reply.status(400).send({
                error: "Validation Error",
                message: "Some courses do not belong to the selected programme",
              });
            }
          }

          // Insert new class
          const insertQuery = `
            INSERT INTO classes (tenant_id, programme_id, academic_year_id, name, code, max_students, classroom_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, tenant_id, programme_id, academic_year_id, name, code, max_students, classroom_id, created_at, updated_at
          `;

          const result = await client.query(insertQuery, [
            request.tenantId,
            data.programmeId,
            data.academicYearId,
            data.name,
            generatedCode,
            maxStudents,
            data.classroomId || null,
          ]);

          const classId = result.rows[0].id;

          // Insert class courses (if any courses are selected)
          if (data.courseIds && data.courseIds.length > 0) {
            const classCourseInserts = data.courseIds.map(courseId =>
              client.query(
                `INSERT INTO class_courses (tenant_id, class_id, course_id, is_required) VALUES ($1, $2, $3, $4)`,
                [request.tenantId, classId, courseId, true]
              )
            );

            await Promise.all(classCourseInserts);
          }

          await client.query('COMMIT');

          const classData = result.rows[0];
          console.log('🔍 POST classData.classroom_id:', classData.classroom_id);
          const responseData = {
            id: classData.id,
            tenantId: classData.tenant_id,
            programmeId: classData.programme_id,
            academicYearId: classData.academic_year_id,
            name: classData.name,
            code: classData.code,
            maxStudents: classData.max_students,
            classroomId: classData.classroom_id,
            createdAt: classData.created_at,
            updatedAt: classData.updated_at,
          };
          console.log('🔍 POST responseData.classroomId:', responseData.classroomId);
          return reply.status(201).send({
            data: responseData,
          });
        } catch (dbError) {
          await client.query('ROLLBACK');
          throw dbError;
        } finally {
          client.release();
        }
      } catch (error) {
        if (error.name === 'ZodError') {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Invalid input data",
            details: error.errors,
          });
        }

        fastify.log.error(`Error creating class: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create class",
        });
      }
    },
  });

  // PUT /api/v1/classes/:id - Update class
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 50 },
          maxStudents: { type: "number", minimum: 1 },
          courseIds: { type: "array", items: { type: "string", format: "uuid" } },
          classroomId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                programmeId: { type: "string" },
                academicYearId: { type: "string" },
                name: { type: "string" },
                code: { type: "string" },
                maxStudents: { type: "number" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };
      const updateData = UpdateClassSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if class exists and belongs to tenant
        const existingQuery = `
          SELECT id, programme_id, academic_year_id FROM classes
          WHERE id = $1 AND tenant_id = $2
        `;
        const existingResult = await client.query(existingQuery, [id, request.tenantId]);

        if (existingResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Class not found",
          });
        }

        // Build dynamic update query
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (updateData.name !== undefined) {
          updateFields.push(`name = $${paramIndex}`);
          updateValues.push(updateData.name);
          paramIndex++;
        }

        if (updateData.code !== undefined) {
          updateFields.push(`code = $${paramIndex}`);
          updateValues.push(updateData.code);
          paramIndex++;
        }

        if (updateData.maxStudents !== undefined) {
          updateFields.push(`max_students = $${paramIndex}`);
          updateValues.push(updateData.maxStudents);
          paramIndex++;
        }

        if (updateData.classroomId !== undefined) {
          updateFields.push(`classroom_id = $${paramIndex}`);
          updateValues.push(updateData.classroomId || null);
          paramIndex++;
        }

        // Always update the updated_at timestamp
        updateFields.push(`updated_at = NOW()`);

        if (updateFields.length === 1) { // Only updated_at was added
          return reply.status(400).send({
            error: "Bad Request",
            message: "No fields to update",
          });
        }

        // Execute update
        const updateQuery = `
          UPDATE classes
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING id, tenant_id, programme_id, academic_year_id, name, code, max_students, classroom_id, created_at, updated_at
        `;

        updateValues.push(id, request.tenantId);

        const result = await client.query(updateQuery, updateValues);
        const updatedClass = result.rows[0];

        // Handle course updates if provided
        if (updateData.courseIds !== undefined) {
          // Delete existing class-course relationships
          await client.query(
            'DELETE FROM class_courses WHERE class_id = $1 AND tenant_id = $2',
            [id, request.tenantId]
          );

          // Insert new class-course relationships
          if (updateData.courseIds.length > 0) {
            const courseInsertQuery = `
              INSERT INTO class_courses (tenant_id, class_id, course_id)
              VALUES ${updateData.courseIds.map((_, index) =>
                `($1, $2, $${index + 3})`
              ).join(', ')}
            `;

            await client.query(courseInsertQuery, [
              request.tenantId,
              id,
              ...updateData.courseIds
            ]);
          }
        }

        await client.query('COMMIT');

        return reply.status(200).send({
          data: {
            id: updatedClass.id,
            tenantId: updatedClass.tenant_id,
            programmeId: updatedClass.programme_id,
            academicYearId: updatedClass.academic_year_id,
            name: updatedClass.name,
            code: updatedClass.code,
            maxStudents: updatedClass.max_students,
            classroomId: updatedClass.classroom_id,
            createdAt: updatedClass.created_at,
            updatedAt: updatedClass.updated_at,
          },
        });

      } catch (error: any) {
        await client.query('ROLLBACK');

        if (error.name === 'ZodError') {
          return reply.status(400).send({
            error: "Validation Error",
            message: "Invalid input data",
            details: error.errors,
          });
        }

        if (error.code === '23505') { // Unique constraint violation
          return reply.status(409).send({
            error: "Conflict",
            message: "A class with this code already exists in the programme",
          });
        }

        fastify.log.error(`Error updating class: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to update class",
        });
      } finally {
        client.release();
      }
    },
  });

  // DELETE /api/v1/classes/:id - Delete class only if no courses and no students
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      response: {
        204: {
          type: "null",
          description: "No content"
        },
        404: {
          type: "object",
          properties: { error: { type: "string" }, message: { type: "string" } },
        },
        409: {
          type: "object",
          properties: { error: { type: "string" }, message: { type: "string" } },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Verify class exists and belongs to tenant
        const existRes = await client.query(
          `SELECT id FROM classes WHERE id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );
        if (existRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: "Not Found", message: "Class not found" });
        }

        // Check there are no associated courses
        const courseCountRes = await client.query(
          `SELECT COUNT(*)::int AS count FROM class_courses WHERE class_id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );
        const courseCount = courseCountRes.rows[0]?.count || 0;

        // Check there are no enrolled students
        const studentCountRes = await client.query(
          `SELECT COUNT(*)::int AS count FROM student_enrollments WHERE class_id = $1 AND tenant_id = $2`,
          [id, request.tenantId]
        );
        const studentCount = studentCountRes.rows[0]?.count || 0;

        if (courseCount > 0 || studentCount > 0) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: "Conflict",
            message: "Impossible de supprimer la classe car elle possède des cours ou des étudiants inscrits.",
          });
        }

        // Safe to delete
        await client.query(`DELETE FROM classes WHERE id = $1 AND tenant_id = $2`, [id, request.tenantId]);
        await client.query('COMMIT');
        return reply.status(204).send();
      } catch (err) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error deleting class: ${err}`);
        return reply.status(500).send({ error: "Internal Server Error", message: "Failed to delete class" });
      } finally {
        client.release();
      }
    },
  });
}
