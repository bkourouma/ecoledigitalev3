import { FastifyInstance } from "fastify";
import {
  ClassroomSchema,
  CreateClassroomSchema,
  UpdateClassroomSchema,
  ClassroomReservationSchema,
  CreateReservationSchema,
  UpdateReservationSchema,
  ClassroomWithReservationsSchema,
  ReservationWithDetailsSchema
} from "@ecoledigitale/contracts/src/classrooms";

export async function classroomsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/classrooms - List classrooms
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          type: { type: "string" },
          status: { type: "string" },
          building: { type: "string" },
          isActive: { type: "boolean" },
          includeReservations: { type: "boolean", default: false },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { 
      type, 
      status, 
      building, 
      isActive, 
      includeReservations,
      page = 1, 
      limit = 20 
    } = request.query as any;

    try {
      let query = `
        SELECT c.*
        ${includeReservations ? `, 
          COALESCE(
            json_agg(
              json_build_object(
                'id', r.id,
                'title', r.title,
                'description', r.description,
                'startDatetime', r.start_datetime,
                'endDatetime', r.end_datetime,
                'status', r.status
              ) ORDER BY r.start_datetime
            ) FILTER (WHERE r.id IS NOT NULL), 
            '[]'::json
          ) as reservations` : ''}
        FROM classrooms c
        ${includeReservations ? `
          LEFT JOIN classroom_reservations r ON c.id = r.classroom_id 
            AND r.status != 'cancelled'
            AND r.end_datetime >= NOW()
        ` : ''}
        WHERE c.tenant_id = $1
      `;

      const params: any[] = [request.tenantId];
      let paramIndex = 2;

      if (type) {
        query += ` AND c.type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }

      if (status) {
        query += ` AND c.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (building) {
        query += ` AND c.building ILIKE $${paramIndex}`;
        params.push(`%${building}%`);
        paramIndex++;
      }

      if (isActive !== undefined) {
        query += ` AND c.is_active = $${paramIndex}`;
        params.push(isActive);
        paramIndex++;
      }

      if (includeReservations) {
        query += ` GROUP BY c.id`;
      }

      query += ` ORDER BY c.building, c.name`;
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, (page - 1) * limit);

      const result = await fastify.pg.query(query, params);

      // Count total for pagination
      let countQuery = `
        SELECT COUNT(*) as total
        FROM classrooms c
        WHERE c.tenant_id = $1
      `;
      const countParams = [request.tenantId];
      let countParamIndex = 2;

      if (type) {
        countQuery += ` AND c.type = $${countParamIndex}`;
        countParams.push(type);
        countParamIndex++;
      }

      if (status) {
        countQuery += ` AND c.status = $${countParamIndex}`;
        countParams.push(status);
        countParamIndex++;
      }

      if (building) {
        countQuery += ` AND c.building ILIKE $${countParamIndex}`;
        countParams.push(`%${building}%`);
        countParamIndex++;
      }

      if (isActive !== undefined) {
        countQuery += ` AND c.is_active = $${countParamIndex}`;
        countParams.push(isActive);
        countParamIndex++;
      }

      const countResult = await fastify.pg.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].total);

      const classrooms = result.rows.map(row => ({
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        code: row.code,
        type: row.type,
        capacity: row.capacity,
        floor: row.floor,
        building: row.building,
        description: row.description,
        equipment: row.equipment || [],
        status: row.status,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(includeReservations && { reservations: row.reservations || [] })
      }));

      return {
        data: classrooms,
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
        message: "Erreur lors de la récupération des salles de classe",
      });
    }
  });

  // GET /api/v1/classrooms/:id - Get classroom by ID
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      querystring: {
        type: "object",
        properties: {
          includeReservations: { type: "boolean", default: false },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { includeReservations } = request.query as any;

    try {
      let query = `
        SELECT c.*
        ${includeReservations ? `, 
          COALESCE(
            json_agg(
              json_build_object(
                'id', r.id,
                'title', r.title,
                'description', r.description,
                'startDatetime', r.start_datetime,
                'endDatetime', r.end_datetime,
                'status', r.status,
                'reservedBy', r.reserved_by
              ) ORDER BY r.start_datetime
            ) FILTER (WHERE r.id IS NOT NULL), 
            '[]'::json
          ) as reservations` : ''}
        FROM classrooms c
        ${includeReservations ? `
          LEFT JOIN classroom_reservations r ON c.id = r.classroom_id 
            AND r.status != 'cancelled'
        ` : ''}
        WHERE c.id = $1 AND c.tenant_id = $2
        ${includeReservations ? 'GROUP BY c.id' : ''}
      `;

      const result = await fastify.pg.query(query, [id, request.tenantId]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Salle de classe non trouvée",
        });
      }

      const row = result.rows[0];
      const classroom = {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        code: row.code,
        type: row.type,
        capacity: row.capacity,
        floor: row.floor,
        building: row.building,
        description: row.description,
        equipment: row.equipment || [],
        status: row.status,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(includeReservations && { reservations: row.reservations || [] })
      };

      return { data: classroom };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Erreur lors de la récupération de la salle de classe",
      });
    }
  });

  // POST /api/v1/classrooms - Create classroom
  fastify.post("/", async (request, reply) => {
    const classroomData = request.body as any;

    try {
      const query = `
        INSERT INTO classrooms (
          tenant_id, name, code, type, capacity, floor, building, 
          description, equipment, status, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      const values = [
        request.tenantId,
        classroomData.name,
        classroomData.code,
        classroomData.type,
        classroomData.capacity,
        classroomData.floor || null,
        classroomData.building || null,
        classroomData.description || null,
        classroomData.equipment || [],
        classroomData.status || 'disponible',
        classroomData.isActive !== undefined ? classroomData.isActive : true,
      ];

      const result = await fastify.pg.query(query, values);
      const row = result.rows[0];

      const classroom = {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        code: row.code,
        type: row.type,
        capacity: row.capacity,
        floor: row.floor,
        building: row.building,
        description: row.description,
        equipment: row.equipment || [],
        status: row.status,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      return reply.status(201).send({ data: classroom });
    } catch (error: any) {
      fastify.log.error(error);
      
      if (error.code === "23505") {
        return reply.status(409).send({
          error: "Conflict",
          message: "Une salle avec ce code existe déjà",
        });
      }

      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Erreur lors de la création de la salle de classe",
      });
    }
  });

  // PUT /api/v1/classrooms/:id - Update classroom
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 20 },
          capacity: { type: "number", minimum: 1 },
          location: { type: "string", maxLength: 255 },
          description: { type: "string" },
          equipment: { type: "array", items: { type: "string" } },
          isActive: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updateData = request.body as any;

    try {
      // Check if classroom exists
      const checkResult = await fastify.pg.query(
        "SELECT id FROM classrooms WHERE id = $1 AND tenant_id = $2",
        [id, request.tenantId]
      );

      if (checkResult.rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Salle de classe non trouvée",
        });
      }

      // Build dynamic update query
      const updateFields = [];
      const values = [];
      let paramIndex = 1;

      Object.entries(updateData).forEach(([key, value]) => {
        if (value !== undefined) {
          const dbField = key === 'isActive' ? 'is_active' :
                         key.replace(/([A-Z])/g, '_$1').toLowerCase();
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
        UPDATE classrooms
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
        RETURNING *
      `;

      const result = await fastify.pg.query(query, values);
      const row = result.rows[0];

      const classroom = {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        code: row.code,
        type: row.type,
        capacity: row.capacity,
        floor: row.floor,
        building: row.building,
        description: row.description,
        equipment: row.equipment || [],
        status: row.status,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      return { data: classroom };
    } catch (error: any) {
      fastify.log.error(error);

      if (error.code === "23505") {
        return reply.status(409).send({
          error: "Conflict",
          message: "Une salle avec ce code existe déjà",
        });
      }

      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Erreur lors de la mise à jour de la salle de classe",
      });
    }
  });

  // DELETE /api/v1/classrooms/:id - Delete classroom
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
      // Check for existing reservations
      const reservationCheck = await fastify.pg.query(
        "SELECT COUNT(*) as count FROM classroom_reservations WHERE classroom_id = $1 AND status != 'cancelled'",
        [id]
      );

      if (parseInt(reservationCheck.rows[0].count) > 0) {
        return reply.status(409).send({
          error: "Conflict",
          message: "Impossible de supprimer une salle avec des réservations actives",
        });
      }

      const result = await fastify.pg.query(
        "DELETE FROM classrooms WHERE id = $1 AND tenant_id = $2 RETURNING id",
        [id, request.tenantId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Salle de classe non trouvée",
        });
      }

      return reply.status(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Erreur lors de la suppression de la salle de classe",
      });
    }
  });
}
