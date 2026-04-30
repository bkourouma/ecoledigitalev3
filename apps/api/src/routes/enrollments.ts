import { FastifyInstance } from "fastify";
import {
  StudentEnrollmentSchema,
  CreateStudentEnrollmentSchema,
  UpdateStudentEnrollmentSchema,
  StudentEnrollmentWithDetailsSchema
} from "@ecoledigitale/contracts";
import { z } from "zod";

// Define BulkEnrollmentSchema locally for now
const BulkEnrollmentSchemaLocal = z.object({
  studentIds: z.array(z.string().uuid()).min(1, "Au moins un étudiant doit être sélectionné"),
  classId: z.string().uuid("La classe est requise"),
  academicYearId: z.string().uuid("L'année académique est requise"),
  fees: z.object({
    inscription: z.number().nonnegative("Les frais d'inscription doivent être positifs").default(0),
    scolarite: z.number().nonnegative("Les frais de scolarité doivent être positifs").default(0),
    annexes: z.number().nonnegative("Les frais annexes doivent être positifs").default(0),
    autres: z.number().nonnegative("Les autres frais doivent être positifs").default(0),
    currency: z.string().default('XOF'),
  }),
  enrollmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["active", "suspended", "completed", "dropped", "transferred"]).optional(),
});

type EnrollmentFeesPayload = {
  inscription?: number;
  scolarite?: number;
  annexes?: number;
  autres?: number;
  currency?: string;
  total?: number;
};

export async function enrollmentsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/enrollments - List enrollments
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          classId: { type: "string", format: "uuid" },
          academicYearId: { type: "string", format: "uuid" },
          studentId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["active", "suspended", "completed", "dropped", "transferred"] },
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
                  studentId: { type: "string" },
                  classId: { type: "string" },
                  academicYearId: { type: "string" },
                  originSchool: { type: "string" },
                  lv2: { type: "string" },
                  scholarshipLevel: { type: "string" },
                  isRepeating: { type: "boolean" },
                  isTransfer: { type: "boolean" },
                  isInscribed: { type: "boolean" },
                  transferDecision: { type: "string" },
                  affectationStatus: { type: "string" },
                  affectationDecision: { type: "string" },
                  cepeCode: { type: "string" },
                  fees: {
                    type: "object",
                    properties: {
                      inscription: { type: "number" },
                      scolarite: { type: "number" },
                      annexes: { type: "number" },
                      autres: { type: "number" },
                      total: { type: "number" },
                      currency: { type: "string" }
                    },
                    additionalProperties: true
                  },
                  enrollmentDate: { type: "string" },
                  status: { type: "string" },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  student: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      firstName: { type: "string" },
                      lastName: { type: "string" },
                      email: { type: "string" },
                      studentNumber: { type: "string" },
                    },
                  },
                  class: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      code: { type: "string" },
                      programme: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          code: { type: "string" },
                        },
                      },
                    },
                  },
                  academicYear: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
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
        classId?: string; 
        academicYearId?: string; 
        studentId?: string;
        status?: string;
        page: number; 
        limit: number; 
      };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = query.academicYearId || activeAcademicYearId;
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        // Build WHERE clause
        let whereClause = "WHERE se.tenant_id = $1";
        const params = [request.tenantId];
        let paramIndex = 2;

        if (query.classId) {
          whereClause += ` AND se.class_id = $${paramIndex}`;
          params.push(query.classId);
          paramIndex++;
        }

        if (effectiveAcademicYearId) {
          whereClause += ` AND se.academic_year_id = $${paramIndex}`;
          params.push(effectiveAcademicYearId);
          paramIndex++;
        }

        if (query.studentId) {
          whereClause += ` AND se.student_id = $${paramIndex}`;
          params.push(query.studentId);
          paramIndex++;
        }

        if (query.status) {
          whereClause += ` AND se.status = $${paramIndex}`;
          params.push(query.status);
          paramIndex++;
        }

        // Get total count
        const countQuery = `
          SELECT COUNT(*) FROM student_enrollments se 
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN classes c ON se.class_id = c.id
          JOIN programmes p ON c.programme_id = p.id
          JOIN academic_years ay ON se.academic_year_id = ay.id
          ${whereClause}
        `;
        const countResult = await client.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get enrollments with details
        const enrollmentsQuery = `
          SELECT se.id, se.tenant_id, se.student_id, se.class_id, se.academic_year_id,
                 se.fees, se.origin_school, se.lv2, se.scholarship_level, se.is_repeating,
                 se.is_transfer, se.is_inscribed, se.transfer_decision, se.affectation_status,
                 se.affectation_decision, se.cepe_code, se.enrollment_date, se.status, se.created_at, se.updated_at,
                 u.id as user_id, u.first_name, u.last_name, u.email,
                 sp.student_number,
                 c.id as class_id, c.name as class_name, c.code as class_code,
                 p.name as programme_name, p.code as programme_code,
                 ay.id as academic_year_id, ay.name as academic_year_name
          FROM student_enrollments se
          JOIN student_profiles sp ON se.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          JOIN classes c ON se.class_id = c.id
          JOIN programmes p ON c.programme_id = p.id
          JOIN academic_years ay ON se.academic_year_id = ay.id
          ${whereClause}
          ORDER BY se.created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const enrollmentsResult = await client.query(enrollmentsQuery, [...params, query.limit, offset]);

        const enrollments = enrollmentsResult.rows.map(row => ({
          id: row.id,
          tenantId: row.tenant_id,
          studentId: row.student_id,
          classId: row.class_id,
          academicYearId: row.academic_year_id,
          fees: row.fees,
          originSchool: row.origin_school || undefined,
          lv2: row.lv2 || undefined,
          scholarshipLevel: row.scholarship_level || undefined,
          isRepeating: row.is_repeating,
          isTransfer: row.is_transfer,
          isInscribed: row.is_inscribed,
          transferDecision: row.transfer_decision || undefined,
          affectationStatus: row.affectation_status || undefined,
          affectationDecision: row.affectation_decision || undefined,
          cepeCode: row.cepe_code || undefined,
          enrollmentDate: row.enrollment_date,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          student: {
            id: row.student_id,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email,
            studentNumber: row.student_number,
          },
          class: {
            id: row.class_id,
            name: row.class_name,
            code: row.class_code,
            programme: {
              name: row.programme_name,
              code: row.programme_code,
            },
          },
          academicYear: {
            id: row.academic_year_id,
            name: row.academic_year_name,
          },
        }));

        const totalPages = Math.ceil(total / query.limit);

        return reply.send({
          data: enrollments,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages,
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching enrollments: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch enrollments",
        });
      } finally {
        client.release();
      }
    },
  });

  // GET /api/v1/enrollments/available-students - Get students available for enrollment
  fastify.get("/available-students", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          academicYearId: { type: "string", format: "uuid" },
          search: { type: "string" },
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
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  email: { type: "string" },
                  studentNumber: { type: "string" },
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

      const query = request.query as { academicYearId?: string; search?: string };
      const activeAcademicYearId = request.headers["x-academic-year-id"] as string | undefined;
      const effectiveAcademicYearId = query.academicYearId || activeAcademicYearId;

      const client = await fastify.pg.connect();
      try {
        let studentsQuery = `
          SELECT sp.id, u.first_name, u.last_name, u.email, sp.student_number
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.tenant_id = $1 AND sp.status = 'active'
        `;
        const params = [request.tenantId];
        let paramIndex = 2;

        // Exclude students already enrolled in the academic year
        if (effectiveAcademicYearId) {
          studentsQuery += `
            AND sp.id NOT IN (
              SELECT student_id FROM student_enrollments 
              WHERE academic_year_id = $${paramIndex} AND tenant_id = $1
            )
          `;
          params.push(effectiveAcademicYearId);
          paramIndex++;
        }

        // Add search filter
        if (query.search) {
          studentsQuery += `
            AND (
              u.first_name ILIKE $${paramIndex} OR 
              u.last_name ILIKE $${paramIndex} OR 
              u.email ILIKE $${paramIndex} OR
              sp.student_number ILIKE $${paramIndex}
            )
          `;
          params.push(`%${query.search}%`);
          paramIndex++;
        }

        studentsQuery += ` ORDER BY u.last_name, u.first_name LIMIT 50`;

        const studentsResult = await client.query(studentsQuery, params);

        const students = studentsResult.rows.map(row => ({
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          studentNumber: row.student_number,
        }));

        return reply.send({ data: students });
      } catch (error) {
        fastify.log.error(`Error fetching available students: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fetch available students",
        });
      } finally {
        client.release();
      }
    },
  });

  // POST /api/v1/enrollments - Create enrollment
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["studentId", "classId", "academicYearId", "fees"],
        properties: {
          studentId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          academicYearId: { type: "string", format: "uuid" },
          originSchool: { type: "string", maxLength: 255 },
          lv2: { type: "string", maxLength: 100 },
          scholarshipLevel: { type: "string", enum: ["oui", "non"] },
          isRepeating: { type: "boolean" },
          isTransfer: { type: "boolean" },
          isInscribed: { type: "boolean" },
          transferDecision: { type: "string", maxLength: 255 },
          affectationStatus: { type: "string", enum: ["affecte", "non_affecte", "prise_en_charge"] },
          affectationDecision: { type: "string", maxLength: 255 },
          cepeCode: { type: "string", maxLength: 100 },
          fees: {
            type: "object",
            required: ["inscription", "scolarite", "annexes", "autres"],
            properties: {
              inscription: { type: "number", minimum: 0 },
              scolarite: { type: "number", minimum: 0 },
              annexes: { type: "number", minimum: 0 },
              autres: { type: "number", minimum: 0 },
              currency: { type: "string", default: "XOF" },
            },
          },
          enrollmentDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          status: { type: "string", enum: ["active", "suspended", "completed", "dropped", "transferred"], default: "active" },
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
                studentId: { type: "string" },
                classId: { type: "string" },
                academicYearId: { type: "string" },
                originSchool: { type: "string" },
                lv2: { type: "string" },
                scholarshipLevel: { type: "string" },
                isRepeating: { type: "boolean" },
                isTransfer: { type: "boolean" },
                isInscribed: { type: "boolean" },
                transferDecision: { type: "string" },
                affectationStatus: { type: "string" },
                affectationDecision: { type: "string" },
                cepeCode: { type: "string" },
                fees: {
                  type: "object",
                  properties: {
                    inscription: { type: "number" },
                    scolarite: { type: "number" },
                    annexes: { type: "number" },
                    autres: { type: "number" },
                    total: { type: "number" },
                    currency: { type: "string" }
                  },
                  additionalProperties: true
                },
                enrollmentDate: { type: "string" },
                status: { type: "string" },
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
        const data = CreateStudentEnrollmentSchema.parse(request.body);

        const client = await fastify.pg.connect();
        try {
          await client.query('BEGIN');

          // Check if student exists and belongs to tenant
          const studentQuery = `
            SELECT id FROM student_profiles
            WHERE id = $1 AND tenant_id = $2 AND status = 'active'
          `;
          const studentResult = await client.query(studentQuery, [data.studentId, request.tenantId]);

          if (studentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Student not found or inactive",
            });
          }

          // Check if class exists and belongs to tenant
          const classQuery = `
            SELECT id, max_students FROM classes
            WHERE id = $1 AND tenant_id = $2
          `;
          const classResult = await client.query(classQuery, [data.classId, request.tenantId]);

          if (classResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Class not found",
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

          // Check if student is already enrolled in this class for this academic year
          const existingEnrollmentQuery = `
            SELECT id FROM student_enrollments
            WHERE student_id = $1 AND class_id = $2 AND academic_year_id = $3 AND tenant_id = $4
          `;
          const existingEnrollmentResult = await client.query(existingEnrollmentQuery, [
            data.studentId,
            data.classId,
            data.academicYearId,
            request.tenantId
          ]);

          if (existingEnrollmentResult.rows.length > 0) {
            await client.query('ROLLBACK');
            return reply.status(409).send({
              error: "Conflict",
              message: "Student is already enrolled in this class for this academic year",
            });
          }

          // Check class capacity
          const currentEnrollmentsQuery = `
            SELECT COUNT(*) FROM student_enrollments
            WHERE class_id = $1 AND status = 'active' AND tenant_id = $2
          `;
          const currentEnrollmentsResult = await client.query(currentEnrollmentsQuery, [data.classId, request.tenantId]);
          const currentEnrollments = parseInt(currentEnrollmentsResult.rows[0].count);
          const maxStudents = classResult.rows[0].max_students;

          if (currentEnrollments >= maxStudents) {
            await client.query('ROLLBACK');
            return reply.status(409).send({
              error: "Conflict",
              message: "Class has reached maximum capacity",
            });
          }

          // Determine fees to use: if all fees are 0 or not provided, fetch from cycle
          let feesToUse: EnrollmentFeesPayload = { ...data.fees };
          const allFeesZero = 
            (!feesToUse.inscription || feesToUse.inscription === 0) &&
            (!feesToUse.scolarite || feesToUse.scolarite === 0) &&
            (!feesToUse.annexes || feesToUse.annexes === 0) &&
            (!feesToUse.autres || feesToUse.autres === 0);

          if (allFeesZero) {
            // Fetch cycle fees via: Class → Programme → Cycle
            const cycleFeesQuery = `
              SELECT
                cf.inscription,
                cf.scolarite,
                cf.annexes,
                cf.autres,
                cf.currency
              FROM classes c
              LEFT JOIN programmes p ON c.programme_id = p.id
              LEFT JOIN cycles cy ON p.cycle_id = cy.id
              LEFT JOIN LATERAL (
                SELECT
                  cf.inscription,
                  cf.scolarite,
                  cf.annexes,
                  cf.autres,
                  cf.currency
                FROM cycles_frais cf
                WHERE cf.tenant_id = $1
                  AND cf.cycle_id = cy.id
                ORDER BY
                  CASE WHEN cf.programme_id = p.id THEN 0 ELSE 1 END,
                  cf.created_at ASC
                LIMIT 1
              ) cf ON TRUE
              WHERE c.id = $2 AND c.tenant_id = $1
            `;
            
            const cycleFeesResult = await client.query(cycleFeesQuery, [
              request.tenantId,
              data.classId,
            ]);

            if (cycleFeesResult.rows.length > 0 && cycleFeesResult.rows[0].inscription !== null) {
              const cycleFees = cycleFeesResult.rows[0];
              feesToUse = {
                inscription: Number(cycleFees.inscription) || 0,
                scolarite: Number(cycleFees.scolarite) || 0,
                annexes: Number(cycleFees.annexes) || 0,
                autres: Number(cycleFees.autres) || 0,
                currency: cycleFees.currency || 'XOF',
                total: (Number(cycleFees.inscription) || 0) + 
                       (Number(cycleFees.scolarite) || 0) + 
                       (Number(cycleFees.annexes) || 0) + 
                       (Number(cycleFees.autres) || 0)
              };
            } else {
              // If no cycle fees found, use provided fees (even if 0)
              feesToUse = {
                inscription: feesToUse.inscription || 0,
                scolarite: feesToUse.scolarite || 0,
                annexes: feesToUse.annexes || 0,
                autres: feesToUse.autres || 0,
                currency: feesToUse.currency || 'XOF',
                total: (feesToUse.inscription || 0) + 
                       (feesToUse.scolarite || 0) + 
                       (feesToUse.annexes || 0) + 
                       (feesToUse.autres || 0)
              };
            }
          } else {
            // Use provided fees and calculate total
            feesToUse = {
              inscription: feesToUse.inscription || 0,
              scolarite: feesToUse.scolarite || 0,
              annexes: feesToUse.annexes || 0,
              autres: feesToUse.autres || 0,
              currency: feesToUse.currency || 'XOF',
              total: (feesToUse.inscription || 0) + 
                     (feesToUse.scolarite || 0) + 
                     (feesToUse.annexes || 0) + 
                     (feesToUse.autres || 0)
            };
          }

          // Insert new enrollment
          const insertQuery = `
            INSERT INTO student_enrollments (
              tenant_id, student_id, class_id, academic_year_id, fees, origin_school, lv2,
              scholarship_level, is_repeating, is_transfer, is_inscribed, transfer_decision,
              affectation_status, affectation_decision, cepe_code, enrollment_date, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id, tenant_id, student_id, class_id, academic_year_id, fees, origin_school, lv2,
                      scholarship_level, is_repeating, is_transfer, is_inscribed, transfer_decision,
                      affectation_status, affectation_decision, cepe_code, enrollment_date, status, created_at, updated_at
          `;

          const result = await client.query(insertQuery, [
            request.tenantId,
            data.studentId,
            data.classId,
            data.academicYearId,
            JSON.stringify(feesToUse),
            data.originSchool || null,
            data.lv2 || null,
            data.scholarshipLevel || 'non',
            data.isRepeating ?? false,
            data.isTransfer ?? false,
            data.isInscribed ?? true,
            data.transferDecision || null,
            data.affectationStatus || 'affecte',
            data.affectationDecision || null,
            data.cepeCode || null,
            data.enrollmentDate || new Date().toISOString().split('T')[0],
            data.status || 'active',
          ]);

          await client.query('COMMIT');

          const enrollment = result.rows[0];
          return reply.status(201).send({
            data: {
              id: enrollment.id,
              tenantId: enrollment.tenant_id,
              studentId: enrollment.student_id,
              classId: enrollment.class_id,
              academicYearId: enrollment.academic_year_id,
              fees: enrollment.fees,
              originSchool: enrollment.origin_school,
              lv2: enrollment.lv2,
              scholarshipLevel: enrollment.scholarship_level,
              isRepeating: enrollment.is_repeating,
              isTransfer: enrollment.is_transfer,
              isInscribed: enrollment.is_inscribed,
              transferDecision: enrollment.transfer_decision,
              affectationStatus: enrollment.affectation_status,
              affectationDecision: enrollment.affectation_decision,
              cepeCode: enrollment.cepe_code,
              enrollmentDate: enrollment.enrollment_date,
              status: enrollment.status,
              createdAt: enrollment.created_at,
              updatedAt: enrollment.updated_at,
            },
          });
        } catch (dbError) {
          await client.query('ROLLBACK');
          throw dbError;
        } finally {
          client.release();
        }
      } catch (error) {
        console.error('❌ Error in single enrollment endpoint:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Error name:', error.name);
        console.error('❌ Error message:', error.message);

        if (error.name === 'ZodError') {
          console.error('❌ Zod validation errors:', error.errors);
          return reply.status(400).send({
            error: "Validation Error",
            message: "Invalid input data",
            details: error.errors,
          });
        }

        fastify.log.error(`Error creating enrollment: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to create enrollment",
        });
      }
    },
  });

  // POST /api/v1/enrollments/bulk - Create bulk enrollments
  fastify.post("/bulk", {
    schema: {
      body: {
        type: "object",
        required: ["studentIds", "classId", "academicYearId", "fees"],
        properties: {
          studentIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1,
          },
          classId: { type: "string", format: "uuid" },
          academicYearId: { type: "string", format: "uuid" },
          fees: {
            type: "object",
            required: ["inscription", "scolarite", "annexes", "autres"],
            properties: {
              inscription: { type: "number", minimum: 0 },
              scolarite: { type: "number", minimum: 0 },
              annexes: { type: "number", minimum: 0 },
              autres: { type: "number", minimum: 0 },
              currency: { type: "string", default: "XOF" },
            },
          },
          enrollmentDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          status: { type: "string", enum: ["active", "suspended", "completed", "dropped", "transferred"], default: "active" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                successful: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      studentId: { type: "string" },
                      classId: { type: "string" },
                      academicYearId: { type: "string" },
                      fees: {
                        type: "object",
                        properties: {
                          inscription: { type: "number" },
                          scolarite: { type: "number" },
                          annexes: { type: "number" },
                          autres: { type: "number" },
                          total: { type: "number" },
                          currency: { type: "string" }
                        },
                        additionalProperties: true
                      },
                      enrollmentDate: { type: "string" },
                      status: { type: "string" },
                      createdAt: { type: "string" },
                      updatedAt: { type: "string" },
                    },
                  },
                },
                failed: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      studentId: { type: "string" },
                      error: { type: "string" },
                    },
                  },
                },
                summary: {
                  type: "object",
                  properties: {
                    total: { type: "number" },
                    successful: { type: "number" },
                    failed: { type: "number" },
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

      try {
        const data = BulkEnrollmentSchemaLocal.parse(request.body);

        const client = await fastify.pg.connect();
        try {
          await client.query('BEGIN');

          // Check if class exists and belongs to tenant
          const classQuery = `
            SELECT id FROM classes
            WHERE id = $1 AND tenant_id = $2
          `;
          const classResult = await client.query(classQuery, [data.classId, request.tenantId]);

          if (classResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Class not found or inactive",
            });
          }

          // Check if academic year exists and belongs to tenant
          const yearQuery = `
            SELECT id FROM academic_years
            WHERE id = $1 AND tenant_id = $2 AND is_active = true
          `;
          const yearResult = await client.query(yearQuery, [data.academicYearId, request.tenantId]);

          if (yearResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Academic year not found or inactive",
            });
          }

          const successful = [];
          const failed = [];

          for (const studentId of data.studentIds) {
            try {
              // Check if student exists and belongs to tenant
              const studentQuery = `
                SELECT id FROM student_profiles
                WHERE id = $1 AND tenant_id = $2 AND status = 'active'
              `;
              const studentResult = await client.query(studentQuery, [studentId, request.tenantId]);

              if (studentResult.rows.length === 0) {
                failed.push({
                  studentId,
                  error: "Student not found or inactive",
                });
                continue;
              }

              // Check if enrollment already exists
              const existingQuery = `
                SELECT id FROM student_enrollments
                WHERE student_id = $1 AND class_id = $2 AND academic_year_id = $3 AND tenant_id = $4
              `;
              const existingResult = await client.query(existingQuery, [
                studentId,
                data.classId,
                data.academicYearId,
                request.tenantId,
              ]);

              if (existingResult.rows.length > 0) {
                failed.push({
                  studentId,
                  error: "Student already enrolled in this class for this academic year",
                });
                continue;
              }

              // Determine fees to use: if all fees are 0 or not provided, fetch from cycle
              let feesToUse: EnrollmentFeesPayload = { ...data.fees };
              const allFeesZero = 
                (!feesToUse.inscription || feesToUse.inscription === 0) &&
                (!feesToUse.scolarite || feesToUse.scolarite === 0) &&
                (!feesToUse.annexes || feesToUse.annexes === 0) &&
                (!feesToUse.autres || feesToUse.autres === 0);

              if (allFeesZero) {
                // Fetch cycle fees via: Class → Programme → Cycle
                const cycleFeesQuery = `
                  SELECT
                    cf.inscription,
                    cf.scolarite,
                    cf.annexes,
                    cf.autres,
                    cf.currency
                  FROM classes c
                  LEFT JOIN programmes p ON c.programme_id = p.id
                  LEFT JOIN cycles cy ON p.cycle_id = cy.id
                  LEFT JOIN LATERAL (
                    SELECT
                      cf.inscription,
                      cf.scolarite,
                      cf.annexes,
                      cf.autres,
                      cf.currency
                    FROM cycles_frais cf
                    WHERE cf.tenant_id = $1
                      AND cf.cycle_id = cy.id
                    ORDER BY
                      CASE WHEN cf.programme_id = p.id THEN 0 ELSE 1 END,
                      cf.created_at ASC
                    LIMIT 1
                  ) cf ON TRUE
                  WHERE c.id = $2 AND c.tenant_id = $1
                `;
                
                const cycleFeesResult = await client.query(cycleFeesQuery, [
                  request.tenantId,
                  data.classId,
                ]);

                if (cycleFeesResult.rows.length > 0 && cycleFeesResult.rows[0].inscription !== null) {
                  const cycleFees = cycleFeesResult.rows[0];
                  feesToUse = {
                    inscription: Number(cycleFees.inscription) || 0,
                    scolarite: Number(cycleFees.scolarite) || 0,
                    annexes: Number(cycleFees.annexes) || 0,
                    autres: Number(cycleFees.autres) || 0,
                    currency: cycleFees.currency || 'XOF',
                    total: (Number(cycleFees.inscription) || 0) + 
                           (Number(cycleFees.scolarite) || 0) + 
                           (Number(cycleFees.annexes) || 0) + 
                           (Number(cycleFees.autres) || 0)
                  };
                } else {
                  // If no cycle fees found, use provided fees (even if 0)
                  feesToUse = {
                    inscription: feesToUse.inscription || 0,
                    scolarite: feesToUse.scolarite || 0,
                    annexes: feesToUse.annexes || 0,
                    autres: feesToUse.autres || 0,
                    currency: feesToUse.currency || 'XOF',
                    total: (feesToUse.inscription || 0) + 
                           (feesToUse.scolarite || 0) + 
                           (feesToUse.annexes || 0) + 
                           (feesToUse.autres || 0)
                  };
                }
              } else {
                // Use provided fees and calculate total
                feesToUse = {
                  inscription: feesToUse.inscription || 0,
                  scolarite: feesToUse.scolarite || 0,
                  annexes: feesToUse.annexes || 0,
                  autres: feesToUse.autres || 0,
                  currency: feesToUse.currency || 'XOF',
                  total: (feesToUse.inscription || 0) + 
                         (feesToUse.scolarite || 0) + 
                         (feesToUse.annexes || 0) + 
                         (feesToUse.autres || 0)
                };
              }

              // Insert new enrollment
              const insertQuery = `
                INSERT INTO student_enrollments (
                  tenant_id, student_id, class_id, academic_year_id, fees, enrollment_date, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, tenant_id, student_id, class_id, academic_year_id, fees, enrollment_date, status, created_at, updated_at
              `;

              const result = await client.query(insertQuery, [
                request.tenantId,
                studentId,
                data.classId,
                data.academicYearId,
                JSON.stringify(feesToUse),
                data.enrollmentDate || new Date().toISOString().split('T')[0],
                data.status || 'active',
              ]);

              const enrollment = result.rows[0];
              successful.push({
                id: enrollment.id,
                studentId: enrollment.student_id,
                classId: enrollment.class_id,
                academicYearId: enrollment.academic_year_id,
                fees: enrollment.fees,
                enrollmentDate: enrollment.enrollment_date,
                status: enrollment.status,
                createdAt: enrollment.created_at,
                updatedAt: enrollment.updated_at,
              });
            } catch (studentError) {
              failed.push({
                studentId,
                error: studentError.message || "Unknown error occurred",
              });
            }
          }

          await client.query('COMMIT');

          return reply.status(201).send({
            data: {
              successful,
              failed,
              summary: {
                total: data.studentIds.length,
                successful: successful.length,
                failed: failed.length,
              },
            },
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

        fastify.log.error(error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "An unexpected error occurred",
        });
      }
    },
  });

  // PUT /api/v1/enrollments/:id - Update enrollment
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
          classId: { type: "string", format: "uuid" },
          originSchool: { type: "string", maxLength: 255 },
          lv2: { type: "string", maxLength: 100 },
          scholarshipLevel: { type: "string", enum: ["oui", "non"] },
          isRepeating: { type: "boolean" },
          isTransfer: { type: "boolean" },
          isInscribed: { type: "boolean" },
          transferDecision: { type: "string", maxLength: 255 },
          affectationStatus: { type: "string", enum: ["affecte", "non_affecte", "prise_en_charge"] },
          affectationDecision: { type: "string", maxLength: 255 },
          cepeCode: { type: "string", maxLength: 100 },
          enrollmentDate: { type: "string" },
          fees: {
            type: "object",
            properties: {
              inscription: { type: "number", minimum: 0 },
              scolarite: { type: "number", minimum: 0 },
              annexes: { type: "number", minimum: 0 },
              autres: { type: "number", minimum: 0 },
              currency: { type: "string", default: "XOF" },
            },
          },
          status: { type: "string", enum: ["active", "suspended", "completed", "dropped", "transferred"] },
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
                studentId: { type: "string" },
                classId: { type: "string" },
                academicYearId: { type: "string" },
                originSchool: { type: "string" },
                lv2: { type: "string" },
                scholarshipLevel: { type: "string" },
                isRepeating: { type: "boolean" },
                isTransfer: { type: "boolean" },
                isInscribed: { type: "boolean" },
                transferDecision: { type: "string" },
                affectationStatus: { type: "string" },
                affectationDecision: { type: "string" },
                cepeCode: { type: "string" },
                fees: { type: "object" },
                enrollmentDate: { type: "string" },
                status: { type: "string" },
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
        const data = UpdateStudentEnrollmentSchema.parse(request.body);
        const { id } = request.params as { id: string };

        const client = await fastify.pg.connect();
        try {
          await client.query('BEGIN');

          // Check if enrollment exists and belongs to tenant
          const existingQuery = `
            SELECT id FROM student_enrollments
            WHERE id = $1 AND tenant_id = $2
          `;
          const existingResult = await client.query(existingQuery, [id, request.tenantId]);

          if (existingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(404).send({
              error: "Not Found",
              message: "Enrollment not found",
            });
          }

          // Build update query dynamically
          const updateFields = [];
          const updateValues = [];
          let paramIndex = 3; // Start from 3 since $1 and $2 are for id and tenant_id

          if (data.classId !== undefined) {
            updateFields.push(`class_id = $${paramIndex}`);
            updateValues.push(data.classId);
            paramIndex++;
          }

          if (data.originSchool !== undefined) {
            updateFields.push(`origin_school = $${paramIndex}`);
            updateValues.push(data.originSchool || null);
            paramIndex++;
          }

          if (data.lv2 !== undefined) {
            updateFields.push(`lv2 = $${paramIndex}`);
            updateValues.push(data.lv2 || null);
            paramIndex++;
          }

          if (data.scholarshipLevel !== undefined) {
            updateFields.push(`scholarship_level = $${paramIndex}`);
            updateValues.push(data.scholarshipLevel || null);
            paramIndex++;
          }

          if (data.isRepeating !== undefined) {
            updateFields.push(`is_repeating = $${paramIndex}`);
            updateValues.push(data.isRepeating);
            paramIndex++;
          }

          if (data.isTransfer !== undefined) {
            updateFields.push(`is_transfer = $${paramIndex}`);
            updateValues.push(data.isTransfer);
            paramIndex++;
          }

          if (data.isInscribed !== undefined) {
            updateFields.push(`is_inscribed = $${paramIndex}`);
            updateValues.push(data.isInscribed);
            paramIndex++;
          }

          if (data.transferDecision !== undefined) {
            updateFields.push(`transfer_decision = $${paramIndex}`);
            updateValues.push(data.transferDecision || null);
            paramIndex++;
          }

          if (data.affectationStatus !== undefined) {
            updateFields.push(`affectation_status = $${paramIndex}`);
            updateValues.push(data.affectationStatus || null);
            paramIndex++;
          }

          if (data.affectationDecision !== undefined) {
            updateFields.push(`affectation_decision = $${paramIndex}`);
            updateValues.push(data.affectationDecision || null);
            paramIndex++;
          }

          if (data.cepeCode !== undefined) {
            updateFields.push(`cepe_code = $${paramIndex}`);
            updateValues.push(data.cepeCode || null);
            paramIndex++;
          }

          if (data.enrollmentDate) {
            updateFields.push(`enrollment_date = $${paramIndex}`);
            updateValues.push(data.enrollmentDate);
            paramIndex++;
          }

          if (data.fees) {
            updateFields.push(`fees = $${paramIndex}`);
            updateValues.push(JSON.stringify(data.fees));
            paramIndex++;
          }

          if (data.status !== undefined) {
            updateFields.push(`status = $${paramIndex}`);
            updateValues.push(data.status);
            paramIndex++;
          }

          if (updateFields.length === 0) {
            await client.query('ROLLBACK');
            return reply.status(400).send({
              error: "Bad Request",
              message: "No valid fields to update",
            });
          }

          updateFields.push(`updated_at = NOW()`);

          const updateQuery = `
            UPDATE student_enrollments
            SET ${updateFields.join(', ')}
            WHERE id = $1 AND tenant_id = $2
            RETURNING id, tenant_id, student_id, class_id, academic_year_id, fees, origin_school, lv2,
                      scholarship_level, is_repeating, is_transfer, is_inscribed, transfer_decision,
                      affectation_status, affectation_decision, cepe_code, enrollment_date, status, created_at, updated_at
          `;

          const result = await client.query(updateQuery, [id, request.tenantId, ...updateValues]);

          await client.query('COMMIT');

          const enrollment = result.rows[0];
          return reply.status(200).send({
            data: {
              id: enrollment.id,
              tenantId: enrollment.tenant_id,
              studentId: enrollment.student_id,
              classId: enrollment.class_id,
              academicYearId: enrollment.academic_year_id,
              fees: enrollment.fees,
              originSchool: enrollment.origin_school,
              lv2: enrollment.lv2,
              scholarshipLevel: enrollment.scholarship_level,
              isRepeating: enrollment.is_repeating,
              isTransfer: enrollment.is_transfer,
              isInscribed: enrollment.is_inscribed,
              transferDecision: enrollment.transfer_decision,
              affectationStatus: enrollment.affectation_status,
              affectationDecision: enrollment.affectation_decision,
              cepeCode: enrollment.cepe_code,
              enrollmentDate: enrollment.enrollment_date,
              status: enrollment.status,
              createdAt: enrollment.created_at,
              updatedAt: enrollment.updated_at,
            },
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

        fastify.log.error(`Error updating enrollment: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to update enrollment",
        });
      }
    },
  });

  // DELETE /api/v1/enrollments/:id - Delete enrollment
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        204: {
          type: "null",
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
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

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Check if enrollment exists and belongs to tenant
        const existingQuery = `
          SELECT id FROM student_enrollments
          WHERE id = $1 AND tenant_id = $2
        `;
        const existingResult = await client.query(existingQuery, [id, request.tenantId]);

        if (existingResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({
            error: "Not Found",
            message: "Enrollment not found",
          });
        }

        // Delete the enrollment
        const deleteQuery = `
          DELETE FROM student_enrollments
          WHERE id = $1 AND tenant_id = $2
        `;
        await client.query(deleteQuery, [id, request.tenantId]);

        await client.query('COMMIT');
        reply.status(204).send();
      } catch (error) {
        await client.query('ROLLBACK');
        fastify.log.error(`Error deleting enrollment: ${error}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: "An error occurred while deleting the enrollment",
        });
      } finally {
        client.release();
      }
    },
  });

  // Fix enrollment fees endpoint (temporary)
  fastify.post('/fix-fees', {
    schema: {
      description: 'Fix enrollment fees that have empty objects',
      tags: ['enrollments'],
      headers: {
        type: 'object',
        properties: {
          'X-Tenant': { type: 'string' }
        },
        required: ['X-Tenant']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            updated: { type: 'number' }
          }
        }
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      const client = await fastify.pg.connect();
      try {
        // Check current state
        const checkQuery = `
          SELECT COUNT(*) as count
          FROM student_enrollments
          WHERE tenant_id = $1 AND (fees = '{}'::jsonb OR fees IS NULL)
        `;

        const checkResult = await client.query(checkQuery, [request.tenantId]);
        const emptyFeesCount = parseInt(checkResult.rows[0].count);

        if (emptyFeesCount > 0) {
          // Update enrollments with empty fees
          const updateQuery = `
            UPDATE student_enrollments
            SET fees = '{"inscription": 0, "scolarite": 0, "annexes": 0, "autres": 0, "total": 0, "currency": "XOF"}'::jsonb
            WHERE tenant_id = $1 AND (fees = '{}'::jsonb OR fees IS NULL)
          `;

          const updateResult = await client.query(updateQuery, [request.tenantId]);

          return reply.send({
            message: `Fixed ${updateResult.rowCount} enrollments with empty fees`,
            updated: updateResult.rowCount
          });
        } else {
          return reply.send({
            message: 'No enrollments need fixing',
            updated: 0
          });
        }

      } catch (error) {
        fastify.log.error(`Error fixing enrollment fees: ${error}`);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to fix enrollment fees",
        });
      } finally {
        client.release();
      }
    }
  });
}
