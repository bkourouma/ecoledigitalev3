import { FastifyInstance } from "fastify";

export async function dbTestRoutes(fastify: FastifyInstance) {
  // Test database connection endpoint
  fastify.get("/db-test", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
            userCount: { type: "number" },
            connectionString: { type: "string" }
          }
        }
      }
    },
    handler: async (request, reply) => {
      try {
        const client = await fastify.pg.connect();
        
        try {
          const result = await client.query('SELECT COUNT(*) as count FROM users');
          const userCount = parseInt(result.rows[0].count);
          
          // Get connection info (hide password)
          const connString = process.env.DATABASE_URL || 'Not set';
          const safeConnString = connString.replace(/:[^:@]+@/, ':***@');
          
          reply.send({
            success: true,
            message: "Database connection successful",
            userCount: userCount,
            connectionString: safeConnString
          });
        } finally {
          client.release();
        }
      } catch (error) {
        fastify.log.error("Database test error:", error);
        reply.status(500).send({
          success: false,
          message: error instanceof Error ? error.message : "Unknown error",
          userCount: 0,
          connectionString: "Failed to connect"
        });
      }
    }
  });
}


