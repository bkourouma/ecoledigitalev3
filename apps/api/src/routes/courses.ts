import { FastifyInstance } from "fastify";
import {
  CourseQuerySchema,
  CreateCourseSchema,
  UpdateCourseSchema,
} from "@ecoledigitale/contracts";

const DEFAULT_COURSE_DELIVERY_MODE = "presential";
const DEFAULT_COURSE_HOURS_TOTAL = 1;
const DEFAULT_COURSE_HOURS_THEORY = 0;
const DEFAULT_COURSE_HOURS_PRACTICAL = 0;

function getEffectiveTenantId(request: any) {
  return request.user?.tenantId || request.tenantId;
}

async function setClientTenantContext(client: any, tenantId: string, tenantSlug?: string) {
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);

  if (tenantSlug) {
    await client.query("SELECT set_config('app.tenant_slug', $1, false)", [tenantSlug]);
  }
}

async function clearClientTenantContext(client: any) {
  try {
    await client.query("RESET app.tenant_id");
  } catch {}

  try {
    await client.query("RESET app.tenant_slug");
  } catch {}
}

function sanitizeCourseCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 20);
}

function mapCourseRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    programmeId: row.programme_id,
    bilanTypeId: row.bilan_type_id,
    name: row.name,
    code: row.code,
    cm: row.cm,
    td: row.td,
    tp: row.tp,
    coef: row.coef,
    vhh: row.vhh,
    description: row.description,
    objectives: row.objectives || [],
    hoursTotal: row.hours_total,
    hoursTheory: row.hours_theory,
    hoursPractical: row.hours_practical,
    deliveryMode: row.delivery_mode,
    prerequisites: row.prerequisites || [],
    evaluationMethods: row.evaluation_methods || [],
    resources: row.resources || {},
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    programme: {
      id: row.p_id,
      name: row.p_name,
      code: row.p_code,
    },
    bilanType: {
      id: row.bt_id,
      name: row.bt_name,
    },
  };
}

export async function coursesRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          programmeId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["draft", "active", "inactive"] },
          deliveryMode: { type: "string", enum: ["presential", "remote", "hybrid", "elearning"] },
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const tenantId = getEffectiveTenantId(request);
      const query = CourseQuerySchema.parse(request.query);
      const offset = (query.page - 1) * query.limit;
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);

        let whereClause = "WHERE c.tenant_id = $1";
        const params: Array<string | number> = [tenantId];
        let paramIndex = 2;

        if (query.programmeId) {
          whereClause += ` AND c.programme_id = $${paramIndex}`;
          params.push(query.programmeId);
          paramIndex++;
        }

        if (query.status) {
          whereClause += ` AND c.status = $${paramIndex}`;
          params.push(query.status);
          paramIndex++;
        }

        if (query.deliveryMode) {
          whereClause += ` AND c.delivery_mode = $${paramIndex}`;
          params.push(query.deliveryMode);
          paramIndex++;
        }

        const countResult = await client.query(
          `
            SELECT COUNT(*)
            FROM courses c
            JOIN programmes p ON c.programme_id = p.id
            JOIN bilan_types bt ON c.bilan_type_id = bt.id
            ${whereClause}
          `,
          params
        );

        const result = await client.query(
          `
            SELECT
              c.id,
              c.tenant_id,
              c.programme_id,
              c.bilan_type_id,
              c.name,
              c.code,
              c.cm,
              c.td,
              c.tp,
              c.coef,
              c.vhh,
              c.description,
              c.objectives,
              c.hours_total,
              c.hours_theory,
              c.hours_practical,
              c.delivery_mode,
              c.prerequisites,
              c.evaluation_methods,
              c.resources,
              c.status,
              c.created_at,
              c.updated_at,
              p.id AS p_id,
              p.name AS p_name,
              p.code AS p_code,
              bt.id AS bt_id,
              bt.name AS bt_name
            FROM courses c
            JOIN programmes p ON c.programme_id = p.id
            JOIN bilan_types bt ON c.bilan_type_id = bt.id
            ${whereClause}
            ORDER BY c.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
          `,
          [...params, query.limit, offset]
        );

        const total = parseInt(countResult.rows[0].count, 10);

        reply.send({
          data: result.rows.map(mapCourseRow),
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        });
      } catch (error) {
        fastify.log.error(`Error fetching courses: ${error}`);
        reply.status(500).send({ error: "Internal Server Error", message: "An error occurred while fetching courses" });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["programmeId", "bilanTypeId", "name"],
        properties: {
          programmeId: { type: "string", format: "uuid" },
          bilanTypeId: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 20 },
          cm: { type: "string", maxLength: 255 },
          td: { type: "string", maxLength: 255 },
          tp: { type: "string", maxLength: 255 },
          coef: { type: "number" },
          vhh: { type: "string", maxLength: 255 },
          description: { type: "string" },
          objectives: { type: "array", items: { type: "string" } },
          hoursTotal: { type: "number", minimum: 1 },
          hoursTheory: { type: "number", minimum: 0 },
          hoursPractical: { type: "number", minimum: 0 },
          deliveryMode: { type: "string", enum: ["presential", "remote", "hybrid", "elearning"] },
          prerequisites: { type: "array", items: { type: "string" } },
          evaluationMethods: { type: "array", items: { type: "string" } },
          resources: { type: "object" },
          status: { type: "string", enum: ["draft", "active", "inactive"] },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const tenantId = getEffectiveTenantId(request);
      const rawBody = request.body as Record<string, unknown>;
      const parsed = CreateCourseSchema.safeParse(rawBody);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join(" · ");
        return reply.status(400).send({ error: "Validation Error", message: msg });
      }
      const parsedCourseData = parsed.data;
      const courseData = {
        ...parsedCourseData,
        programmeId: String(rawBody.programmeId),
        bilanTypeId: String(rawBody.bilanTypeId),
        cm: typeof rawBody.cm === "string" ? rawBody.cm : undefined,
        td: typeof rawBody.td === "string" ? rawBody.td : undefined,
        tp: typeof rawBody.tp === "string" ? rawBody.tp : undefined,
        coef:
          rawBody.coef === undefined || rawBody.coef === null || rawBody.coef === ""
            ? undefined
            : Number.isNaN(Number(rawBody.coef))
              ? undefined
              : Number(rawBody.coef),
        vhh: typeof rawBody.vhh === "string" ? rawBody.vhh : undefined,
      };

      const client = await fastify.pg.connect();
      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        await client.query("BEGIN");

        const programmeResult = await client.query(
          `
            SELECT id FROM programmes
            WHERE id = $1 AND tenant_id = $2
          `,
          [courseData.programmeId, tenantId]
        );

        if (programmeResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Not Found", message: "Programme not found" });
        }

        const bilanTypeResult = await client.query(
          `
            SELECT id FROM bilan_types
            WHERE id = $1 AND tenant_id = $2
          `,
          [courseData.bilanTypeId, tenantId]
        );

        if (bilanTypeResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Not Found", message: "Type de bilan introuvable" });
        }

        const courseCode = courseData.code || sanitizeCourseCode(courseData.name) || "COURSE";
        const existingResult = await client.query(
          `
            SELECT id FROM courses
            WHERE tenant_id = $1 AND programme_id = $2 AND code = $3
          `,
          [tenantId, courseData.programmeId, courseCode]
        );

        if (existingResult.rows.length > 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "Conflict",
            message: "Une matière avec ce code existe déjà pour ce programme.",
          });
        }

        const insertResult = await client.query(
          `
            INSERT INTO courses (
              tenant_id, programme_id, bilan_type_id, name, code, cm, td, tp, coef, vhh, description,
              objectives, hours_total, hours_theory, hours_practical,
              delivery_mode, prerequisites, evaluation_methods, resources, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *
          `,
          [
            tenantId,
            courseData.programmeId,
            courseData.bilanTypeId,
            courseData.name,
            courseCode,
            courseData.cm || null,
            courseData.td || null,
            courseData.tp || null,
            courseData.coef ?? null,
            courseData.vhh || null,
            courseData.description || null,
            courseData.objectives || [],
            courseData.hoursTotal ?? DEFAULT_COURSE_HOURS_TOTAL,
            courseData.hoursTheory ?? DEFAULT_COURSE_HOURS_THEORY,
            courseData.hoursPractical ?? DEFAULT_COURSE_HOURS_PRACTICAL,
            courseData.deliveryMode || DEFAULT_COURSE_DELIVERY_MODE,
            courseData.prerequisites || [],
            courseData.evaluationMethods || [],
            courseData.resources || {},
            courseData.status || "active",
          ]
        );

        const course = insertResult.rows[0];
        const detailsResult = await client.query(
          `
            SELECT
              p.id AS p_id,
              p.name AS p_name,
              p.code AS p_code,
              bt.id AS bt_id,
              bt.name AS bt_name
            FROM programmes p
            JOIN bilan_types bt ON bt.id = $2
            WHERE p.id = $1
          `,
          [course.programme_id, course.bilan_type_id]
        );

        await client.query("COMMIT");
        reply.status(201).send(mapCourseRow({ ...course, ...detailsResult.rows[0] }));
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* pas de transaction active (ex. erreur avant BEGIN) */
        }
        const errMsg = error instanceof Error ? error.message : String(error);
        fastify.log.error(`Error creating course: ${errMsg}`);
        reply.status(500).send({
          error: "Internal Server Error",
          message: errMsg || "An error occurred while creating the course",
        });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

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
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const { id } = request.params as { id: string };
      const tenantId = getEffectiveTenantId(request);
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        const result = await client.query(
          `
            SELECT
              c.*,
              p.id AS p_id,
              p.name AS p_name,
              p.code AS p_code,
              bt.id AS bt_id,
              bt.name AS bt_name
            FROM courses c
            JOIN programmes p ON c.programme_id = p.id
            JOIN bilan_types bt ON c.bilan_type_id = bt.id
            WHERE c.id = $1 AND c.tenant_id = $2
          `,
          [id, tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Course not found" });
        }

        reply.send(mapCourseRow(result.rows[0]));
      } catch (error) {
        fastify.log.error(`Error fetching course: ${error}`);
        reply.status(500).send({ error: "Internal Server Error", message: "An error occurred while fetching the course" });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

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
          programmeId: { type: "string", format: "uuid" },
          bilanTypeId: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 255 },
          code: { type: "string", minLength: 1, maxLength: 20 },
          cm: { type: "string", maxLength: 255 },
          td: { type: "string", maxLength: 255 },
          tp: { type: "string", maxLength: 255 },
          coef: { type: "number" },
          vhh: { type: "string", maxLength: 255 },
          description: { type: "string" },
          objectives: { type: "array", items: { type: "string" } },
          hoursTotal: { type: "number", minimum: 1 },
          hoursTheory: { type: "number", minimum: 0 },
          hoursPractical: { type: "number", minimum: 0 },
          deliveryMode: { type: "string", enum: ["presential", "remote", "hybrid", "elearning"] },
          prerequisites: { type: "array", items: { type: "string" } },
          evaluationMethods: { type: "array", items: { type: "string" } },
          resources: { type: "object" },
          status: { type: "string", enum: ["draft", "active", "inactive"] },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const { id } = request.params as { id: string };
      const tenantId = getEffectiveTenantId(request);
      const rawUpdateBody = request.body as Record<string, unknown>;
      const parsedUpdateData = UpdateCourseSchema.parse(rawUpdateBody);
      const updateData = {
        ...parsedUpdateData,
        programmeId:
          rawUpdateBody.programmeId !== undefined
            ? String(rawUpdateBody.programmeId)
            : parsedUpdateData.programmeId,
        bilanTypeId:
          rawUpdateBody.bilanTypeId !== undefined
            ? String(rawUpdateBody.bilanTypeId)
            : parsedUpdateData.bilanTypeId,
        cm: typeof rawUpdateBody.cm === "string" ? rawUpdateBody.cm : parsedUpdateData.cm,
        td: typeof rawUpdateBody.td === "string" ? rawUpdateBody.td : parsedUpdateData.td,
        tp: typeof rawUpdateBody.tp === "string" ? rawUpdateBody.tp : parsedUpdateData.tp,
        coef:
          rawUpdateBody.coef === undefined || rawUpdateBody.coef === null || rawUpdateBody.coef === ""
            ? parsedUpdateData.coef
            : Number.isNaN(Number(rawUpdateBody.coef))
              ? parsedUpdateData.coef
              : Number(rawUpdateBody.coef),
        vhh: typeof rawUpdateBody.vhh === "string" ? rawUpdateBody.vhh : parsedUpdateData.vhh,
      };

      const client = await fastify.pg.connect();
      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        await client.query("BEGIN");

        const existingResult = await client.query(
          `
            SELECT id, code, programme_id
            FROM courses
            WHERE id = $1 AND tenant_id = $2
          `,
          [id, tenantId]
        );

        if (existingResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Not Found", message: "Course not found" });
        }

        const existingCourse = existingResult.rows[0];

        if (updateData.programmeId) {
          const programmeResult = await client.query(
            `SELECT id FROM programmes WHERE id = $1 AND tenant_id = $2`,
            [updateData.programmeId, tenantId]
          );
          if (programmeResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return reply.status(404).send({ error: "Not Found", message: "Programme not found" });
          }
        }

        if (updateData.bilanTypeId) {
          const bilanTypeResult = await client.query(
            `SELECT id FROM bilan_types WHERE id = $1 AND tenant_id = $2`,
            [updateData.bilanTypeId, tenantId]
          );
          if (bilanTypeResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return reply.status(404).send({ error: "Not Found", message: "Type de bilan introuvable" });
          }
        }

        if (updateData.code) {
          const targetProgrammeId = updateData.programmeId || existingCourse.programme_id;
          const conflictResult = await client.query(
            `
              SELECT id FROM courses
              WHERE tenant_id = $1 AND programme_id = $2 AND code = $3 AND id != $4
            `,
            [tenantId, targetProgrammeId, updateData.code, id]
          );

          if (conflictResult.rows.length > 0) {
            await client.query("ROLLBACK");
            return reply.status(409).send({
              error: "Conflict",
              message: "Une matière avec ce code existe déjà pour ce programme.",
            });
          }
        }

        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        const pushField = (fieldName: string, value: any) => {
          updateFields.push(`${fieldName} = $${paramIndex}`);
          updateValues.push(value);
          paramIndex++;
        };

        if (updateData.programmeId !== undefined) pushField("programme_id", updateData.programmeId);
        if (updateData.bilanTypeId !== undefined) pushField("bilan_type_id", updateData.bilanTypeId);
        if (updateData.name !== undefined) pushField("name", updateData.name);
        if (updateData.code !== undefined) pushField("code", updateData.code);
        if (updateData.cm !== undefined) pushField("cm", updateData.cm);
        if (updateData.td !== undefined) pushField("td", updateData.td);
        if (updateData.tp !== undefined) pushField("tp", updateData.tp);
        if (updateData.coef !== undefined) pushField("coef", updateData.coef);
        if (updateData.vhh !== undefined) pushField("vhh", updateData.vhh);
        if (updateData.description !== undefined) pushField("description", updateData.description);
        if (updateData.objectives !== undefined) pushField("objectives", updateData.objectives);
        if (updateData.hoursTotal !== undefined) pushField("hours_total", updateData.hoursTotal);
        if (updateData.hoursTheory !== undefined) pushField("hours_theory", updateData.hoursTheory);
        if (updateData.hoursPractical !== undefined) pushField("hours_practical", updateData.hoursPractical);
        if (updateData.deliveryMode !== undefined) pushField("delivery_mode", updateData.deliveryMode);
        if (updateData.prerequisites !== undefined) pushField("prerequisites", updateData.prerequisites);
        if (updateData.evaluationMethods !== undefined) pushField("evaluation_methods", updateData.evaluationMethods);
        if (updateData.resources !== undefined) pushField("resources", updateData.resources);
        if (updateData.status !== undefined) pushField("status", updateData.status);

        updateFields.push("updated_at = NOW()");

        if (updateFields.length === 1) {
          await client.query("ROLLBACK");
          return reply.status(400).send({ error: "Bad Request", message: "No fields to update" });
        }

        const updateResult = await client.query(
          `
            UPDATE courses
            SET ${updateFields.join(", ")}
            WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
            RETURNING *
          `,
          [...updateValues, id, tenantId]
        );

        const course = updateResult.rows[0];
        const detailsResult = await client.query(
          `
            SELECT
              p.id AS p_id,
              p.name AS p_name,
              p.code AS p_code,
              bt.id AS bt_id,
              bt.name AS bt_name
            FROM programmes p
            JOIN bilan_types bt ON bt.id = $2
            WHERE p.id = $1
          `,
          [course.programme_id, course.bilan_type_id]
        );

        await client.query("COMMIT");
        reply.send(mapCourseRow({ ...course, ...detailsResult.rows[0] }));
      } catch (error) {
        await client.query("ROLLBACK");
        fastify.log.error(`Error updating course: ${error}`);
        reply.status(500).send({ error: "Internal Server Error", message: "An error occurred while updating the course" });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });

  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(400).send({ error: "Tenant Required", message: "This endpoint requires tenant context" });
      }

      const { id } = request.params as { id: string };
      const tenantId = getEffectiveTenantId(request);
      const client = await fastify.pg.connect();

      try {
        await setClientTenantContext(client, tenantId, request.tenantSlug);
        await client.query("BEGIN");

        const existsResult = await client.query(
          `SELECT id FROM courses WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        if (existsResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Not Found", message: "Course not found" });
        }

        const assignmentsResult = await client.query(
          `SELECT COUNT(*) FROM assignments WHERE course_id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        if (parseInt(assignmentsResult.rows[0].count, 10) > 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Conflict", message: "Cannot delete course with associated assignments" });
        }

        const materialsResult = await client.query(
          `SELECT COUNT(*) FROM course_materials WHERE course_id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        if (parseInt(materialsResult.rows[0].count, 10) > 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Conflict", message: "Cannot delete course with associated materials" });
        }

        const classCoursesResult = await client.query(
          `SELECT COUNT(*) FROM class_courses WHERE course_id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        if (parseInt(classCoursesResult.rows[0].count, 10) > 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Conflict", message: "Cannot delete course that is assigned to classes" });
        }

        await client.query(`DELETE FROM courses WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
        await client.query("COMMIT");
        reply.status(204).send();
      } catch (error) {
        await client.query("ROLLBACK");
        fastify.log.error(`Error deleting course: ${error}`);
        reply.status(500).send({ error: "Internal Server Error", message: "An error occurred while deleting the course" });
      } finally {
        await clearClientTenantContext(client);
        client.release();
      }
    },
  });
}
