import { FastifyInstance, FastifyRequest } from "fastify";
import { ReportingService } from "../services/reporting.service";
import {
  DashboardMetricsQuerySchema,
  DashboardMetricsResponseSchema,
  CAPrevisionnelQuerySchema,
  CAPrevisionnelResponseSchema,
  TauxConversionResponseSchema,
  StatisticsQuerySchema,
  StatisticsResponseSchema,
} from "@ecoledigitale/contracts/src/reporting";
import { z } from "zod";

/**
 * Reporting Routes
 * 
 * Admin endpoints for reporting and metrics:
 * - GET /api/v1/admin/reporting/dashboard - Get dashboard metrics
 * - GET /api/v1/admin/reporting/ca-previsionnel - Get revenue forecast
 * - GET /api/v1/admin/reporting/taux-conversion - Get conversion rates
 * - GET /api/v1/admin/reporting/statistiques - Get detailed statistics
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

export async function reportingRoutes(fastify: FastifyInstance) {
  const reportingService = new ReportingService(fastify.pg as any);

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

  // GET /api/v1/admin/reporting/dashboard
  fastify.get("/dashboard", {
    schema: {
      tags: ["Admin Reporting"],
      summary: "Get dashboard metrics",
      querystring: {
        type: "object",
        properties: {
          date_debut: { type: "string", format: "date" },
          date_fin: { type: "string", format: "date" },
          formation_id: { type: "string", format: "uuid" },
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
      const query = request.query as z.infer<typeof DashboardMetricsQuerySchema>;

      const result = await reportingService.getDashboardMetrics(tenantId, query);
      return reply.send({ success: true, data: result });
    },
  });

  // GET /api/v1/admin/reporting/ca-previsionnel
  fastify.get("/ca-previsionnel", {
    schema: {
      tags: ["Admin Reporting"],
      summary: "Get revenue forecast",
      querystring: {
        type: "object",
        properties: {
          annee: { type: "number", minimum: 2000, maximum: 2100 },
          mois: { type: "number", minimum: 1, maximum: 12 },
          formation_id: { type: "string", format: "uuid" },
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
      const query = request.query as z.infer<typeof CAPrevisionnelQuerySchema>;

      const result = await reportingService.getCAPrevisionnel(tenantId, query);
      return reply.send({ success: true, data: result });
    },
  });

  // GET /api/v1/admin/reporting/taux-conversion
  fastify.get("/taux-conversion", {
    schema: {
      tags: ["Admin Reporting"],
      summary: "Get conversion rates",
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

      const result = await reportingService.getTauxConversion(tenantId);
      return reply.send({ success: true, data: result });
    },
  });

  // GET /api/v1/admin/reporting/statistiques
  fastify.get("/statistiques", {
    schema: {
      tags: ["Admin Reporting"],
      summary: "Get detailed statistics",
      querystring: {
        type: "object",
        properties: {
          type: { type: "string" },
          date_debut: { type: "string", format: "date" },
          date_fin: { type: "string", format: "date" },
          formation_id: { type: "string", format: "uuid" },
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
      const query = request.query as z.infer<typeof StatisticsQuerySchema>;

      const result = await reportingService.getStatistics(tenantId, query);
      return reply.send({ success: true, data: result });
    },
  });
}

