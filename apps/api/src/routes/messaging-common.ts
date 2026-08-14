/**
 * Routes de messagerie communes aux quatre profils.
 *
 * Les écrans d'envoi (administration, enseignant, parent, étudiant) ont besoin
 * de savoir si le canal email est utilisable et quel modèle sera appliqué à
 * leur envoi. Ces informations ne sont pas sensibles — libellés et état de la
 * configuration SMTP, jamais le contenu des modèles, qui reste réservé à
 * l'administration via `/api/v1/admin/messages/email-templates`.
 */

import { FastifyInstance } from "fastify";
import { emailService } from "../services/email.service";
import {
  MESSAGE_TEMPLATE_DEFINITIONS,
  MESSAGE_TEMPLATE_KINDS,
  MESSAGE_TEMPLATE_PROFILE_LABELS,
} from "../services/message-email-templates";

interface AuthenticatedRequest {
  tenantId?: string;
  user?: { id: string; email: string; roles?: string[] };
  headers?: any;
  query?: any;
}

export async function messagingCommonRoutes(fastify: FastifyInstance) {
  // GET /api/v1/messaging/email-config
  fastify.get("/email-config", {
    schema: {
      tags: ["Messaging"],
      summary: "État du canal email et libellés des modèles",
      querystring: { type: "object", properties: {} },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const userId = (request.user?.id || (request.headers as any)?.["x-user-id"]) as string;
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: "Authentication Required",
          message: "User ID is required",
        });
      }

      // Seule l'administration peut modifier les modèles : l'information sert
      // à afficher ou non le lien « Personnaliser » dans le sélecteur de canaux.
      const roles = request.user?.roles || [];
      const canManageTemplates = roles.some((role: string) =>
        ["admin", "super_admin", "Administrateur"].includes(role)
      );

      return reply.send({
        success: true,
        data: {
          emailConfigured: emailService.isConfigured(),
          canManageTemplates,
          templates: MESSAGE_TEMPLATE_KINDS.map((kind) => {
            const definition = MESSAGE_TEMPLATE_DEFINITIONS[kind];
            return {
              kind,
              label: definition.label,
              profile: definition.profile,
              profileLabel: MESSAGE_TEMPLATE_PROFILE_LABELS[definition.profile],
            };
          }),
        },
      });
    },
  });
}
