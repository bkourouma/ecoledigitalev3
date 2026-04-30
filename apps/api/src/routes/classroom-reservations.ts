import { FastifyInstance } from "fastify";
import {
  ClassroomReservationSchema,
  CreateReservationSchema,
  UpdateReservationSchema,
  ReservationWithDetailsSchema
} from "@ecoledigitale/contracts/src/classrooms";

export async function classroomReservationsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/classroom-reservations - List reservations
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          classroomId: { type: "string", format: "uuid" },
          courseId: { type: "string", format: "uuid" },
          classId: { type: "string", format: "uuid" },
          status: { type: "string" },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
          includeDetails: { type: "boolean", default: false },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { 
      classroomId, 
      courseId, 
      classId, 
      status, 
      startDate, 
      endDate,
      includeDetails,
      page = 1, 
      limit = 20 
    } = request.query as any;

    try {
      let query = `
        SELECT r.*
        ${includeDetails ? `, 
          json_build_object(
            'id', c.id,
            'name', c.name,
            'code', c.code,
            'type', c.type,
            'building', c.building
          ) as classroom,
          json_build_object(
            'id', u.id,
            'firstName', u.first_name,
            'lastName', u.last_name,
            'email', u.email
          ) as reserved_by_user,
          CASE WHEN r.course_id IS NOT NULL THEN
            json_build_object(
              'id', co.id,
              'name', co.name,
              'code', co.code
            )
          ELSE NULL END as course,
          CASE WHEN r.class_id IS NOT NULL THEN
            json_build_object(
              'id', cl.id,
              'name', cl.name,
              'code', cl.code
            )
          ELSE NULL END as class` : ''}
        FROM classroom_reservations r
        ${includeDetails ? `
          LEFT JOIN classrooms c ON r.classroom_id = c.id
          LEFT JOIN users u ON r.reserved_by = u.id
          LEFT JOIN courses co ON r.course_id = co.id
          LEFT JOIN classes cl ON r.class_id = cl.id
        ` : ''}
        WHERE r.tenant_id = $1
      `;

      const params: any[] = [request.tenantId];
      let paramIndex = 2;

      if (classroomId) {
        query += ` AND r.classroom_id = $${paramIndex}`;
        params.push(classroomId);
        paramIndex++;
      }

      if (courseId) {
        query += ` AND r.course_id = $${paramIndex}`;
        params.push(courseId);
        paramIndex++;
      }

      if (classId) {
        query += ` AND r.class_id = $${paramIndex}`;
        params.push(classId);
        paramIndex++;
      }

      if (status) {
        query += ` AND r.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (startDate) {
        query += ` AND r.start_datetime >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        query += ` AND r.end_datetime <= $${paramIndex}`;
        params.push(endDate);
        paramIndex++;
      }

      query += ` ORDER BY r.start_datetime`;
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, (page - 1) * limit);

      const result = await fastify.pg.query(query, params);

      // Count total for pagination
      let countQuery = `
        SELECT COUNT(*) as total
        FROM classroom_reservations r
        WHERE r.tenant_id = $1
      `;
      const countParams = [request.tenantId];
      let countParamIndex = 2;

      if (classroomId) {
        countQuery += ` AND r.classroom_id = $${countParamIndex}`;
        countParams.push(classroomId);
        countParamIndex++;
      }

      if (courseId) {
        countQuery += ` AND r.course_id = $${countParamIndex}`;
        countParams.push(courseId);
        countParamIndex++;
      }

      if (classId) {
        countQuery += ` AND r.class_id = $${countParamIndex}`;
        countParams.push(classId);
        countParamIndex++;
      }

      if (status) {
        countQuery += ` AND r.status = $${countParamIndex}`;
        countParams.push(status);
        countParamIndex++;
      }

      if (startDate) {
        countQuery += ` AND r.start_datetime >= $${countParamIndex}`;
        countParams.push(startDate);
        countParamIndex++;
      }

      if (endDate) {
        countQuery += ` AND r.end_datetime <= $${countParamIndex}`;
        countParams.push(endDate);
        countParamIndex++;
      }

      const countResult = await fastify.pg.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].total);

      const reservations = result.rows.map(row => ({
        id: row.id,
        tenantId: row.tenant_id,
        classroomId: row.classroom_id,
        title: row.title,
        description: row.description,
        startDatetime: row.start_datetime,
        endDatetime: row.end_datetime,
        reservedBy: row.reserved_by,
        courseId: row.course_id,
        classId: row.class_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(includeDetails && {
          classroom: row.classroom,
          reservedByUser: row.reserved_by_user,
          course: row.course,
          class: row.class
        })
      }));

      return {
        data: reservations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Erreur lors de la récupération des réservations",
      });
    }
  });

  // POST /api/v1/classroom-reservations - Create reservation
  fastify.post("/", async (request, reply) => {
    const reservationData = request.body as any;

    try {
      // Check for conflicts
      const conflictQuery = `
        SELECT id FROM classroom_reservations 
        WHERE classroom_id = $1 
          AND tenant_id = $2
          AND status != 'cancelled'
          AND tstzrange($3::timestamptz, $4::timestamptz, '[)') && 
              tstzrange(start_datetime, end_datetime, '[)')
      `;

      const conflictResult = await fastify.pg.query(conflictQuery, [
        reservationData.classroomId,
        request.tenantId,
        reservationData.startDatetime,
        reservationData.endDatetime
      ]);

      if (conflictResult.rows.length > 0) {
        return reply.status(409).send({
          error: "Conflict",
          message: "La salle est déjà réservée pour cette période",
        });
      }

      const query = `
        INSERT INTO classroom_reservations (
          tenant_id, classroom_id, title, description, start_datetime, 
          end_datetime, reserved_by, course_id, class_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const values = [
        request.tenantId,
        reservationData.classroomId,
        reservationData.title,
        reservationData.description || null,
        reservationData.startDatetime,
        reservationData.endDatetime,
        request.userId, // From auth middleware
        reservationData.courseId || null,
        reservationData.classId || null,
      ];

      const result = await fastify.pg.query(query, values);
      const row = result.rows[0];

      const reservation = {
        id: row.id,
        tenantId: row.tenant_id,
        classroomId: row.classroom_id,
        title: row.title,
        description: row.description,
        startDatetime: row.start_datetime,
        endDatetime: row.end_datetime,
        reservedBy: row.reserved_by,
        courseId: row.course_id,
        classId: row.class_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      return reply.status(201).send({ data: reservation });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Erreur lors de la création de la réservation",
      });
    }
  });

  // PUT /api/v1/classroom-reservations/:id - Update reservation
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updateData = request.body as any;

    try {
      // Check if reservation exists
      const checkResult = await fastify.pg.query(
        "SELECT id, reserved_by FROM classroom_reservations WHERE id = $1 AND tenant_id = $2",
        [id, request.tenantId]
      );

      if (checkResult.rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Réservation non trouvée",
        });
      }

      // Check if user can modify (owner or admin)
      const reservation = checkResult.rows[0];
      if (reservation.reserved_by !== request.userId && !request.isAdmin) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "Vous n'êtes pas autorisé à modifier cette réservation",
        });
      }

      // Build dynamic update query
      const updateFields = [];
      const values = [];
      let paramIndex = 1;

      Object.entries(updateData).forEach(([key, value]) => {
        if (value !== undefined) {
          const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
          updateFields.push(`${dbField} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      });

      if (updateFields.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Aucune donnée à mettre à jour",
        });
      }

      updateFields.push(`updated_at = NOW()`);
      values.push(id, request.tenantId);

      const query = `
        UPDATE classroom_reservations 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
        RETURNING *
      `;

      const result = await fastify.pg.query(query, values);
      const row = result.rows[0];

      const updatedReservation = {
        id: row.id,
        tenantId: row.tenant_id,
        classroomId: row.classroom_id,
        title: row.title,
        description: row.description,
        startDatetime: row.start_datetime,
        endDatetime: row.end_datetime,
        reservedBy: row.reserved_by,
        courseId: row.course_id,
        classId: row.class_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      return { data: updatedReservation };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Erreur lors de la mise à jour de la réservation",
      });
    }
  });

  // DELETE /api/v1/classroom-reservations/:id - Cancel reservation
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const result = await fastify.pg.query(
        `UPDATE classroom_reservations 
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND reserved_by = $3
         RETURNING id`,
        [id, request.tenantId, request.userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Réservation non trouvée ou non autorisée",
        });
      }

      return reply.status(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Erreur lors de l'annulation de la réservation",
      });
    }
  });
}
