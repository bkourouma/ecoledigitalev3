import { FastifyInstance, FastifyRequest } from "fastify";
import { DocumentGenerationService } from "../services/document-generation.service";
import { getFileStorageService } from "../services/fileStorage";
import {
  GenerateConventionRequestSchema,
  GenerateAttestationPresenceRequestSchema,
  GenerateAttestationReussiteRequestSchema,
  GenerateDevisRequestSchema,
  BatchGenerateRequestSchema,
  DocumentListQuerySchema,
  ResendDocumentRequestSchema,
} from "@ecoledigitale/contracts/src/documents";

/**
 * Documents Routes
 * 
 * Admin endpoints for document generation and management:
 * - POST /api/v1/admin/documents/convention/generer - Generate convention
 * - POST /api/v1/admin/documents/attestation-presence/generer - Generate attendance certificate
 * - POST /api/v1/admin/documents/attestation-reussite/generer - Generate success certificate
 * - POST /api/v1/admin/documents/devis/generer - Generate quote
 * - POST /api/v1/admin/documents/batch-generate - Batch generate documents
 * - GET /api/v1/admin/documents - List documents with filters
 * - GET /api/v1/admin/documents/:id - Download document
 * - POST /api/v1/admin/documents/:id/resend - Resend document by email
 * - DELETE /api/v1/admin/documents/:id - Delete document
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

export async function documentsRoutes(fastify: FastifyInstance) {
  const documentService = new DocumentGenerationService(fastify.pg as any);

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

  // Error handling wrapper
  const handleRoute = (
    handler: (request: AuthenticatedRequest, reply: any) => Promise<any>
  ) => {
    return async (request: AuthenticatedRequest, reply: any) => {
      try {
        requireAdmin(request);
        return await handler(request, reply);
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: "Access denied. Admin role required.",
          });
        }
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: error.message,
            message: "Tenant context is required.",
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred",
        });
      }
    };
  };

  // T035: POST /api/v1/admin/documents/convention/generer
  fastify.post(
    "/convention/generer",
    {
      schema: {
        tags: ["Documents"],
        summary: "Generate convention document",
        body: {
          type: "object",
          required: ["inscription_id"],
          properties: {
            inscription_id: { type: "string", format: "uuid" },
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
                  document_url: { type: "string" },
                  document_id: { type: "string" },
                  numero: { type: "string" },
                  deja_genere: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const body = GenerateConventionRequestSchema.parse(request.body);
      const userId = request.user?.id;

      const result = await documentService.genererConvention(
        tenantId,
        body.inscription_id,
        userId
      );

      return reply.status(200).send({
        success: true,
        data: result,
      });
    })
  );

  // T036: POST /api/v1/admin/documents/attestation-presence/generer
  fastify.post(
    "/attestation-presence/generer",
    {
      schema: {
        tags: ["Documents"],
        summary: "Generate attendance certificate",
        body: {
          type: "object",
          required: ["inscription_id"],
          properties: {
            inscription_id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const body = GenerateAttestationPresenceRequestSchema.parse(request.body);
      const userId = request.user?.id;

      const result = await documentService.genererAttestationPresence(
        tenantId,
        body.inscription_id,
        userId
      );

      return reply.status(200).send({
        success: true,
        data: result,
      });
    })
  );

  // T037: POST /api/v1/admin/documents/attestation-reussite/generer
  fastify.post(
    "/attestation-reussite/generer",
    {
      schema: {
        tags: ["Documents"],
        summary: "Generate success certificate",
        body: {
          type: "object",
          required: ["inscription_id", "note"],
          properties: {
            inscription_id: { type: "string", format: "uuid" },
            note: { type: "number", minimum: 0, maximum: 20 },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const body = GenerateAttestationReussiteRequestSchema.parse(request.body);
      const userId = request.user?.id;

      const result = await documentService.genererAttestationReussite(
        tenantId,
        body.inscription_id,
        body.note,
        userId
      );

      return reply.status(200).send({
        success: true,
        data: result,
      });
    })
  );

  // T038: POST /api/v1/admin/documents/devis/generer
  fastify.post(
    "/devis/generer",
    {
      schema: {
        tags: ["Documents"],
        summary: "Generate quote",
        body: {
          type: "object",
          required: ["session_id", "client"],
          properties: {
            session_id: { type: "string", format: "uuid" },
            client: {
              type: "object",
              required: ["nom", "email"],
              properties: {
                nom: { type: "string" },
                email: { type: "string", format: "email" },
                telephone: { type: "string" },
                entreprise: { type: "string" },
              },
            },
            validite_jours: { type: "number", minimum: 1, default: 30 },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const body = GenerateDevisRequestSchema.parse(request.body);
      const userId = request.user?.id;

      const result = await documentService.genererDevis(
        tenantId,
        body.session_id,
        body.client,
        body.validite_jours,
        userId
      );

      return reply.status(200).send({
        success: true,
        data: result,
      });
    })
  );

  // T039: POST /api/v1/admin/documents/batch-generate
  fastify.post(
    "/batch-generate",
    {
      schema: {
        tags: ["Documents"],
        summary: "Batch generate documents",
        body: {
          type: "object",
          required: ["session_id", "type"],
          properties: {
            session_id: { type: "string", format: "uuid" },
            type: { type: "string", enum: ["attestation_presence", "attestation_reussite"] },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const body = BatchGenerateRequestSchema.parse(request.body);
      const userId = request.user?.id;

      // For now, synchronous batch generation
      // TODO: Implement async job queue for large batches
      const result = await documentService.generateBatchAttestations(
        tenantId,
        body.session_id,
        body.type,
        undefined, // notes map - can be extended later
        userId
      );

      return reply.status(200).send({
        success: true,
        data: result,
      });
    })
  );

  // T040: GET /api/v1/admin/documents
  fastify.get(
    "/",
    {
      schema: {
        tags: ["Documents"],
        summary: "List documents with filters",
        querystring: {
          type: "object",
          properties: {
            type: { type: "string" },
            session_id: { type: "string", format: "uuid" },
            inscription_id: { type: "string", format: "uuid" },
            date_debut: { type: "string" },
            date_fin: { type: "string" },
            search: { type: "string" },
            page: { type: "number", minimum: 1, default: 1 },
            limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const query = DocumentListQuerySchema.parse(request.query);

      const result = await documentService.getDocumentsList(tenantId, query);

      return reply.status(200).send({
        success: true,
        data: result,
      });
    })
  );

  // T041: GET /api/v1/admin/documents/:id
  fastify.get(
    "/:id",
    {
      schema: {
        tags: ["Documents"],
        summary: "Download document PDF",
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const documentId = (request.params as any).id;

      // Get document from database
      const client = await (fastify.pg as any).connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const docQuery = `
          SELECT fichier_url
          FROM documents
          WHERE id = $1 AND tenant_id = $2
        `;
        const docResult = await client.query(docQuery, [documentId, tenantId]);
        if (docResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: "DOCUMENT_NOT_FOUND",
            message: "Document not found",
          });
        }

        const fichierUrl = docResult.rows[0].fichier_url;

        // Get file from FileStorageService
        const fileStorageService = getFileStorageService();
        const fileBuffer = await fileStorageService.getFileBuffer(fichierUrl);

        // Return file
        return reply
          .type("application/pdf")
          .header("Content-Disposition", `attachment; filename="document-${documentId}.pdf"`)
          .send(fileBuffer);
      } finally {
        client.release();
      }
    })
  );

  // T042: POST /api/v1/admin/documents/:id/resend
  fastify.post(
    "/:id/resend",
    {
      schema: {
        tags: ["Documents"],
        summary: "Resend document by email",
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const documentId = (request.params as any).id;
      const body = ResendDocumentRequestSchema.parse(request.body);

      await documentService.resendDocument(tenantId, documentId, body.email);

      return reply.status(200).send({
        success: true,
        message: "Document sent successfully",
      });
    })
  );

  // T043: DELETE /api/v1/admin/documents/:id
  fastify.delete(
    "/:id",
    {
      schema: {
        tags: ["Documents"],
        summary: "Delete document",
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const documentId = (request.params as any).id;

      await documentService.deleteDocument(tenantId, documentId);

      return reply.status(200).send({
        success: true,
        message: "Document deleted successfully",
      });
    })
  );
}

