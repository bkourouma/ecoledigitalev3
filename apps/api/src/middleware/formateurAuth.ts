/**
 * Formateur Authentication Middleware
 * 
 * Verifies that the authenticated user is a trainer (formateur) and is active.
 * Attaches formateur information to the request.
 * 
 * This middleware must be used AFTER the main authMiddleware which validates JWT.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyPlugin from "fastify-plugin";

interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
  tenantId?: string;
  formateur?: {
    id: string;
    user_id: string;
    nom: string;
    prenom: string;
    email: string;
    actif: boolean;
  };
  formateurId?: string;
}

async function formateurAuthMiddleware(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (request: AuthenticatedRequest, reply: FastifyReply) => {
    // Skip if user is not authenticated (will be caught by main auth middleware)
    if (!request.user) {
      return reply.status(401).send({
        error: "Authentication Required",
        message: "User must be authenticated",
        code: "AUTHENTICATION_REQUIRED"
      });
    }

    const userId = request.user.id;
    const tenantId = request.tenantId || request.user.tenantId;

    if (!tenantId) {
      return reply.status(400).send({
        error: "Tenant Required",
        message: "Tenant context is required",
        code: "TENANT_REQUIRED"
      });
    }

    try {
      // Set tenant context for RLS
      await fastify.pg.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Query formateur record linked to user
      const formateurQuery = `
        SELECT 
          id,
          user_id,
          nom,
          prenom,
          email,
          actif
        FROM formateurs
        WHERE user_id = $1
          AND tenant_id = $2
      `;

      const result = await fastify.pg.query(formateurQuery, [userId, tenantId]);

      if (result.rows.length === 0) {
        return reply.status(403).send({
          error: "Trainer Access Required",
          message: "User is not registered as a trainer",
          code: "FORMATEUR_NOT_FOUND"
        });
      }

      const formateur = result.rows[0];

      // Verify formateur is active
      if (!formateur.actif) {
        return reply.status(403).send({
          error: "Trainer Account Inactive",
          message: "Trainer account is not active",
          code: "FORMATEUR_INACTIVE"
        });
      }

      // Attach formateur to request
      request.formateur = {
        id: formateur.id,
        user_id: formateur.user_id,
        nom: formateur.nom,
        prenom: formateur.prenom,
        email: formateur.email,
        actif: formateur.actif,
      };
      request.formateurId = formateur.id;

      fastify.log.debug(`✅ Trainer authenticated: ${formateur.nom} ${formateur.prenom} (${formateur.id.substring(0, 8)}...)`);

    } catch (error) {
      fastify.log.error("❌ Error verifying trainer:", error);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Failed to verify trainer status",
        code: "VERIFICATION_ERROR"
      });
    }
  });
}

export default fastifyPlugin(formateurAuthMiddleware, {
  name: "formateur-auth-middleware"
});

