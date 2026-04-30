import { FastifyInstance, FastifyRequest } from "fastify";
import { ExportService } from "../services/export.service";
import {
  ExportInscriptionsRequestSchema,
  ExportPaiementsRequestSchema,
  ExportPresencesRequestSchema,
  ExportCAFormationRequestSchema,
  ExportPersonnaliseRequestSchema,
  ExportJobResponseSchema,
} from "@ecoledigitale/contracts/src/exports";
import { z } from "zod";
import { getFileStorageService } from "../services/fileStorage";

/**
 * Exports Routes
 * 
 * Admin endpoints for data exports:
 * - POST /api/v1/admin/exports/inscriptions - Export enrollments
 * - POST /api/v1/admin/exports/paiements - Export payments
 * - POST /api/v1/admin/exports/presences - Export attendance
 * - POST /api/v1/admin/exports/ca-formation - Export revenue by training
 * - POST /api/v1/admin/exports/personnalise - Custom export
 * - GET /api/v1/admin/exports/jobs/:id - Get export job status
 * - GET /api/v1/admin/exports/jobs/:id/download - Download export file
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

export async function exportsRoutes(fastify: FastifyInstance) {
  const exportService = new ExportService(fastify.pg as any);
  const fileStorageService = getFileStorageService();

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

  // POST /api/v1/admin/exports/inscriptions
  fastify.post("/inscriptions", {
    schema: {
      tags: ["Admin Exports"],
      summary: "Export enrollments",
      body: {
        type: "object",
        properties: {
          session_id: { type: "string", format: "uuid" },
          formation_id: { type: "string", format: "uuid" },
          date_debut: { type: "string", format: "date" },
          date_fin: { type: "string", format: "date" },
          statut: { type: "string" },
          format: { type: "string", enum: ["csv", "xlsx"], default: "xlsx" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            job_id: { type: "string", format: "uuid" },
            file: { type: "string" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const userId = request.user?.id || "";
      const data = request.body as z.infer<typeof ExportInscriptionsRequestSchema>;

      // For large datasets (>1000), create async job
      // For small datasets, return file directly
      // Note: We'd need to count first, but for simplicity, we'll use async for all
      const jobId = await exportService.createExportJob(tenantId, "inscriptions", data, userId);
      
      // Process job asynchronously
      setImmediate(async () => {
        try {
          await exportService.processExportJob(tenantId, jobId);
        } catch (error) {
          console.error(`Export job ${jobId} failed:`, error);
        }
      });

      return reply.send({ success: true, job_id: jobId });
    },
  });

  // POST /api/v1/admin/exports/paiements
  fastify.post("/paiements", {
    schema: {
      tags: ["Admin Exports"],
      summary: "Export payments",
      body: {
        type: "object",
        properties: {
          session_id: { type: "string", format: "uuid" },
          formation_id: { type: "string", format: "uuid" },
          date_debut: { type: "string", format: "date" },
          date_fin: { type: "string", format: "date" },
          methode_paiement: { type: "string" },
          statut: { type: "string" },
          format: { type: "string", enum: ["csv", "xlsx"], default: "xlsx" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            job_id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const userId = request.user?.id || "";
      const data = request.body as z.infer<typeof ExportPaiementsRequestSchema>;

      const jobId = await exportService.createExportJob(tenantId, "paiements", data, userId);
      
      setImmediate(async () => {
        try {
          await exportService.processExportJob(tenantId, jobId);
        } catch (error) {
          console.error(`Export job ${jobId} failed:`, error);
        }
      });

      return reply.send({ success: true, job_id: jobId });
    },
  });

  // POST /api/v1/admin/exports/presences
  fastify.post("/presences", {
    schema: {
      tags: ["Admin Exports"],
      summary: "Export attendance",
      body: {
        type: "object",
        required: ["session_id"],
        properties: {
          session_id: { type: "string", format: "uuid" },
          format: { type: "string", enum: ["csv", "xlsx"], default: "xlsx" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            job_id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const userId = request.user?.id || "";
      const data = request.body as z.infer<typeof ExportPresencesRequestSchema>;

      const jobId = await exportService.createExportJob(tenantId, "presences", data, userId);
      
      setImmediate(async () => {
        try {
          await exportService.processExportJob(tenantId, jobId);
        } catch (error) {
          console.error(`Export job ${jobId} failed:`, error);
        }
      });

      return reply.send({ success: true, job_id: jobId });
    },
  });

  // POST /api/v1/admin/exports/ca-formation
  fastify.post("/ca-formation", {
    schema: {
      tags: ["Admin Exports"],
      summary: "Export revenue by training",
      body: {
        type: "object",
        properties: {
          date_debut: { type: "string", format: "date" },
          date_fin: { type: "string", format: "date" },
          formation_id: { type: "string", format: "uuid" },
          format: { type: "string", enum: ["csv", "xlsx"], default: "xlsx" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            job_id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const userId = request.user?.id || "";
      const data = request.body as z.infer<typeof ExportCAFormationRequestSchema>;

      const jobId = await exportService.createExportJob(tenantId, "ca_formation", data, userId);
      
      setImmediate(async () => {
        try {
          await exportService.processExportJob(tenantId, jobId);
        } catch (error) {
          console.error(`Export job ${jobId} failed:`, error);
        }
      });

      return reply.send({ success: true, job_id: jobId });
    },
  });

  // POST /api/v1/admin/exports/personnalise
  fastify.post("/personnalise", {
    schema: {
      tags: ["Admin Exports"],
      summary: "Custom export",
      body: {
        type: "object",
        required: ["type", "colonnes"],
        properties: {
          type: { type: "string" },
          colonnes: {
            type: "array",
            items: { type: "string" },
          },
          filtres: { type: "object" },
          format: { type: "string", enum: ["csv", "xlsx"], default: "xlsx" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            job_id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const userId = request.user?.id || "";
      const data = request.body as z.infer<typeof ExportPersonnaliseRequestSchema>;

      const jobId = await exportService.createExportJob(tenantId, "personnalise", data, userId);
      
      setImmediate(async () => {
        try {
          await exportService.processExportJob(tenantId, jobId);
        } catch (error) {
          console.error(`Export job ${jobId} failed:`, error);
        }
      });

      return reply.send({ success: true, job_id: jobId });
    },
  });

  // GET /api/v1/admin/exports/jobs/:id
  fastify.get("/jobs/:id", {
    schema: {
      tags: ["Admin Exports"],
      summary: "Get export job status",
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

      const result = await exportService.getExportJobStatus(tenantId, id);
      return reply.send({ success: true, data: result });
    },
  });

  // GET /api/v1/admin/exports/jobs/:id/download
  fastify.get("/jobs/:id/download", {
    schema: {
      tags: ["Admin Exports"],
      summary: "Download export file",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      requireAdmin(request);
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };

      const job = await exportService.getExportJobStatus(tenantId, id);
      if (job.status !== "completed" || !job.fichier_url) {
        return reply.status(404).send({ success: false, message: "Export not ready" });
      }

      // Extract file key from URL (format: /api/v1/admin/exports/jobs/{id}/download)
      // The actual file key is stored in the database
      const client = await (fastify.pg as any).connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const fileQuery = `SELECT fichier_url FROM export_jobs WHERE id = $1 AND tenant_id = $2`;
        const fileResult = await client.query(fileQuery, [id, tenantId]);
        if (fileResult.rows.length === 0) {
          return reply.status(404).send({ success: false, message: "File not found" });
        }

        const fileKey = fileResult.rows[0].fichier_url;
        if (!fileStorageService.validateTenantAccess(fileKey, tenantId)) {
          return reply.status(403).send({ success: false, message: "Access denied" });
        }

        const fileBuffer = await fileStorageService.getFileBuffer(fileKey);
        const extension = fileKey.endsWith(".csv") ? "csv" : "xlsx";
        const contentType = extension === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        
        reply.header("Content-Disposition", `attachment; filename="export-${id}.${extension}"`);
        reply.header("Content-Type", contentType);
        return reply.send(fileBuffer);
      } finally {
        client.release();
      }
    },
  });
}

