import { FastifyInstance } from "fastify";

export default async function classCourseRoutes(fastify: FastifyInstance) {
  // GET /api/v1/class-courses/find - Find class-course ID by classId and courseId
  fastify.get("/find", {
    schema: {
      querystring: {
        type: "object",
        required: ["classId", "courseId"],
        properties: {
          classId: { type: "string", format: "uuid" },
          courseId: { type: "string", format: "uuid" },
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
                classId: { type: "string" },
                courseId: { type: "string" },
                isRequired: { type: "boolean" },
                createdAt: { type: "string" },
                course: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    code: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
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
  }, async (request, reply) => {
    const { classId, courseId } = request.query as { classId: string; courseId: string };

    const client = await fastify.pg.connect();
    try {
      // Find the class-course relationship
      const query = `
        SELECT 
          cc.id,
          cc.class_id,
          cc.course_id,
          cc.is_required,
          cc.created_at,
          c.name as course_name,
          c.code as course_code,
          c.description as course_description
        FROM class_courses cc
        JOIN courses c ON cc.course_id = c.id
        WHERE cc.class_id = $1 AND cc.course_id = $2 AND cc.tenant_id = $3
      `;

      const result = await client.query(query, [classId, courseId, request.tenantId]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Class-course relationship not found",
        });
      }

      const row = result.rows[0];
      const classCourse = {
        id: row.id,
        classId: row.class_id,
        courseId: row.course_id,
        isRequired: row.is_required,
        createdAt: row.created_at,
        course: {
          id: row.course_id,
          name: row.course_name,
          code: row.course_code,
          description: row.course_description,
        },
      };

      return reply.send({ data: classCourse });
    } catch (error) {
      fastify.log.error(`Error finding class-course: ${error}`);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Failed to find class-course relationship",
      });
    } finally {
      client.release();
    }
  });

  // POST /api/v1/class-courses - Create a new class-course relationship
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["classId", "courseId"],
        properties: {
          classId: { type: "string", format: "uuid" },
          courseId: { type: "string", format: "uuid" },
          isRequired: { type: "boolean", default: true },
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
                classId: { type: "string" },
                courseId: { type: "string" },
                isRequired: { type: "boolean" },
                createdAt: { type: "string" },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { classId, courseId, isRequired = true } = request.body as {
      classId: string;
      courseId: string;
      isRequired?: boolean;
    };

    const client = await fastify.pg.connect();
    try {
      // Check if the relationship already exists
      const existingQuery = `
        SELECT id FROM class_courses 
        WHERE class_id = $1 AND course_id = $2 AND tenant_id = $3
      `;
      const existingResult = await client.query(existingQuery, [classId, courseId, request.tenantId]);

      if (existingResult.rows.length > 0) {
        // Return the existing relationship
        return reply.send({ data: { id: existingResult.rows[0].id, classId, courseId, isRequired } });
      }

      // Create new relationship
      const insertQuery = `
        INSERT INTO class_courses (tenant_id, class_id, course_id, is_required)
        VALUES ($1, $2, $3, $4)
        RETURNING id, created_at
      `;
      const insertResult = await client.query(insertQuery, [request.tenantId, classId, courseId, isRequired]);

      const newClassCourse = {
        id: insertResult.rows[0].id,
        classId,
        courseId,
        isRequired,
        createdAt: insertResult.rows[0].created_at,
      };

      return reply.status(201).send({ data: newClassCourse });
    } catch (error) {
      fastify.log.error(`Error creating class-course: ${error}`);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Failed to create class-course relationship",
      });
    } finally {
      client.release();
    }
  });

  // GET /api/v1/class-courses/:id - Get class-course by ID
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const client = await fastify.pg.connect();
    try {
      const query = `
        SELECT 
          cc.id,
          cc.class_id,
          cc.course_id,
          cc.is_required,
          cc.created_at,
          c.name as course_name,
          c.code as course_code,
          cl.name as class_name,
          cl.code as class_code
        FROM class_courses cc
        JOIN courses c ON cc.course_id = c.id
        JOIN classes cl ON cc.class_id = cl.id
        WHERE cc.id = $1 AND cc.tenant_id = $2
      `;

      const result = await client.query(query, [id, request.tenantId]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Class-course not found",
        });
      }

      const row = result.rows[0];
      const classCourse = {
        id: row.id,
        classId: row.class_id,
        courseId: row.course_id,
        isRequired: row.is_required,
        createdAt: row.created_at,
        course: {
          id: row.course_id,
          name: row.course_name,
          code: row.course_code,
        },
        class: {
          id: row.class_id,
          name: row.class_name,
          code: row.class_code,
        },
      };

      return reply.send({ data: classCourse });
    } catch (error) {
      fastify.log.error(`Error fetching class-course: ${error}`);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Failed to fetch class-course",
      });
    } finally {
      client.release();
    }
  });
}
