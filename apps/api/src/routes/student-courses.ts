import { FastifyInstance } from "fastify";
import { z } from "zod";

const StudentCoursesQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
  status: z.enum(['active', 'completed', 'upcoming', 'all']).default('all'),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0)
});

const StudentCourseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  credits: z.number().nullable(),
  instructor: z.object({
    id: z.string().uuid(),
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().email()
  }).nullable(),
  status: z.string(),
  progress: z.number().min(0).max(100).default(0),
  next_session: z.string().nullable(),
  total_hours: z.number().nullable(),
  completed_hours: z.number().nullable(),
  is_favorite: z.boolean().default(false)
});

const StudentCoursesResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(StudentCourseSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    has_more: z.boolean()
  })
});

export async function studentCoursesRoutes(fastify: FastifyInstance) {
  // GET /api/v1/student/courses - Liste des cours de l'étudiant
  fastify.get("/", async (request, reply) => {
    const query = request.query as any;
    const { student_id, status, search, limit = 20, offset = 0 } = query;
    const tenantId = request.headers['x-tenant'] as string;
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;
    
    try {
      const client = await fastify.pg.connect();

      try {
        // 1. Convertir le nom du tenant en UUID
        let actualTenantId = tenantId;

        // Si le tenantId n'est pas un UUID, le chercher par nom
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(tenantId)) {
          const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
          const tenantResult = await client.query(tenantQuery, [tenantId]);

          if (tenantResult.rows.length === 0) {
            return {
              success: true,
              data: [],
              pagination: { total: 0, limit, offset, has_more: false }
            };
          }

          actualTenantId = tenantResult.rows[0].id;
        }

        // 2. Trouver l'étudiant à partir de l'utilisateur connecté ou du student_id fourni
        let studentId = student_id;

        // DEBUG: Log initial parameters
        fastify.log.info('Student courses request:', {
          student_id,
          tenantId,
          actualTenantId,
          status,
          search,
          limit,
          offset
        });

        if (!studentId) {
          // Check if we have a specific student ID in headers (for testing)
          const headerStudentId = request.headers['x-student-id'] as string;
          if (headerStudentId) {
            studentId = headerStudentId;
            fastify.log.info('Using student ID from header:', { studentId });
          } else {
            const studentQuery = `
              SELECT sp.id as student_id, sp.user_id
              FROM student_profiles sp
              WHERE sp.tenant_id = $1 AND sp.user_id = $2
            `;

            // Get user ID from request (dev mode or authenticated user)
            const userId = request.user?.id || (request.headers['x-user-id'] as string) || '6d9dd979-1dfa-4c53-95b0-2b536094f429';
            const studentResult = await client.query(studentQuery, [actualTenantId, userId]);

            fastify.log.info('Student lookup by user ID:', {
              userId,
              found: studentResult.rows.length,
              studentId: studentResult.rows[0]?.student_id
            });

            if (studentResult.rows.length === 0) {
              // If no student found for the user, try to find any student for testing
              const anyStudentQuery = `
                SELECT sp.id as student_id, sp.user_id, u.first_name, u.last_name
                FROM student_profiles sp
                JOIN users u ON sp.user_id = u.id
                WHERE sp.tenant_id = $1
                ORDER BY sp.created_at DESC
                LIMIT 1
              `;
              const anyStudentResult = await client.query(anyStudentQuery, [actualTenantId]);

              fastify.log.info('Fallback to any student:', {
                found: anyStudentResult.rows.length,
                student: anyStudentResult.rows[0]
              });

              if (anyStudentResult.rows.length === 0) {
                return {
                  success: true,
                  data: [],
                  pagination: { total: 0, limit, offset, has_more: false }
                };
              }

              studentId = anyStudentResult.rows[0].student_id;
            } else {
              studentId = studentResult.rows[0].student_id;
            }
          }
        }

        fastify.log.info('Using student ID:', { studentId });

        // 3. Trouver la classe dans laquelle l'étudiant est inscrit
        const enrollmentQuery = `
          SELECT se.class_id, se.status, c.name as class_name, c.code as class_code
          FROM student_enrollments se
          JOIN classes c ON se.class_id = c.id
          WHERE se.tenant_id = $1
            AND se.student_id = $2
            AND se.status = 'active'
            AND ($3::uuid IS NULL OR c.academic_year_id = $3::uuid)
          ORDER BY se.created_at DESC
          LIMIT 1
        `;

        const enrollmentResult = await client.query(enrollmentQuery, [actualTenantId, studentId, activeAcademicYearId || null]);

        fastify.log.info('Enrollment lookup result:', {
          found: enrollmentResult.rows.length,
          enrollment: enrollmentResult.rows[0]
        });

        if (enrollmentResult.rows.length === 0) {
          fastify.log.warn('No active enrollment found for student:', { studentId, actualTenantId });
          return {
            success: true,
            data: [],
            pagination: { total: 0, limit, offset, has_more: false }
          };
        }

        const classId = enrollmentResult.rows[0].class_id;
        fastify.log.info('Found class for student:', {
          classId,
          className: enrollmentResult.rows[0].class_name,
          classCode: enrollmentResult.rows[0].class_code
        });

        // 4. Récupérer les cours de cette classe
        // Statuts de démo synthétisés (l'enum course_status n'inclut que draft/active/inactive,
        // donc on dérive 'completed' / 'upcoming' / 'active' à partir du rang du cours).
        const coursesQuery = `
          WITH ranked_courses AS (
            SELECT
              c.id,
              c.name,
              c.code,
              c.description,
              c.hours_total,
              c.hours_theory,
              c.hours_practical,
              cc.is_required,
              ROW_NUMBER() OVER (ORDER BY c.name) AS rn
            FROM courses c
            JOIN class_courses cc ON c.id = cc.course_id
            WHERE cc.tenant_id = $1 AND cc.class_id = $2 AND c.status = 'active'
          )
          SELECT
            id,
            name,
            code,
            description,
            hours_total,
            hours_theory,
            hours_practical,
            is_required,
            CASE (rn - 1) % 5
              WHEN 0 THEN 'completed'
              WHEN 1 THEN 'upcoming'
              ELSE 'active'
            END AS status,
            CASE (rn - 1) % 5
              WHEN 0 THEN 100
              WHEN 1 THEN 0
              ELSE 75
            END AS progress,
            NULL as next_session,
            hours_total as total_hours,
            CASE (rn - 1) % 5
              WHEN 0 THEN hours_total
              WHEN 1 THEN 0
              ELSE FLOOR(hours_total * 0.75)
            END as completed_hours,
            false as is_favorite,
            NULL as instructor
          FROM ranked_courses
          ORDER BY name
        `;

        fastify.log.info('Querying courses for class:', { actualTenantId, classId });
        const coursesResult = await client.query(coursesQuery, [actualTenantId, classId]);

        fastify.log.info('Courses query result:', {
          found: coursesResult.rows.length,
          courses: coursesResult.rows.map(row => ({ id: row.id, name: row.name, code: row.code }))
        });
        const allCourses = coursesResult.rows;

        // 5. Filtrer par statut si spécifié
        let filteredCourses = allCourses;
        if (status && status !== 'all') {
          filteredCourses = allCourses.filter(course => course.status === status);
        }

        // 6. Filtrer par recherche si spécifiée
        if (search && search.trim()) {
          const searchLower = search.toLowerCase();
          filteredCourses = filteredCourses.filter(course =>
            course.name.toLowerCase().includes(searchLower) ||
            course.code.toLowerCase().includes(searchLower)
          );
        }

        // 7. Pagination
        const total = filteredCourses.length;
        const paginatedCourses = filteredCourses.slice(offset, offset + limit);

        return {
          success: true,
          data: paginatedCourses,
          pagination: {
            total,
            limit,
            offset,
            has_more: offset + limit < total
          }
        };

      } finally {
        client.release();
      }

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des cours'
      });
    }
  });

  // GET /api/v1/student/courses/:id - Détails d'un cours
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as any;
    const { student_id } = query;
    const tenantId = request.headers['x-tenant'] as string;
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

    try {
      const client = await fastify.pg.connect();

      try {
        // 1. Convertir le nom du tenant en UUID
        let actualTenantId = tenantId;

        // Si le tenantId n'est pas un UUID, le chercher par nom
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(tenantId)) {
          const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
          const tenantResult = await client.query(tenantQuery, [tenantId]);

          if (tenantResult.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: 'Tenant non trouvé'
            });
          }

          actualTenantId = tenantResult.rows[0].id;
        }

        // 2. Trouver l'étudiant à partir du student_id fourni ou de l'utilisateur connecté
        let studentId = student_id;

        // Check if we have a specific student ID in headers (for testing)
        const headerStudentId = request.headers['x-student-id'] as string;
        if (headerStudentId) {
          studentId = headerStudentId;
          fastify.log.info('Using student ID from header:', { studentId });
        } else if (!studentId) {
          const userId = request.user?.id || (request.headers['x-user-id'] as string) || '6d9dd979-1dfa-4c53-95b0-2b536094f429';
          const studentQuery = `
            SELECT sp.id as student_id, sp.user_id
            FROM student_profiles sp
            WHERE sp.tenant_id = $1 AND sp.user_id = $2
          `;

          const studentResult = await client.query(studentQuery, [actualTenantId, userId]);

          if (studentResult.rows.length === 0) {
            // If no student found for the user, try to find any student for testing
            const anyStudentQuery = `
              SELECT sp.id as student_id, sp.user_id, u.first_name, u.last_name
              FROM student_profiles sp
              JOIN users u ON sp.user_id = u.id
              WHERE sp.tenant_id = $1
              ORDER BY sp.created_at DESC
              LIMIT 1
            `;
            const anyStudentResult = await client.query(anyStudentQuery, [actualTenantId]);

            if (anyStudentResult.rows.length === 0) {
              return reply.status(404).send({
                success: false,
                error: 'Étudiant non trouvé'
              });
            }

            studentId = anyStudentResult.rows[0].student_id;
          } else {
            studentId = studentResult.rows[0].student_id;
          }
        }

        // 3. Trouver la classe dans laquelle l'étudiant est inscrit
        const enrollmentQuery = `
          SELECT se.class_id
          FROM student_enrollments se
          JOIN classes c ON se.class_id = c.id
          WHERE se.tenant_id = $1
            AND se.student_id = $2
            AND se.status = 'active'
            AND ($3::uuid IS NULL OR c.academic_year_id = $3::uuid)
          ORDER BY se.created_at DESC
          LIMIT 1
        `;

        const enrollmentResult = await client.query(enrollmentQuery, [actualTenantId, studentId, activeAcademicYearId || null]);

        if (enrollmentResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Aucune inscription active trouvée'
          });
        }

        const classId = enrollmentResult.rows[0].class_id;

        // 4. Récupérer le cours spécifique de cette classe
        // Le statut de démo doit correspondre à celui de la liste — même rangement par nom.
        const courseQuery = `
          WITH ranked_courses AS (
            SELECT
              c.id,
              c.name,
              c.code,
              c.description,
              c.hours_total,
              c.hours_theory,
              c.hours_practical,
              cc.is_required,
              ROW_NUMBER() OVER (ORDER BY c.name) AS rn
            FROM courses c
            JOIN class_courses cc ON c.id = cc.course_id
            WHERE cc.tenant_id = $1 AND cc.class_id = $2 AND c.status = 'active'
          )
          SELECT
            id,
            name,
            code,
            description,
            hours_total,
            hours_theory,
            hours_practical,
            is_required,
            CASE (rn - 1) % 5
              WHEN 0 THEN 'completed'
              WHEN 1 THEN 'upcoming'
              ELSE 'active'
            END AS status,
            CASE (rn - 1) % 5
              WHEN 0 THEN 100
              WHEN 1 THEN 0
              ELSE 75
            END AS progress,
            NULL as next_session,
            hours_total as total_hours,
            CASE (rn - 1) % 5
              WHEN 0 THEN hours_total
              WHEN 1 THEN 0
              ELSE FLOOR(hours_total * 0.75)
            END as completed_hours,
            false as is_favorite,
            NULL as instructor
          FROM ranked_courses
          WHERE id = $3
        `;

        const courseResult = await client.query(courseQuery, [actualTenantId, classId, id]);

        if (courseResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Cours non trouvé'
          });
        }

        const course = courseResult.rows[0];

        return {
          success: true,
          data: course
        };

      } finally {
        client.release();
      }

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération du cours'
      });
    }
  });

  // GET /api/v1/student/courses/test-materials - Test endpoint pour vérifier les supports
  fastify.get("/test-materials", async (request, reply) => {
    try {
      const client = await fastify.pg.connect();

      try {
        // Test simple pour voir s'il y a des supports
        const testQuery = `
          SELECT
            cm.id,
            cm.title,
            cm.course_id,
            c.name as course_name,
            cm.tenant_id
          FROM course_materials cm
          LEFT JOIN courses c ON cm.course_id = c.id
          LIMIT 5
        `;

        const testResult = await client.query(testQuery);

        return {
          success: true,
          data: testResult.rows,
          count: testResult.rows.length
        };

      } finally {
        client.release();
      }

    } catch (error) {
      fastify.log.error(`Error in test materials endpoint: ${error}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du test des supports'
      });
    }
  });

  // GET /api/v1/student/courses/debug-student-data - Debug endpoint to verify student data
  fastify.get("/debug-student-data", async (request, reply) => {
    const query = request.query as any;
    const { student_id } = query;
    const tenantId = request.headers['x-tenant'] as string;

    try {
      const client = await fastify.pg.connect();

      try {
        const actualTenantId = tenantId === 'imhotepacademy' ? '6eb9c106-b650-4398-b6fa-091b6828c4ba' : tenantId;
        const actualStudentId = student_id || '528ffa5a-e649-4794-9dad-c08e2991f93e';

        // 1. Check if student exists
        const studentQuery = `
          SELECT sp.id, sp.user_id, sp.student_number, sp.status, u.first_name, u.last_name, u.email
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE sp.id = $1 AND sp.tenant_id = $2
        `;
        const studentResult = await client.query(studentQuery, [actualStudentId, actualTenantId]);

        // 2. Check student enrollment
        const enrollmentQuery = `
          SELECT se.id, se.class_id, se.status, c.name as class_name, c.code as class_code
          FROM student_enrollments se
          JOIN classes c ON se.class_id = c.id
          WHERE se.student_id = $1 AND se.tenant_id = $2
        `;
        const enrollmentResult = await client.query(enrollmentQuery, [actualStudentId, actualTenantId]);

        // 3. Check class courses if enrollment exists
        let classCoursesResult = { rows: [] };
        if (enrollmentResult.rows.length > 0) {
          const classId = enrollmentResult.rows[0].class_id;
          const classCoursesQuery = `
            SELECT cc.id, cc.class_id, cc.course_id, cc.is_required,
                   c.name as course_name, c.code as course_code, c.status as course_status
            FROM class_courses cc
            JOIN courses c ON cc.course_id = c.id
            WHERE cc.class_id = $1 AND cc.tenant_id = $2
          `;
          classCoursesResult = await client.query(classCoursesQuery, [classId, actualTenantId]);
        }

        return {
          success: true,
          debug_data: {
            tenant_id: actualTenantId,
            student_id: actualStudentId,
            student: studentResult.rows[0] || null,
            enrollment: enrollmentResult.rows[0] || null,
            class_courses: classCoursesResult.rows,
            counts: {
              student_found: studentResult.rows.length,
              enrollments_found: enrollmentResult.rows.length,
              class_courses_found: classCoursesResult.rows.length
            }
          }
        };

      } finally {
        client.release();
      }

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du debug des données étudiant'
      });
    }
  });

  // GET /api/v1/student/courses/check-table-structure - Vérifier la structure de la table
  fastify.get("/check-table-structure", async (request, reply) => {
    try {
      const client = await fastify.pg.connect();

      try {
        const structureQuery = `
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = 'course_materials'
          ORDER BY ordinal_position
        `;

        const structureResult = await client.query(structureQuery);

        return {
          success: true,
          data: structureResult.rows
        };

      } finally {
        client.release();
      }

    } catch (error) {
      fastify.log.error(`Error checking table structure: ${error}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la vérification de la structure'
      });
    }
  });

  // POST /api/v1/student/courses/create-test-materials - Créer des supports de test
  fastify.post("/create-test-materials", async (request, reply) => {
    const tenantId = request.headers['x-tenant'] as string;

    try {
      const client = await fastify.pg.connect();

      try {
        // 1. Convertir le nom du tenant en UUID
        let actualTenantId = tenantId;

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(tenantId)) {
          const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
          const tenantResult = await client.query(tenantQuery, [tenantId]);

          if (tenantResult.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: 'Tenant non trouvé'
            });
          }

          actualTenantId = tenantResult.rows[0].id;
        }

        // 2. Créer des supports pour le cours "Algorithmique Avancée"
        const courseId = '970e8400-e29b-41d4-a716-446655440201';
        const devUserId = '6d9dd979-1dfa-4c53-95b0-2b536094f429';

        const materials = [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            title: 'Introduction aux Algorithmes',
            file_name: 'intro_algorithmes.pdf',
            file_type: 'application/pdf',
            file_size: 2500000,
            minio_key: 'course-materials/intro_algorithmes.pdf',
            processing_status: 'completed'
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            title: 'Algorithmes de Tri',
            file_name: 'algorithmes_tri.mp4',
            file_type: 'video/mp4',
            file_size: 15000000,
            minio_key: 'course-materials/algorithmes_tri.mp4',
            processing_status: 'completed'
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440003',
            title: 'Exercices Pratiques',
            file_name: 'exercices_graphes.pdf',
            file_type: 'application/pdf',
            file_size: 1800000,
            minio_key: 'course-materials/exercices_graphes.pdf',
            processing_status: 'completed'
          }
        ];

        for (const material of materials) {
          const insertQuery = `
            INSERT INTO course_materials (
              id, tenant_id, course_id, title, file_name,
              file_type, file_size, minio_key, uploaded_by, processing_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO NOTHING
          `;

          await client.query(insertQuery, [
            material.id,
            actualTenantId,
            courseId,
            material.title,
            material.file_name,
            material.file_type,
            material.file_size,
            material.minio_key,
            devUserId,
            material.processing_status
          ]);
        }

        return {
          success: true,
          message: 'Supports de test créés avec succès',
          count: materials.length
        };

      } finally {
        client.release();
      }

    } catch (error) {
      fastify.log.error(`Error creating test materials: ${error}`);
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la création des supports de test'
      });
    }
  });

  // GET /api/v1/student/courses/:id/materials - Supports d'un cours
  fastify.get("/:id/materials", async (request, reply) => {
    const { id: courseId } = request.params as { id: string };
    const tenantId = request.headers['x-tenant'] as string;
    
    try {
      const client = await fastify.pg.connect();

      try {
        // 1. Convertir le nom du tenant en UUID
        let actualTenantId = tenantId;

        // Si le tenantId n'est pas un UUID, le chercher par nom
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(tenantId)) {
          const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
          const tenantResult = await client.query(tenantQuery, [tenantId]);

          if (tenantResult.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: "Tenant not found"
            });
          }

          actualTenantId = tenantResult.rows[0].id;
        }

        // 2. Trouver l'étudiant à partir de l'utilisateur connecté ou du student_id fourni
        let studentId = request.headers['x-student-id'] as string;

        if (!studentId) {
          // Get user ID from request (dev mode or authenticated user)
          const userId = request.user?.id || (request.headers['x-user-id'] as string) || '6d9dd979-1dfa-4c53-95b0-2b536094f429';
          const studentQuery = `
            SELECT sp.id as student_id, sp.user_id
            FROM student_profiles sp
            WHERE sp.tenant_id = $1 AND sp.user_id = $2
          `;
          const studentResult = await client.query(studentQuery, [actualTenantId, userId]);

          if (studentResult.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: "Aucune inscription active trouvée"
            });
          }

          studentId = studentResult.rows[0].student_id;
        }

        // 3. Vérifier que l'étudiant a accès à ce cours
        const courseAccessQuery = `
          SELECT c.id
          FROM courses c
          JOIN class_courses cc ON c.id = cc.course_id
          JOIN student_enrollments se ON cc.class_id = se.class_id
          WHERE c.id = $1 
            AND c.tenant_id = $2 
            AND se.student_id = $3 
            AND se.status = 'active'
            AND c.status = 'active'
        `;

        const courseResult = await client.query(courseAccessQuery, [courseId, actualTenantId, studentId]);

        if (courseResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "Cours non trouvé ou accès non autorisé"
          });
        }

        // 4. Récupérer les supports du cours
        const materialsQuery = `
          SELECT 
            cm.id,
            cm.title,
            cm.course_id,
            cm.tenant_id,
            cm.created_at,
            cm.updated_at
          FROM course_materials cm
          WHERE cm.course_id = $1 AND cm.tenant_id = $2
          ORDER BY cm.created_at DESC
        `;

        const materialsResult = await client.query(materialsQuery, [courseId, actualTenantId]);

        const materials = materialsResult.rows.map(material => ({
          id: material.id,
          title: material.title,
          course_id: material.course_id,
          tenant_id: material.tenant_id,
          created_at: material.created_at,
          updated_at: material.updated_at,
          description: null, // Not available in current schema
          file_path: null, // Not available in current schema
          file_type: null, // Not available in current schema
          file_size: null, // Not available in current schema
          author: null // Not available in current schema
        }));

        return reply.send({
          success: true,
          data: materials
        });

      } finally {
        client.release();
      }
    } catch (error) {
      fastify.log.error(`Error fetching course materials: ${error}`);
      return reply.status(500).send({
        success: false,
        error: "Internal Server Error",
        message: "Failed to fetch course materials"
      });
    }
  });

  // GET /api/v1/student/courses/schedule - Récupérer le planning de l'étudiant
  fastify.get("/schedule", async (request, reply) => {
    const query = request.query as any;
    const { startDate, endDate } = query;
    const tenantId = request.headers['x-tenant'] as string;
    const userId = request.headers['x-user-id'] as string;
    const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

    if (!tenantId) {
      return reply.status(400).send({
        error: "Tenant Required",
        message: "This endpoint requires tenant context",
      });
    }

    if (!userId) {
      return reply.status(400).send({
        error: "User ID Required",
        message: "This endpoint requires user ID",
      });
    }

    try {
      const client = await fastify.pg.connect();

      try {
        // Convertir le tenantId en UUID si nécessaire
        let actualTenantId = tenantId;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(tenantId)) {
          const tenantQuery = `SELECT id FROM tenants WHERE LOWER(name) = LOWER($1) OR LOWER(REPLACE(name, ' ', '')) = LOWER($1)`;
          const tenantResult = await client.query(tenantQuery, [tenantId]);

          if (tenantResult.rows.length === 0) {
            return reply.status(404).send({
              error: "Tenant Not Found",
              message: "The specified tenant does not exist",
            });
          }

          actualTenantId = tenantResult.rows[0].id;
        }

        // Trouver l'étudiant à partir de l'utilisateur connecté
        const studentQuery = `
          SELECT sp.id as student_id
          FROM student_profiles sp
          JOIN users u ON sp.user_id = u.id
          WHERE u.id = $1 AND sp.tenant_id = $2
        `;
        const studentResult = await client.query(studentQuery, [userId, actualTenantId]);

        if (studentResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Student Not Found",
            message: "No student profile found for this user",
          });
        }

        const studentId = studentResult.rows[0].student_id;

        // Calculer les dates de début et fin si non fournies
        const weekStart = startDate || new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];
        const weekEnd = endDate || new Date(Date.now() + 21 * 864e5).toISOString().split('T')[0];

        // Récupérer les sessions de l'étudiant via student_enrollments
        const scheduleQuery = `
          SELECT 
            si.id,
            si.session_date as date,
            si.start_time::text as start_time,
            si.end_time::text as end_time,
            si.start_datetime::text as start_datetime,
            si.end_datetime::text as end_datetime,
            c.name as course_name,
            c.code as course_code,
            si.classroom,
            COALESCE(u.first_name || ' ' || u.last_name, u.name, 'TBD') as teacher_name,
            si.class_id,
            si.course_id,
            si.status,
            si.duration_minutes
          FROM session_instances si
          JOIN student_enrollments se ON si.class_id = se.class_id
          JOIN classes cl ON se.class_id = cl.id
          JOIN courses c ON si.course_id = c.id
          LEFT JOIN teachers t ON si.teacher_id = t.id
          LEFT JOIN users u ON t.user_id = u.id
          WHERE se.student_id = $1
            AND se.tenant_id = $2
            AND se.status = 'active'
            AND si.tenant_id = $2
            AND si.session_date >= $3
            AND si.session_date <= $4
            AND ($5::uuid IS NULL OR cl.academic_year_id = $5::uuid)
            AND (si.status IS NULL OR si.status = 'scheduled' OR si.status = 'completed')
          ORDER BY si.session_date ASC, si.start_time ASC
        `;

        const scheduleResult = await client.query(scheduleQuery, [
          studentId,
          actualTenantId,
          weekStart,
          weekEnd,
          activeAcademicYearId || null,
        ]);

        return reply.send({
          success: true,
          data: scheduleResult.rows.map((row: any) => ({
            id: row.id,
            sessionDate: row.date,
            startTime: row.start_time,
            endTime: row.end_time,
            startDatetime: row.start_datetime,
            endDatetime: row.end_datetime,
            courseName: row.course_name,
            courseCode: row.course_code,
            classroom: row.classroom,
            teacherName: row.teacher_name,
            classId: row.class_id,
            courseId: row.course_id,
            status: row.status,
            durationMinutes: row.duration_minutes,
          })),
        });

      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error('Error fetching student schedule:', error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: error.message || "Failed to fetch student schedule",
      });
    }
  });
}
