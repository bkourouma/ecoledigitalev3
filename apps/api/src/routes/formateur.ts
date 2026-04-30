/**
 * Formateur Routes
 * 
 * API endpoints for trainer space (Espace Formateurs)
 * All endpoints require trainer authentication via formateurAuthMiddleware
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import formateurAuthMiddleware from "../middleware/formateurAuth";
import { FormateurService } from "../services/formateur.service";
import { 
  DashboardResponseSchema,
  PlanningQuerySchema,
  PlanningResponseSchema,
  CreateIndisponibiliteSchema,
  SessionListQuerySchema,
  SessionDetailResponseSchema,
  InscritsResponseSchema,
  MarkPresenceSchema,
  AttendanceResponseSchema,
  UpdateSessionNotesSchema,
  SessionNotesResponseSchema,
} from "@ecoledigitale/contracts/src/formateurs";
import { FormateurAttendanceService } from "../services/formateur-attendance.service";
import { SupportsCoursService } from "../services/supports-cours.service";
import { FormateurMessagingService } from "../services/formateur-messaging.service";
import { usesSessionBasedProfessionalTraining } from "../utils/table-names";
import {
  SupportsListQuerySchema,
  UploadSupportSchema,
  UpdateSupportSchema,
  GroupMessageSchema,
  GroupMessageResponseSchema,
  ProfileResponseSchema,
  UpdateProfileSchema,
  NotificationsQuerySchema,
  NotificationsResponseSchema,
  MarkNotificationReadResponseSchema,
} from "@ecoledigitale/contracts/src/formateurs";

interface AuthenticatedRequest extends FastifyRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
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

export async function formateurRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (request, reply) => {
    const tid = (request as AuthenticatedRequest).tenantId;
    if (tid && !usesSessionBasedProfessionalTraining(tid)) {
      return reply.status(404).send({
        success: false,
        error: "NOT_FOUND",
        message: "L'espace formateur n'est pas disponible pour ce tenant.",
      });
    }
  });

  // Register formateur authentication middleware for all routes
  await fastify.register(formateurAuthMiddleware);

  // Initialize services
  const formateurService = new FormateurService(fastify.pg as any);
  const attendanceService = new FormateurAttendanceService(fastify.pg as any);
  const supportsService = new SupportsCoursService(fastify.pg as any);
  const messagingService = new FormateurMessagingService(fastify.pg as any);

  // Helper to extract tenant context
  const getTenantId = (request: AuthenticatedRequest): string => {
    if (!request.tenantId) {
      throw new Error("TENANT_REQUIRED");
    }
    return request.tenantId;
  };

  // Helper to get formateur ID
  const getFormateurId = (request: AuthenticatedRequest): string => {
    if (!request.formateurId) {
      throw new Error("FORMATEUR_REQUIRED");
    }
    return request.formateurId;
  };

  // Error handling wrapper for all routes
  const handleRoute = (
    handler: (request: AuthenticatedRequest, reply: FastifyReply) => Promise<any>
  ) => {
    return async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        // Set tenant context for RLS
        const tenantId = getTenantId(request);
        await fastify.pg.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

        return await handler(request, reply);
      } catch (error: any) {
        fastify.log.error("Error in formateur route:", error);
        
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "Tenant Required",
            message: "Tenant context is required"
          });
        }

        if (error.message === "FORMATEUR_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: "Trainer Access Required",
            message: "Trainer authentication required"
          });
        }

        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: error.message || "An error occurred"
        });
      }
    };
  };

  // ============================================================================
  // DASHBOARD ENDPOINTS
  // ============================================================================

  // GET /api/v1/formateur/dashboard
  // T009: Dashboard API endpoint
  fastify.get("/dashboard", {
    schema: {
      tags: ["Formateur"],
      summary: "Get trainer dashboard overview",
      description: "Get dashboard statistics, upcoming sessions, recent sessions, materials, and notifications",
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                stats: {
                  type: "object",
                  properties: {
                    sessions_a_venir: { type: "number" },
                    sessions_en_cours: { type: "number" },
                    sessions_terminees_mois: { type: "number" },
                    total_apprenants: { type: "number" },
                    heures_formation_mois: { type: "number" },
                  },
                },
                prochaines_sessions: { type: "array" },
                sessions_recentes: { type: "array" },
                supports_recents: { type: "array" },
                notifications: {
                  type: "object",
                  properties: {
                    nb_non_lues: { type: "number" },
                    recentes: { type: "array" },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
      const tenantId = getTenantId(request);
      const formateurId = getFormateurId(request);

      const dashboardData = await formateurService.getDashboardData(formateurId, tenantId);

      // Validate response against schema
      const validated = DashboardResponseSchema.parse({
        success: true,
        data: dashboardData,
      });

      return reply.send(validated);
    }),
  });

  // ============================================================================
  // SCHEDULE ENDPOINTS
  // ============================================================================

  // GET /api/v1/formateur/planning
  // T015: Schedule API endpoint
  fastify.get("/planning", {
    schema: {
      tags: ["Formateur"],
      summary: "Get trainer schedule",
      description: "Get schedule with sessions and unavailability periods for a given year/month",
      querystring: {
        type: "object",
        required: ["annee"],
        properties: {
          annee: { type: "number", minimum: 2000, maximum: 2100 },
          mois: { type: "number", minimum: 1, maximum: 12 },
          vue: { type: "string", enum: ["mois", "semaine", "liste"] },
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
                sessions: { type: "array" },
                indisponibilites: { type: "array" },
              },
            },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    // Validate query parameters
    const query = PlanningQuerySchema.parse(request.query);
    const { annee, mois } = query;

    const scheduleData = await formateurService.getSchedule(
      formateurId,
      tenantId,
      annee,
      mois
    );

    // Format unavailability as FullCalendar events
    const indisponibiliteEvents = scheduleData.indisponibilites.map((indispo) => {
      const startDate = new Date(indispo.date_debut);
      const endDate = new Date(indispo.date_fin);
      // Add 1 day to end date for FullCalendar (exclusive end)
      endDate.setDate(endDate.getDate() + 1);

      return {
        id: `indispo-${indispo.id}`,
        title: `Indisponible${indispo.raison ? `: ${indispo.raison}` : ""}`,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        backgroundColor: "#9ca3af", // Gray for unavailability
        extendedProps: {
          type: "indisponibilite" as const,
          indispo_id: indispo.id,
          raison: indispo.raison,
        },
      };
    });

    // Combine sessions and unavailability events
    const allEvents = [...scheduleData.sessions, ...indisponibiliteEvents];

    const validated = PlanningResponseSchema.parse({
      success: true,
      data: {
        sessions: allEvents,
        indisponibilites: scheduleData.indisponibilites,
      },
    });

    return reply.send(validated);
  }),
  });

  // GET /api/v1/formateur/disponibilites
  // T015: Get all unavailability periods
  fastify.get("/disponibilites", {
    schema: {
      tags: ["Formateur"],
      summary: "Get all unavailability periods",
      description: "Get all unavailability periods for the trainer",
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                indisponibilites: { type: "array" },
              },
            },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    const indisponibilites = await formateurService.getIndisponibilites(formateurId, tenantId);

    return reply.send({
      success: true,
      data: {
        indisponibilites,
      },
    });
  }),
  });

  // POST /api/v1/formateur/disponibilites
  // T015: Create unavailability period
  fastify.post("/disponibilites", {
    schema: {
      tags: ["Formateur"],
      summary: "Create unavailability period",
      description: "Create a new unavailability period for the trainer",
      body: {
        type: "object",
        required: ["date_debut", "date_fin"],
        properties: {
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          raison: { type: "string", maxLength: 500 },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: { type: "object" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    // Validate request body
    const body = CreateIndisponibiliteSchema.parse(request.body);

    const indisponibilite = await formateurService.createIndisponibilite(
      formateurId,
      tenantId,
      body
    );

    return reply.status(201).send({
      success: true,
      data: indisponibilite,
    });
  }),
  });

  // DELETE /api/v1/formateur/disponibilites/:id
  // T015: Delete unavailability period
  fastify.delete("/disponibilites/:id", {
    schema: {
      tags: ["Formateur"],
      summary: "Delete unavailability period",
      description: "Delete an unavailability period (must be owned by trainer)",
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
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const indispoId = (request.params as any).id;

    await formateurService.deleteIndisponibilite(indispoId, formateurId, tenantId);

    return reply.send({
      success: true,
      message: "Unavailability period deleted successfully",
    });
  }),
  });

  // ============================================================================
  // SESSION ENDPOINTS
  // ============================================================================

  // GET /api/v1/formateur/sessions
  // T022: Session list endpoint
  fastify.get("/sessions", {
    schema: {
      tags: ["Formateur"],
      summary: "Get list of trainer's assigned sessions",
      description: "Get paginated list of sessions with filtering options",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1 },
          limit: { type: "number", minimum: 1, maximum: 100 },
          statuts: { type: "string" }, // Comma-separated
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          formation_id: { type: "string", format: "uuid" },
          search: { type: "string" },
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
                sessions: { type: "array" },
                pagination: {
                  type: "object",
                  properties: {
                    page: { type: "number" },
                    limit: { type: "number" },
                    total: { type: "number" },
                    totalPages: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    // Validate query parameters
    const query = SessionListQuerySchema.parse(request.query);

    const result = await formateurService.getSessions(formateurId, tenantId, {
      page: query.page,
      limit: query.limit,
      statuts: query.statuts,
      date_debut: query.date_debut,
      date_fin: query.date_fin,
      formation_id: query.formation_id,
      search: query.search,
    });

    return reply.send({
      success: true,
      data: result,
    });
  }),
  });

  // GET /api/v1/formateur/sessions/:id
  // T022: Session detail endpoint
  fastify.get("/sessions/:id", {
    schema: {
      tags: ["Formateur"],
      summary: "Get detailed session information",
      description: "Get complete session details including formation, enrolled learners, and materials",
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
            data: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const sessionId = (request.params as any).id;

    try {
      const result = await formateurService.getSessionDetails(sessionId, formateurId, tenantId);

      // Validate response
      const validated = SessionDetailResponseSchema.parse({
        success: true,
        data: result,
      });

      return reply.send(validated);
    } catch (error: any) {
      if (error.code === "SESSION_NOT_FOUND" || error.code === "ACCESS_DENIED") {
        return reply.status(404).send({
          success: false,
          error: error.code,
          message: error.message || "Session not found or access denied",
        });
      }
      throw error;
    }
  }),
  });

  // GET /api/v1/formateur/sessions/:id/inscrits
  // T022: Enrolled learners endpoint
  fastify.get("/sessions/:id/inscrits", {
    schema: {
      tags: ["Formateur"],
      summary: "Get enrolled learners for a session",
      description: "Get detailed list of enrolled learners with attendance status",
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
            data: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const sessionId = (request.params as any).id;

    try {
      const result = await formateurService.getSessionInscrits(sessionId, formateurId, tenantId);

      // Validate response
      const validated = InscritsResponseSchema.parse({
        success: true,
        data: result,
      });

      return reply.send(validated);
    } catch (error: any) {
      if (error.code === "SESSION_NOT_FOUND" || error.code === "ACCESS_DENIED") {
        return reply.status(404).send({
          success: false,
          error: error.code,
          message: error.message || "Session not found or access denied",
        });
      }
      throw error;
    }
  }),
  });

  // ============================================================================
  // ATTENDANCE ENDPOINTS
  // ============================================================================

  // PATCH /api/v1/formateur/sessions/:id/inscrits/:inscritId/presence
  // T030: Mark attendance endpoint
  fastify.patch("/sessions/:id/inscrits/:inscritId/presence", {
    schema: {
      tags: ["Formateur"],
      summary: "Mark attendance for a learner",
      description: "Mark a learner as present or absent (session must be in progress or completed)",
      params: {
        type: "object",
        required: ["id", "inscritId"],
        properties: {
          id: { type: "string", format: "uuid" },
          inscritId: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        required: ["present"],
        properties: {
          present: { type: "boolean" },
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
        400: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const sessionId = (request.params as any).id;
    const inscriptionId = (request.params as any).inscritId;

    // Validate request body
    const body = MarkPresenceSchema.parse(request.body);

    try {
      const result = await attendanceService.markAttendance(
        sessionId,
        inscriptionId,
        body.present,
        formateurId,
        tenantId
      );

      // Validate response
      const validated = AttendanceResponseSchema.parse({
        success: true,
        data: result,
      });

      return reply.send(validated);
    } catch (error: any) {
      if (error.message?.includes("SESSION_NOT_FOUND") || error.message?.includes("ACCESS_DENIED")) {
        return reply.status(404).send({
          success: false,
          error: "SESSION_NOT_FOUND",
          message: error.message || "Session not found or access denied",
        });
      }
      if (error.message?.includes("INVALID_SESSION_STATUS")) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_SESSION_STATUS",
          message: error.message || "Attendance can only be marked for sessions in progress or completed",
        });
      }
      if (error.message?.includes("INSCRIPTION_NOT_FOUND")) {
        return reply.status(404).send({
          success: false,
          error: "INSCRIPTION_NOT_FOUND",
          message: error.message || "Enrollment not found for this session",
        });
      }
      throw error;
    }
  }),
  });

  // GET /api/v1/formateur/sessions/:id/attendance/export
  // T030: Export attendance endpoint
  fastify.get("/sessions/:id/attendance/export", {
    schema: {
      tags: ["Formateur"],
      summary: "Export attendance list",
      description: "Export attendance list as CSV or PDF (session must be completed)",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["csv", "pdf"] },
        },
      },
      response: {
        200: {
          type: "string", // File download
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const sessionId = (request.params as any).id;
    const format = ((request.query as any)?.format || "csv") as "csv" | "pdf";

    // Verify session access
    try {
      const { verifySessionAccess } = await import("../utils/sessionAccess");
      await verifySessionAccess(fastify.pg as any, sessionId, formateurId, tenantId);
    } catch (error: any) {
      return reply.status(404).send({
        success: false,
        error: "SESSION_NOT_FOUND",
        message: error.message || "Session not found or access denied",
      });
    }

    try {
      const exportResult = await attendanceService.exportAttendanceList(sessionId, format, tenantId);

      reply.header("Content-Type", exportResult.contentType);
      reply.header("Content-Disposition", `attachment; filename="${exportResult.filename}"`);

      return reply.send(exportResult.content);
    } catch (error: any) {
      if (error.message?.includes("SESSION_NOT_FOUND")) {
        return reply.status(404).send({
          success: false,
          error: "SESSION_NOT_FOUND",
          message: error.message || "Session not found",
        });
      }
      throw error;
    }
  }),
  });

  // ============================================================================
  // COURSE MATERIALS ENDPOINTS
  // ============================================================================

  // GET /api/v1/formateur/supports
  // T038: Course materials list endpoint
  fastify.get("/supports", {
    schema: {
      tags: ["Formateur"],
      summary: "Get list of trainer's course materials",
      description: "Get paginated list of course materials with filtering options",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1 },
          limit: { type: "number", minimum: 1, maximum: 50 },
          formation_id: { type: "string", format: "uuid" },
          session_id: { type: "string", format: "uuid" },
          type_fichier: { type: "string", enum: ["PDF", "PPT", "DOC", "ZIP", "Video", "Autre"] },
          search: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    // Validate query parameters
    const query = SupportsListQuerySchema.parse(request.query);

    const result = await supportsService.getSupports(formateurId, tenantId, {
      page: query.page,
      limit: query.limit,
      formation_id: query.formation_id,
      session_id: query.session_id,
      type_fichier: query.type_fichier,
      search: query.search,
    });

    return reply.send({
      success: true,
      data: result,
    });
  }),
  });

  // POST /api/v1/formateur/supports/upload
  // T038: Course material upload endpoint
  fastify.post("/supports/upload", {
    schema: {
      tags: ["Formateur"],
      summary: "Upload a new course material",
      description: "Upload a course material file with metadata",
      consumes: ["multipart/form-data"],
      response: {
        201: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: { type: "object" },
          },
        },
        400: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    try {
      const fieldsMap = new Map<string, string[]>();
      let mainFileBuffer: Buffer | null = null;
      let mainFileName = "";
      let mainMimeType = "application/octet-stream";
      let thumbnailBuffer: Buffer | undefined;
      let thumbnailFileName: string | undefined;
      let thumbnailMimeType: string | undefined;

      for await (const part of (request as any).parts()) {
        if (part.type === "file") {
          const bufferedFile = await part.toBuffer();
          if (part.fieldname === "thumbnail_file") {
            thumbnailBuffer = bufferedFile;
            thumbnailFileName = part.filename || "thumbnail";
            thumbnailMimeType = part.mimetype || "application/octet-stream";
            continue;
          }

          if (part.fieldname === "file" || !mainFileBuffer) {
            mainFileBuffer = bufferedFile;
            mainFileName = part.filename || "support";
            mainMimeType = part.mimetype || "application/octet-stream";
          }
          continue;
        }

        const fieldValue = typeof part.value === "string" ? part.value : String(part.value ?? "");
        const existingValues = fieldsMap.get(part.fieldname) || [];
        existingValues.push(fieldValue);
        fieldsMap.set(part.fieldname, existingValues);
      }

      if (!mainFileBuffer) {
        return reply.status(400).send({
          success: false,
          error: "NO_FILE",
          message: "No file provided in the request",
        });
      }

      const getFieldValues = (fieldName: string): string[] => {
        const values = fieldsMap.get(fieldName) || [];
        return values.map((value) => value.trim()).filter((value) => value.length > 0);
      };

      const getFirstFieldValue = (fieldName: string): string | undefined => {
        const values = getFieldValues(fieldName);
        return values.length > 0 ? values[0] : undefined;
      };

      const titre = getFirstFieldValue("titre") || mainFileName || "Sans titre";
      const description = getFirstFieldValue("description");
      const formation_id = getFirstFieldValue("formation_id");
      const video_provider = getFirstFieldValue("video_provider");
      const vimeo_url = getFirstFieldValue("vimeo_url");
      const thumbnail_url = getFirstFieldValue("thumbnail_url");
      const sessionIdsRaw = getFieldValues("session_ids");
      const session_ids = sessionIdsRaw
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const visible_apprenants = getFirstFieldValue("visible_apprenants") !== "false";

      // Validate metadata
      const metadata = UploadSupportSchema.parse({
        titre,
        description,
        formation_id: formation_id || undefined,
        video_provider: video_provider || undefined,
        vimeo_url: vimeo_url || undefined,
        thumbnail_url: thumbnail_url || undefined,
        session_ids: session_ids.length > 0 ? session_ids.join(",") : undefined,
        visible_apprenants,
      });

      // Upload support
      const result = await supportsService.uploadSupport(
        mainFileBuffer,
        mainFileName,
        mainMimeType,
          {
            titre: metadata.titre,
            description: metadata.description,
            formation_id: metadata.formation_id,
            video_provider: metadata.video_provider,
            vimeo_url: metadata.vimeo_url,
            thumbnail_url: metadata.thumbnail_url,
            thumbnail_file_buffer: thumbnailBuffer,
            thumbnail_file_name: thumbnailFileName,
            thumbnail_content_type: thumbnailMimeType,
            session_ids: metadata.session_ids || [],
            visible_apprenants: metadata.visible_apprenants,
          },
        formateurId,
        tenantId
      );

      return reply.status(201).send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (
        error.message?.includes("FILE_TOO_LARGE") ||
        error.message?.includes("INVALID_FILE_TYPE") ||
        error.message?.includes("FORMATION_OR_SESSION_REQUIRED")
      ) {
        return reply.status(400).send({
          success: false,
          error: error.message.split(":")[0],
          message: error.message || "File validation failed",
        });
      }
      throw error;
    }
  }),
  });

  // GET /api/v1/formateur/supports/:id
  // T038: Course material detail endpoint
  fastify.get("/supports/:id", {
    schema: {
      tags: ["Formateur"],
      summary: "Get detailed course material information",
      description: "Get course material details with statistics",
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
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const supportId = (request.params as any).id;

    try {
      // Get support details (we'll need to add a method for this)
      // For now, get from list and add statistics
      const supportsResult = await supportsService.getSupports(
        formateurId,
        tenantId,
        { limit: 1000 } // Get all to find the one we need
      );

      const support = supportsResult.supports.find((s) => s.id === supportId);

      if (!support) {
        return reply.status(404).send({
          success: false,
          error: "SUPPORT_NOT_FOUND",
          message: "Course material not found or access denied",
        });
      }

      // Get statistics
      const statistics = await supportsService.getSupportStatistics(
        supportId,
        formateurId,
        tenantId
      );

      return reply.send({
        success: true,
        data: {
          support,
          sessions_associees: support.sessions,
          statistiques: statistics,
        },
      });
    } catch (error: any) {
      if (error.message?.includes("SUPPORT_NOT_FOUND")) {
        return reply.status(404).send({
          success: false,
          error: "SUPPORT_NOT_FOUND",
          message: error.message || "Course material not found or access denied",
        });
      }
      throw error;
    }
  }),
  });

  // PUT /api/v1/formateur/supports/:id
  // T038: Update course material endpoint
  fastify.put("/supports/:id", {
    schema: {
      tags: ["Formateur"],
      summary: "Update course material metadata",
      description: "Update course material metadata (file cannot be changed)",
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
          titre: { type: "string", maxLength: 255 },
          description: { type: "string", maxLength: 2000 },
          visible_apprenants: { type: "boolean" },
          session_ids: { type: "array", items: { type: "string", format: "uuid" } },
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
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const supportId = (request.params as any).id;

    // Validate request body
    const body = UpdateSupportSchema.parse(request.body);

    try {
      const result = await supportsService.updateSupport(
        supportId,
        body,
        formateurId,
        tenantId
      );

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error.message?.includes("SUPPORT_NOT_FOUND")) {
        return reply.status(404).send({
          success: false,
          error: "SUPPORT_NOT_FOUND",
          message: error.message || "Course material not found or access denied",
        });
      }
      throw error;
    }
  }),
  });

  // DELETE /api/v1/formateur/supports/:id
  // T038: Delete course material endpoint
  fastify.delete("/supports/:id", {
    schema: {
      tags: ["Formateur"],
      summary: "Delete a course material",
      description: "Delete a course material and its associations",
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
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const supportId = (request.params as any).id;

    try {
      await supportsService.deleteSupport(supportId, formateurId, tenantId);

      return reply.send({
        success: true,
        message: "Course material deleted successfully",
      });
    } catch (error: any) {
      if (error.message?.includes("SUPPORT_NOT_FOUND")) {
        return reply.status(404).send({
          success: false,
          error: "SUPPORT_NOT_FOUND",
          message: error.message || "Course material not found or access denied",
        });
      }
      throw error;
    }
  }),
  });

  // ============================================================================
  // SESSION NOTES ENDPOINTS
  // ============================================================================

  // POST /api/v1/formateur/sessions/:id/notes
  // T044: Session notes endpoint
  fastify.post("/sessions/:id/notes", {
    schema: {
      tags: ["Formateur"],
      summary: "Add or update session notes",
      description: "Add or update private notes for a session (trainer only)",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      body: {
        type: "object",
        required: ["notes"],
        properties: {
          notes: { type: "string", maxLength: 10000 },
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
        400: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const sessionId = (request.params as any).id;

    // Validate request body
    const body = UpdateSessionNotesSchema.parse(request.body);

    try {
      const result = await formateurService.updateSessionNotes(
        sessionId,
        body.notes,
        formateurId,
        tenantId
      );

      // Validate response
      const validated = SessionNotesResponseSchema.parse({
        success: true,
        data: result,
      });

      return reply.send(validated);
    } catch (error: any) {
      if (error.message?.includes("SESSION_NOT_FOUND") || error.message?.includes("ACCESS_DENIED")) {
        return reply.status(404).send({
          success: false,
          error: "SESSION_NOT_FOUND",
          message: error.message || "Session not found or access denied",
        });
      }
      if (error.message?.includes("NOTES_TOO_LONG")) {
        return reply.status(400).send({
          success: false,
          error: "NOTES_TOO_LONG",
          message: error.message || "Notes cannot exceed 10000 characters",
        });
      }
      throw error;
    }
  }),
  });

  // ============================================================================
  // PROFILE ENDPOINTS
  // ============================================================================

  // GET /api/v1/formateur/profil
  // T054: Get profile endpoint
  fastify.get("/profil", {
    schema: {
      tags: ["Formateur"],
      summary: "Get trainer profile information",
      description: "Get complete trainer profile with statistics and assigned training programs",
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
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    const profileData = await formateurService.getProfile(formateurId, tenantId);

    // Validate response
    const validated = ProfileResponseSchema.parse({
      success: true,
      data: profileData,
    });

    return reply.send(validated);
  }),
  });

  // PUT /api/v1/formateur/profil
  // T054: Update profile endpoint
  fastify.put("/profil", {
    schema: {
      tags: ["Formateur"],
      summary: "Update trainer profile information",
      description: "Update trainer profile including bio, expertise, LinkedIn, and photo",
      consumes: ["application/json", "multipart/form-data"],
      body: {
        type: "object",
        properties: {
          bio: { type: "string", maxLength: 2000 },
          specialites: { type: "array", items: { type: "string" } },
          linkedin_url: { type: "string" },
          photo: { type: "string" }, // Base64 or file
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
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    // Handle multipart form data for photo upload
    let body: any = request.body;
    let photoBuffer: Buffer | undefined;
    let photoContentType: string | undefined;

    if (request.isMultipart()) {
      const data = await request.file();
      if (data) {
        body = {};
        for (const [key, value] of Object.entries(data.fields)) {
          const fieldValue = (value as any)?.value;
          if (key === "photo" && data.file) {
            photoBuffer = await data.toBuffer();
            photoContentType = data.mimetype;
          } else {
            body[key] = fieldValue;
          }
        }
      }
    }

    // Validate request body
    const validated = UpdateProfileSchema.parse(body);

    try {
      const result = await formateurService.updateProfile(
        formateurId,
        {
          ...validated,
          photo: photoBuffer || validated.photo,
          photoContentType,
        },
        tenantId
      );

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error.message?.includes("FORMATEUR_NOT_FOUND")) {
        return reply.status(404).send({
          success: false,
          error: "FORMATEUR_NOT_FOUND",
          message: error.message || "Trainer not found",
        });
      }
      if (error.message?.includes("INVALID_PHOTO_TYPE") || error.message?.includes("PHOTO_TOO_LARGE")) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_PHOTO",
          message: error.message || "Invalid photo",
        });
      }
      throw error;
    }
  }),
  });

  // POST /api/v1/formateur/profil/cv
  // T054: CV upload endpoint
  fastify.post("/profil/cv", {
    schema: {
      tags: ["Formateur"],
      summary: "Upload or replace trainer CV",
      description: "Upload a PDF CV file for the trainer",
      consumes: ["multipart/form-data"],
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: { type: "object" },
          },
        },
        400: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        success: false,
        error: "NO_FILE",
        message: "No file uploaded",
      });
    }

    const fileBuffer = await data.toBuffer();

    try {
      const result = await formateurService.uploadCV(
        formateurId,
        fileBuffer,
        data.filename,
        data.mimetype,
        tenantId
      );

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error.message?.includes("FORMATEUR_NOT_FOUND")) {
        return reply.status(404).send({
          success: false,
          error: "FORMATEUR_NOT_FOUND",
          message: error.message || "Trainer not found",
        });
      }
      if (error.message?.includes("INVALID_CV_TYPE") || error.message?.includes("CV_TOO_LARGE")) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_CV",
          message: error.message || "Invalid CV file",
        });
      }
      throw error;
    }
  }),
  });

  // ============================================================================
  // NOTIFICATION ENDPOINTS
  // ============================================================================

  // GET /api/v1/formateur/notifications
  // T059: Get notifications endpoint
  fastify.get("/notifications", {
    schema: {
      tags: ["Formateur"],
      summary: "Get trainer notifications",
      description: "Get paginated list of notifications with optional unread filter",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1 },
          limit: { type: "number", minimum: 1, maximum: 50 },
          non_lues: { type: "boolean" },
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
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);

    // Validate query parameters
    const query = NotificationsQuerySchema.parse(request.query);

    const notificationsData = await formateurService.getNotifications(
      formateurId,
      tenantId,
      query
    );

    // Validate response
    const validated = NotificationsResponseSchema.parse({
      success: true,
      data: notificationsData,
    });

    return reply.send(validated);
  }),
  });

  // PATCH /api/v1/formateur/notifications/:id/lire
  // T059: Mark notification as read endpoint
  fastify.patch("/notifications/:id/lire", {
    schema: {
      tags: ["Formateur"],
      summary: "Mark notification as read",
      description: "Mark a notification as read for the authenticated trainer",
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
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
    const tenantId = getTenantId(request);
    const formateurId = getFormateurId(request);
    const notificationId = (request.params as any).id;

    try {
      const result = await formateurService.markNotificationRead(
        notificationId,
        formateurId,
        tenantId
      );

      // Validate response
      const validated = MarkNotificationReadResponseSchema.parse({
        success: true,
        data: result,
      });

      return reply.send(validated);
    } catch (error: any) {
      if (error.message?.includes("NOTIFICATION_NOT_FOUND")) {
        return reply.status(404).send({
          success: false,
          error: "NOTIFICATION_NOT_FOUND",
          message: error.message || "Notification not found or access denied",
        });
      }
      throw error;
    }
  }),
  });

  // Placeholder root route
  fastify.get("/", {
    handler: handleRoute(async (request: AuthenticatedRequest, reply) => {
      return reply.send({
        success: true,
        message: "Trainer space API - Routes will be implemented in subsequent phases"
      });
    }),
  });
}
