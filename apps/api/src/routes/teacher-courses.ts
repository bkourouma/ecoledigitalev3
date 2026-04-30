import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface TeacherCoursesRequest extends FastifyRequest {
  user?: {
    id: string;
    role: string;
  };
  tenantId: string;
}

interface CourseDetailParams {
  id: string;
}

export async function teacherCoursesRoutes(fastify: FastifyInstance) {
  
  // GET /api/v1/teacher/courses - Get all courses for a teacher
  fastify.get('/courses', {
    schema: {
      description: 'Get all courses assigned to the authenticated teacher',
      tags: ['Teacher Courses'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              assignmentId: { type: 'string' },
              classCourseId: { type: 'string' },
              courseId: { type: 'string' },
              courseName: { type: 'string' },
              courseCode: { type: 'string' },
              courseDescription: { type: 'string' },
              className: { type: 'string' },
              classId: { type: 'string' },
              programName: { type: 'string' },
              cycleName: { type: 'string' },
              teacherName: { type: 'string' },
              datebut: { type: 'string' },
              datefin: { type: 'string' },
              contractType: { type: 'string' },
              courseAmount: { type: 'string' },
              hoursValidated: { type: 'number' },
              materialsCount: { type: 'number' },
              totalMaterialsSize: { type: 'number' },
              status: { type: 'string' }
            }
          }
        }
      }
    }
  }, async (request: TeacherCoursesRequest, reply: FastifyReply) => {
    try {
      // Get user ID from header or authenticated user
      const userIdHeader = request.headers['x-user-id'] as string;
      const userId = userIdHeader || request.user?.id;
      const tenantId = request.tenantId;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

      fastify.log.info({ tenantId, userIdHeader, userId }, 'Teacher courses request');

      if (!userId) {
        return reply.status(401).send({
          error: 'Authentication Required',
          message: 'User ID is required'
        });
      }

      // Convert user ID to teacher ID
      const teacherQuery = await fastify.pg.query(
        'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
        [userId, request.tenantId]
      );

      if (teacherQuery.rows.length === 0) {
        return reply.status(404).send({
          error: 'Teacher Not Found',
          message: 'No teacher profile found for this user'
        });
      }

      const teacherId = teacherQuery.rows[0].id;

      // Get all courses assigned to this teacher
      const queryParams: any[] = [teacherId, request.tenantId];
      let academicYearFilter = "";
      if (activeAcademicYearId) {
        academicYearFilter = " AND cl.academic_year_id = $3";
        queryParams.push(activeAcademicYearId);
      }

      const coursesQuery = await fastify.pg.query(`
        SELECT
          ta.id as assignment_id,
          ta.class_course_id,
          ta.teacher_id,
          ta.datebut,
          ta.datefin,
          ta.contract_type,
          ta.course_amount,
          ta.hours_validated,
          ta.created_at as assignment_created_at,
          c.id as course_id,
          c.name as course_name,
          c.code as course_code,
          c.description as course_description,
          cl.name as class_name,
          cl.id as class_id,
          p.name as program_name,
          cy.name as cycle_name,
          t.first_name as teacher_first_name,
          t.last_name as teacher_last_name,
          -- Count materials for each course
          (SELECT COUNT(*) FROM course_materials cm WHERE cm.course_id = c.id) as materials_count,
          -- Calculate total file size for materials
          (SELECT COALESCE(SUM(cm.file_size), 0) FROM course_materials cm WHERE cm.course_id = c.id) as total_materials_size
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN courses c ON cc.course_id = c.id
        JOIN classes cl ON cc.class_id = cl.id
        JOIN programmes p ON cl.programme_id = p.id
        JOIN cycles cy ON p.cycle_id = cy.id
        JOIN teachers t ON ta.teacher_id = t.id
        WHERE ta.teacher_id = $1 AND ta.tenant_id = $2${academicYearFilter}
        ORDER BY ta.datebut DESC, c.name ASC
      `, queryParams);

      // Format the response
      const courses = coursesQuery.rows.map(row => ({
        assignmentId: row.assignment_id,
        classCourseId: row.class_course_id,  // Keep the class_course_id for reference
        courseId: row.course_id,  // FIXED: Use the actual course ID from courses table
        courseName: row.course_name,
        courseCode: row.course_code,
        courseDescription: row.course_description,
        className: row.class_name,
        classId: row.class_id,
        programName: row.program_name,
        cycleName: row.cycle_name,
        teacherName: `${row.teacher_first_name} ${row.teacher_last_name}`,
        datebut: row.datebut,
        datefin: row.datefin,
        contractType: row.contract_type,
        courseAmount: row.course_amount,
        hoursValidated: row.hours_validated,
        materialsCount: parseInt(row.materials_count),
        totalMaterialsSize: parseInt(row.total_materials_size),
        assignmentCreatedAt: row.assignment_created_at,
        // Determine status based on dates
        status: (() => {
          const now = new Date();
          const startDate = new Date(row.datebut);
          const endDate = new Date(row.datefin);
          
          if (now < startDate) return 'pending';
          if (now > endDate) return 'completed';
          return 'active';
        })()
      }));

      return reply.send(courses);

    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching teacher courses');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch teacher courses',
        details: error?.message || String(error)
      });
    }
  });

  // GET /api/v1/teacher/courses/:id - Get specific course details for a teacher
  fastify.get<{ Params: CourseDetailParams }>('/courses/:id', {
    schema: {
      description: 'Get specific course details for the authenticated teacher',
      tags: ['Teacher Courses'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            assignmentId: { type: 'string' },
            courseId: { type: 'string' },
            courseName: { type: 'string' },
            courseCode: { type: 'string' },
            courseDescription: { type: 'string' },
            className: { type: 'string' },
            classId: { type: 'string' },
            programName: { type: 'string' },
            cycleName: { type: 'string' },
            teacherName: { type: 'string' },
            datebut: { type: 'string' },
            datefin: { type: 'string' },
            contractType: { type: 'string' },
            courseAmount: { type: 'string' },
            hoursValidated: { type: 'number' },
            materialsCount: { type: 'number' },
            totalMaterialsSize: { type: 'number' }
          }
        }
      }
    }
  }, async (request: TeacherCoursesRequest, reply: FastifyReply) => {
    try {
      const assignmentId = request.params.id;
      const activeAcademicYearId = request.headers['x-academic-year-id'] as string | undefined;

      // Get user ID from header or authenticated user
      const userIdHeader = request.headers['x-user-id'] as string;
      const userId = userIdHeader || request.user?.id;

      if (!userId) {
        return reply.status(401).send({
          error: 'Authentication Required',
          message: 'User ID is required'
        });
      }

      // Convert user ID to teacher ID
      const teacherQuery = await fastify.pg.query(
        'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
        [userId, request.tenantId]
      );

      if (teacherQuery.rows.length === 0) {
        return reply.status(404).send({
          error: 'Teacher Not Found',
          message: 'No teacher profile found for this user'
        });
      }

      const teacherId = teacherQuery.rows[0].id;

      // Get course details with teacher assignment information
      const detailParams: any[] = [assignmentId, teacherId, request.tenantId];
      let detailAcademicYearFilter = "";
      if (activeAcademicYearId) {
        detailAcademicYearFilter = " AND cl.academic_year_id = $4";
        detailParams.push(activeAcademicYearId);
      }

      const courseDetails = await fastify.pg.query(`
        SELECT
          ta.id as assignment_id,
          ta.class_course_id,
          ta.teacher_id,
          ta.datebut,
          ta.datefin,
          ta.contract_type,
          ta.course_amount,
          ta.hours_validated,
          c.name as course_name,
          c.code as course_code,
          c.description as course_description,
          cl.name as class_name,
          cl.id as class_id,
          p.name as program_name,
          cy.name as cycle_name,
          t.first_name as teacher_first_name,
          t.last_name as teacher_last_name
        FROM teacher_assignments ta
        JOIN class_courses cc ON ta.class_course_id = cc.id
        JOIN courses c ON cc.course_id = c.id
        JOIN classes cl ON cc.class_id = cl.id
        JOIN programmes p ON cl.programme_id = p.id
        JOIN cycles cy ON p.cycle_id = cy.id
        JOIN teachers t ON ta.teacher_id = t.id
        WHERE ta.id = $1 AND ta.teacher_id = $2 AND ta.tenant_id = $3${detailAcademicYearFilter}
      `, detailParams);

      if (courseDetails.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Course not found or access denied'
        });
      }

      const course = courseDetails.rows[0];

      // Get the actual course ID from class_courses
      const classCourseQuery = await fastify.pg.query(`
        SELECT course_id FROM class_courses WHERE id = $1
      `, [course.class_course_id]);

      const actualCourseId = classCourseQuery.rows[0]?.course_id;

      // Get materials count for this course
      const materialsCount = await fastify.pg.query(`
        SELECT COUNT(*) as count
        FROM course_materials cm
        WHERE cm.course_id = $1 AND cm.tenant_id = $2
      `, [actualCourseId, request.tenantId]);

      // Get total file size for materials
      const totalSize = await fastify.pg.query(`
        SELECT COALESCE(SUM(cm.file_size), 0) as total_size
        FROM course_materials cm
        WHERE cm.course_id = $1 AND cm.tenant_id = $2
      `, [actualCourseId, request.tenantId]);

      // Format the response
      const response = {
        assignmentId: course.assignment_id,
        courseId: actualCourseId,
        courseName: course.course_name,
        courseCode: course.course_code,
        courseDescription: course.course_description,
        className: course.class_name,
        classId: course.class_id,
        programName: course.program_name,
        cycleName: course.cycle_name,
        teacherName: `${course.teacher_first_name} ${course.teacher_last_name}`,
        datebut: course.datebut,
        datefin: course.datefin,
        contractType: course.contract_type,
        courseAmount: course.course_amount,
        hoursValidated: course.hours_validated,
        materialsCount: parseInt(materialsCount.rows[0].count),
        totalMaterialsSize: parseInt(totalSize.rows[0].total_size)
      };

      return reply.send(response);

    } catch (error) {
      fastify.log.error('Error fetching course details:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch course details'
      });
    }
  });

  // PATCH /api/v1/teacher/courses/:id - Update course assignment details
  fastify.patch<{ Params: CourseDetailParams }>('/courses/:id', {
    schema: {
      description: 'Update course assignment details for the authenticated teacher',
      tags: ['Teacher Courses'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        properties: {
          courseAmount: { type: 'string' },
          contractType: { type: 'string' }
        }
      }
    }
  }, async (request: TeacherCoursesRequest, reply: FastifyReply) => {
    try {
      const assignmentId = request.params.id;
      const body = request.body as any;

      // Get user ID from header or authenticated user
      const userIdHeader = request.headers['x-user-id'] as string;
      const userId = userIdHeader || request.user?.id;

      if (!userId) {
        return reply.status(401).send({
          error: 'Authentication Required',
          message: 'User ID is required'
        });
      }

      // Convert user ID to teacher ID
      const teacherQuery = await fastify.pg.query(
        'SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2',
        [userId, request.tenantId]
      );

      if (teacherQuery.rows.length === 0) {
        return reply.status(404).send({
          error: 'Teacher Not Found',
          message: 'No teacher profile found for this user'
        });
      }

      const teacherId = teacherQuery.rows[0].id;

      // Validate that the teacher owns this assignment
      const assignment = await fastify.pg.query(`
        SELECT id FROM teacher_assignments 
        WHERE id = $1 AND teacher_id = $2 AND tenant_id = $3
      `, [assignmentId, teacherId, request.tenantId]);

      if (assignment.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Course assignment not found or access denied'
        });
      }

      // Update allowed fields
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;

      if (body.courseAmount !== undefined) {
        updateFields.push(`course_amount = $${paramIndex}`);
        updateValues.push(body.courseAmount);
        paramIndex++;
      }

      if (body.contractType !== undefined) {
        updateFields.push(`contract_type = $${paramIndex}`);
        updateValues.push(body.contractType);
        paramIndex++;
      }

      if (updateFields.length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'No fields to update'
        });
      }

      // Add the assignment ID as the last parameter
      updateValues.push(assignmentId);

      const updateQuery = `
        UPDATE teacher_assignments 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await fastify.pg.query(updateQuery, updateValues);

      return reply.send({
        message: 'Course assignment updated successfully',
        assignment: result.rows[0]
      });

    } catch (error) {
      fastify.log.error('Error updating course assignment:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update course assignment'
      });
    }
  });
}
