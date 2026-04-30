import { FastifyInstance, FastifyRequest } from "fastify";
import { EntrepriseClienteService } from "../services/entreprise-cliente.service";
import {
  CreateEntrepriseRequestSchema,
  UpdateEntrepriseRequestSchema,
  EntrepriseListQuerySchema,
  EntrepriseListResponseSchema,
  EntrepriseDetailResponseSchema,
  GenerateFacturationGroupeeRequestSchema,
  GenerateFacturationGroupeeResponseSchema,
} from "@ecoledigitale/contracts/src/entreprises";
import { z } from "zod";

/**
 * Entreprises Routes
 * 
 * Admin endpoints for enterprise client management:
 * - GET /api/v1/admin/entreprises - List enterprises with filters and sorting
 * - GET /api/v1/admin/entreprises/:id - Get enterprise details with statistics
 * - POST /api/v1/admin/entreprises - Create enterprise
 * - PUT /api/v1/admin/entreprises/:id - Update enterprise
 * - DELETE /api/v1/admin/entreprises/:id - Delete enterprise (soft delete)
 * - POST /api/v1/admin/entreprises/:id/facturation-groupee - Generate grouped invoice
 * - GET /api/v1/admin/entreprises/export - Export enterprises to Excel
 */

interface AuthenticatedRequest extends FastifyRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
}

export async function entreprisesRoutes(fastify: FastifyInstance) {
  const entrepriseService = new EntrepriseClienteService(fastify.pg as any);

  // Helper to extract tenant context
  const getTenantId = (request: AuthenticatedRequest): string => {
    if (!request.tenantId) {
      throw new Error("TENANT_REQUIRED");
    }
    return request.tenantId;
  };

  // Helper to check admin role
  const requireAdmin = (request: AuthenticatedRequest): void => {
    if (!request.user) {
      throw new Error("AUTHENTICATION_REQUIRED");
    }
    if (!request.user.roles.includes("admin")) {
      throw new Error("ADMIN_REQUIRED");
    }
  };

  // GET /api/v1/admin/entreprises
  fastify.get("/", {
    schema: {
      tags: ["Admin Entreprises"],
      summary: "List enterprises with filters and sorting",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          search: { type: "string" },
          sort_by: { type: "string" },
          sort_order: { type: "string", enum: ["asc", "desc"] },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: { type: "object" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const query = request.query as z.infer<typeof EntrepriseListQuerySchema>;

      const result = await entrepriseService.getEntreprises(tenantId, query);
      return reply.send({ success: true, data: result });
    },
  });

  // GET /api/v1/admin/entreprises/:id
  fastify.get("/:id", {
    schema: {
      tags: ["Admin Entreprises"],
      summary: "Get enterprise details with statistics",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: { type: "object" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };

      const result = await entrepriseService.getEntrepriseDetails(tenantId, id);
      return reply.send({ success: true, data: result });
    },
  });

  // POST /api/v1/admin/entreprises
  fastify.post("/", {
    schema: {
      tags: ["Admin Entreprises"],
      summary: "Create enterprise",
      body: {
        type: "object",
        required: ["nom", "email"],
        properties: {
          nom: { type: "string" },
          email: { type: "string", format: "email" },
          telephone: { type: "string" },
          adresse: { type: "string" },
          ville: { type: "string" },
          code_postal: { type: "string" },
          pays: { type: "string" },
          siret: { type: "string" },
          tva: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
              },
            },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const data = request.body as z.infer<typeof CreateEntrepriseRequestSchema>;

      const result = await entrepriseService.createEntreprise(tenantId, data);
      return reply.send({ success: true, data: result });
    },
  });

  // PUT /api/v1/admin/entreprises/:id
  fastify.put("/:id", {
    schema: {
      tags: ["Admin Entreprises"],
      summary: "Update enterprise",
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
          nom: { type: "string" },
          email: { type: "string", format: "email" },
          telephone: { type: "string" },
          adresse: { type: "string" },
          ville: { type: "string" },
          code_postal: { type: "string" },
          pays: { type: "string" },
          siret: { type: "string" },
          tva: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const data = request.body as z.infer<typeof UpdateEntrepriseRequestSchema>;

      await entrepriseService.updateEntreprise(tenantId, id, data);
      return reply.send({ success: true, message: "Enterprise updated successfully" });
    },
  });

  // DELETE /api/v1/admin/entreprises/:id
  fastify.delete("/:id", {
    schema: {
      tags: ["Admin Entreprises"],
      summary: "Delete enterprise (soft delete)",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };

      await entrepriseService.deleteEntreprise(tenantId, id);
      return reply.send({ success: true, message: "Enterprise deleted successfully" });
    },
  });

  // POST /api/v1/admin/entreprises/:id/facturation-groupee
  fastify.post("/:id/facturation-groupee", {
    schema: {
      tags: ["Admin Entreprises"],
      summary: "Generate grouped invoice for enterprise",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        required: ["session_ids", "date_debut", "date_fin"],
        properties: {
          session_ids: {
            type: "array",
            items: { type: "string", format: "uuid" },
          },
          date_debut: { type: "string", format: "date" },
          date_fin: { type: "string", format: "date" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: { type: "object" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const data = request.body as z.infer<typeof GenerateFacturationGroupeeRequestSchema>;
      const userId = request.user?.id;

      const result = await entrepriseService.generateFacturationGroupee(tenantId, id, data, userId);
      return reply.send({ success: true, data: result });
    },
  });

  // GET /api/v1/admin/entreprises/export
  fastify.get("/export", {
    schema: {
      tags: ["Admin Entreprises"],
      summary: "Export enterprises to Excel",
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);

      const excelBuffer = await entrepriseService.exportEntreprisesToExcel(tenantId);
      reply.header("Content-Disposition", 'attachment; filename="entreprises.xlsx"');
      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return reply.send(excelBuffer);
    },
  });
}

