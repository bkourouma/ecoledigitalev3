import { FastifyInstance } from "fastify";
import { z } from "zod";

const healthResponseSchema = z.object({
  ok: z.boolean(),
  timestamp: z.string(),
  uptime: z.number(),
  environment: z.string(),
  version: z.string(),
});

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            timestamp: { type: "string" },
            uptime: { type: "number" },
            environment: { type: "string" },
            version: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const health = {
        ok: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        version: process.env.npm_package_version || "0.1.0",
      };

      const validatedHealth = healthResponseSchema.parse(health);
      
      reply.send(validatedHealth);
    },
  });

  // Database health check
  fastify.get("/health/db", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            database: { type: "string" },
            timestamp: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const client = await fastify.pg.connect();
        const result = await client.query("SELECT NOW() as timestamp");
        client.release();

        reply.send({
          ok: true,
          database: "connected",
          timestamp: result.rows[0].timestamp,
        });
      } catch (error) {
        fastify.log.error(`Database health check failed: ${error}`);
        reply.status(503).send({
          ok: false,
          database: "disconnected",
          timestamp: new Date().toISOString(),
        });
      }
    },
  });
}






