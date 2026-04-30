import { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { SessionProService } from "../services/session-pro.service";
import { FormateurAvailabilityService } from "../services/formateur-availability.service";
import { getTableName, usesSessionBasedProfessionalTraining } from "../utils/table-names";
import {
  SessionListQuerySchema,
  CalendarQuerySchema,
  CreateSessionSchema,
  UpdateSessionSchema,
  SessionProStatusSchema,
  EnrollmentListQuerySchema,
} from "@ecoledigitale/contracts/src/sessions-pro";
import { AdminSessionListQuerySchema, DuplicateSessionSchema } from "@ecoledigitale/contracts/src/sessions-pro/admin.schema";

/**
 * Sessions Professionnelles Routes
 * 
 * Public endpoints:
 * - GET /api/v1/sessions-pro - List sessions with filters
 * - GET /api/v1/sessions-pro/calendrier - Get calendar events
 * - GET /api/v1/sessions-pro/:id - Get session details
 * - GET /api/v1/sessions-pro/:id/disponibilite - Get availability
 * 
 * Admin endpoints:
 * - POST /api/v1/admin/sessions-pro - Create session
 * - PUT /api/v1/admin/sessions-pro/:id - Update session
 * - PATCH /api/v1/admin/sessions-pro/:id/statut - Update status
 * - DELETE /api/v1/admin/sessions-pro/:id - Delete session
 * - GET /api/v1/admin/sessions-pro - List all sessions (admin)
 * - GET /api/v1/admin/sessions-pro/:id - Get session details (admin)
 * - GET /api/v1/admin/sessions-pro/:id/inscrits - Get enrollments
 * - GET /api/v1/admin/sessions-pro/export - Export sessions
 * - GET /api/v1/admin/sessions-pro/:id/inscrits/export - Export enrollments
 * - POST /api/v1/admin/sessions-pro/:id/dupliquer - Duplicate session
 * - GET /api/v1/admin/formateurs/disponibilites - Check trainer availability
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

export async function sessionsProRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (request, reply) => {
    const tid = (request as AuthenticatedRequest).tenantId;
    if (tid && !usesSessionBasedProfessionalTraining(tid)) {
      return reply.status(404).send({
        success: false,
        error: "NOT_FOUND",
        message: "Le planning par sessions n'est pas disponible pour ce tenant.",
      });
    }
  });

  const availabilityService = new FormateurAvailabilityService(fastify.pg as any);
  const sessionService = new SessionProService(fastify.pg as any, availabilityService);

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

  const generatePassword = (): string => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  // ============================================================================
  // PUBLIC ENDPOINTS
  // ============================================================================

  // GET /api/v1/sessions-pro - List sessions with filters, pagination, and sorting
  fastify.get("/", {
    schema: {
      tags: ["Sessions Professionnelles"],
      summary: "List training sessions",
      description: "Get a paginated list of training sessions with filtering, sorting, and pagination",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          formation_id: { type: "string", format: "uuid" },
          mode: { type: "string" }, // Comma-separated: "presentiel,distanciel"
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          statut: { type: "string" }, // Comma-separated statuses
          formateur_id: { type: "string", format: "uuid" },
          mois: { type: "string", pattern: "^\\d{4}-\\d{2}$" }, // YYYY-MM
          annee: { type: "number", minimum: 2000, maximum: 2100 },
          sort: {
            type: "string",
            enum: ["date_asc", "date_desc", "prix_asc", "prix_desc"],
          },
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
                sessions: {
                  type: "array",
                  items: { type: "object" },
                },
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        const queryParams = request.query as any;

        // Validate and parse query parameters
        const query = SessionListQuerySchema.parse(queryParams);

        // Fetch sessions
        const { sessions, total } = await sessionService.getSessionsList(
          tenantId,
          query,
          true // Exclude cancelled sessions for public access
        );

        const page = query.page || 1;
        const limit = query.limit || 20;
        const totalPages = Math.ceil(total / limit);

        // Debug: Log sessions before sending (safe logging)
        try {
          const firstSession = sessions[0] || null;
          console.log('ðŸ“¤ [sessions-pro route] Before reply.send:', {
            sessionsCount: sessions.length,
            firstSessionKeys: firstSession ? Object.keys(firstSession) : null,
            firstSessionId: firstSession?.id,
            firstSessionCode: firstSession?.code_session,
            firstSessionFormation: firstSession?.formation,
          });
        } catch (logError) {
          console.error('âŒ [sessions-pro route] Error logging sessions:', logError);
        }

        // Force plain object serialization to ensure all properties are enumerable
        // This is the same approach used in getFormationBySlug which works correctly
        const serializedSessions = sessions.map(session => {
          return {
            id: session.id,
            code_session: session.code_session,
            formation: session.formation,
            date_debut: session.date_debut,
            date_fin: session.date_fin,
            horaires: session.horaires,
            mode_formation: session.mode_formation,
            lieu: session.lieu,
            lien_visio: session.lien_visio,
            places_totales: session.places_totales,
            places_reservees: session.places_reservees,
            places_disponibles: session.places_disponibles,
            statut: session.statut,
            prix_ht: session.prix_ht,
            prix_ttc: session.prix_ttc,
            formateurs: session.formateurs,
          };
        });

        console.log('ðŸ”„ [sessions-pro route] After serialization:', {
          sessionsCount: serializedSessions.length,
          firstSerializedSession: serializedSessions[0] || null,
          firstSerializedSessionKeys: serializedSessions[0] ? Object.keys(serializedSessions[0]) : null,
        });

        const response = {
          success: true,
          data: {
            sessions: serializedSessions,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        };

        // Force JSON serialization using Object.assign to create truly plain objects
        // This ensures all properties are enumerable and serializable
        const plainResponse = {
          success: true,
          data: {
            sessions: serializedSessions.map(s => Object.assign({}, s)),
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
        };

        // Serialize to JSON string
        const jsonString = JSON.stringify(plainResponse);
        console.log('ðŸ“ [sessions-pro route] JSON string length:', jsonString.length);
        console.log('ðŸ“ [sessions-pro route] JSON string (first 1000 chars):', jsonString.substring(0, 1000));
        
        // Send JSON string directly via reply.raw to bypass Fastify's serializer
        // This ensures the exact JSON string is sent without any modification
        reply.type('application/json');
        reply.raw.statusCode = 200;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(jsonString);
        reply.sent = true; // Tell Fastify that the response has been sent
        return;
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: error.errors,
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while fetching sessions",
        });
      }
    },
  });

  // GET /api/v1/sessions-pro/calendrier - Get calendar events
  fastify.get("/calendrier", {
    schema: {
      tags: ["Sessions Professionnelles"],
      summary: "Get calendar events",
      description: "Get training sessions formatted for calendar display (FullCalendar format)",
      querystring: {
        type: "object",
        properties: {
          annee: { type: "number", minimum: 2000, maximum: 2100 },
          mois: { type: "number", minimum: 1, maximum: 12 },
          formations: { type: "string" }, // Comma-separated UUIDs
          modes: { type: "string" }, // Comma-separated: "presentiel,distanciel"
        },
        required: ["annee"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                events: {
                  type: "array",
                  items: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        const queryParams = request.query as any;

        fastify.log.info('ðŸ“… Calendar endpoint called');
        fastify.log.info('  Tenant ID:', tenantId);
        fastify.log.info('  Query params:', JSON.stringify(queryParams));

        // Validate and parse query parameters
        const query = CalendarQuerySchema.parse(queryParams);
        
        fastify.log.info('  Parsed query:', JSON.stringify(query));

        // Parse formation IDs if provided
        const formationIds = query.formations && query.formations.length > 0 
          ? query.formations 
          : undefined;

        fastify.log.info('  Formation IDs:', formationIds);
        fastify.log.info('  Modes:', query.modes);

        // Fetch calendar events
        fastify.log.info('  Calling getSessionsCalendar...');
        const events = await sessionService.getSessionsCalendar(
          tenantId,
          query.annee,
          query.mois,
          formationIds,
          query.modes
        );

        // Debug: Log events before sending
        fastify.log.info(`âœ… Calendar events fetched: ${events.length} events`);
        if (events.length > 0) {
          fastify.log.info(`  First event: ${JSON.stringify(events[0])}`);
          fastify.log.info(`  First event keys: ${Object.keys(events[0]).join(', ')}`);
          fastify.log.info(`  First event type: ${typeof events[0]}`);
          fastify.log.info(`  First event constructor: ${events[0].constructor?.name}`);
          
          // Test serialization
          const testSerialized = JSON.stringify(events[0]);
          const testParsed = JSON.parse(testSerialized);
          fastify.log.info(`  Serialization test - keys after parse: ${Object.keys(testParsed).join(', ')}`);
        } else {
          fastify.log.warn('âš ï¸  No events found for this period');
        }

        // Ensure events are plain objects (not class instances)
        const plainEvents = events.map(event => ({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          backgroundColor: event.backgroundColor,
          borderColor: event.borderColor,
          extendedProps: event.extendedProps,
        }));
        
        const response = {
          success: true,
          data: {
            events: plainEvents,
          },
        };
        
        // Debug: Log response before serialization
        fastify.log.info(`  Response structure - events count: ${response.data.events.length}`);
        if (response.data.events.length > 0) {
          fastify.log.info(`  Response first event keys: ${Object.keys(response.data.events[0]).join(', ')}`);
          const testSerialized = JSON.stringify(response.data.events[0]);
          fastify.log.info(`  Response first event serialized: ${testSerialized}`);
        }

        // Serialize to JSON string and send directly via reply.raw to bypass Fastify's serializer
        // This ensures the exact JSON string is sent without any modification
        const jsonString = JSON.stringify(response);
        reply.type('application/json');
        reply.raw.statusCode = 200;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(jsonString);
        reply.sent = true; // Tell Fastify that the response has been sent
        return;
      } catch (error: any) {
        fastify.log.error('âŒ Error in calendar endpoint:', error);
        fastify.log.error('  Error message:', error.message);
        fastify.log.error('  Error stack:', error.stack);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: error.errors,
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while fetching calendar events",
        });
      }
    },
  });

  // GET /api/v1/sessions-pro/:id - Get session details
  fastify.get("/:id", {
    schema: {
      tags: ["Sessions Professionnelles"],
      summary: "Get session details",
      description: "Get detailed information about a specific training session",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        const { id } = request.params as { id: string };

        console.log('ðŸ” [GET /:id] Fetching session:', { tenantId, sessionId: id });

        const session = await sessionService.getSessionById(tenantId, id);

        console.log('ðŸ“Š [GET /:id] Session fetched:', { 
          hasSession: !!session,
          sessionId: session?.id,
          sessionKeys: session ? Object.keys(session) : null,
          hasFormation: !!session?.formation,
          formationTitre: session?.formation?.titre,
          formationKeys: session?.formation ? Object.keys(session.formation) : null,
        });

        if (!session) {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Session not found",
          });
        }

        // Force plain object serialization to ensure all properties are enumerable
        const plainSession = Object.assign({}, session);
        
        console.log('ðŸ”„ [GET /:id] Plain session:', {
          plainSessionKeys: Object.keys(plainSession),
          plainSessionId: plainSession.id,
          plainSessionHasFormation: !!plainSession.formation,
          plainSessionFormationTitre: plainSession.formation?.titre,
          plainSessionFormationKeys: plainSession.formation ? Object.keys(plainSession.formation) : null,
        });

        // Serialize to JSON string and send directly via reply.raw to bypass Fastify's serializer
        const jsonString = JSON.stringify({
          success: true,
          data: plainSession,
        });
        
        // Parse back to verify serialization
        const parsed = JSON.parse(jsonString);
        console.log('ðŸ“ [GET /:id] After serialization/parsing:', {
          jsonStringLength: jsonString.length,
          parsedHasData: !!parsed.data,
          parsedDataKeys: parsed.data ? Object.keys(parsed.data) : null,
          parsedDataHasFormation: !!parsed.data?.formation,
          parsedDataFormationTitre: parsed.data?.formation?.titre,
          parsedDataFormationKeys: parsed.data?.formation ? Object.keys(parsed.data.formation) : null,
          jsonStringPreview: jsonString.substring(0, 500),
        });
        
        reply.type('application/json');
        reply.raw.statusCode = 200;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(jsonString);
        reply.sent = true;
        return;
      } catch (error: any) {
        console.error('âŒ [GET /:id] Error:', {
          error,
          errorMessage: error?.message,
          errorStack: error?.stack,
          errorName: error?.name,
        });
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while fetching session details",
        });
      }
    },
  });

  // GET /api/v1/sessions-pro/:id/disponibilite - Get session availability
  fastify.get("/:id/disponibilite", {
    schema: {
      tags: ["Sessions Professionnelles"],
      summary: "Get session availability",
      description: "Get real-time availability information for a session",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                places_disponibles: { type: "number" },
                places_reservees: { type: "number" },
                places_totales: { type: "number" },
                peut_inscrire: { type: "boolean" },
                message: { type: "string" },
              },
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        const { id } = request.params as { id: string };

        const availability = await sessionService.getSessionAvailability(
          tenantId,
          id
        );

        return reply.send({
          success: true,
          data: availability,
        });
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        if (error.message === "SESSION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Session not found",
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while fetching session availability",
        });
      }
    },
  });

  // ============================================================================
  // ADMIN ENDPOINTS
  // ============================================================================

  // GET /api/v1/admin/sessions-pro - List all sessions (admin) with extended filters and search
  fastify.get("/admin/sessions-pro", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "List all sessions (admin)",
      description: "Get a paginated list of all training sessions with extended filters, search, and statistics (admin only)",
      querystring: {
        type: "object",
        properties: {
          page: { type: "number", minimum: 1, default: 1 },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          formation_id: { type: "string", format: "uuid" },
          mode: { type: "string" }, // Comma-separated: "presentiel,distanciel"
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          statut: { type: "string" }, // Comma-separated statuses (includes 'annulee')
          formateur_id: { type: "string", format: "uuid" },
          mois: { type: "string", pattern: "^\\d{4}-\\d{2}$" }, // YYYY-MM
          annee: { type: "number", minimum: 2000, maximum: 2100 },
          sort: {
            type: "string",
            enum: ["date_asc", "date_desc", "prix_asc", "prix_desc"],
          },
          search: { type: "string" }, // Search by code_session or formation title
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
                sessions: {
                  type: "array",
                  items: { type: "object" },
                },
                pagination: {
                  type: "object",
                  properties: {
                    page: { type: "number" },
                    limit: { type: "number" },
                    total: { type: "number" },
                    totalPages: { type: "number" },
                  },
                },
                statistics: {
                  type: "object",
                  properties: {
                    sessions_actives: { type: "number" },
                    sessions_ce_mois: { type: "number" },
                    taux_remplissage: { type: "number" },
                    ca_previsionnel: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const queryParams = request.query as any;

        // Validate and parse query parameters
        const query = AdminSessionListQuerySchema.parse(queryParams);

        // Fetch sessions with statistics
        const { sessions, total, statistics } = await sessionService.getAdminSessionsList(
          tenantId,
          query
        );

        const page = query.page || 1;
        const limit = query.limit || 20;
        const totalPages = Math.ceil(total / limit);

        // Debug: Log first session before sending
        if (sessions.length > 0) {
          console.log('ðŸ” [admin sessions route] First session before send:', {
            id: sessions[0].id,
            code_session: sessions[0].code_session,
            formation: sessions[0].formation,
            formationType: typeof sessions[0].formation,
            formationStringified: JSON.stringify(sessions[0].formation),
          });
        }

        const responseData = {
          success: true,
          data: {
            sessions,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
            statistics,
          },
        };

        // Debug: Log the response data structure before sending
        const responseString = JSON.stringify(responseData);
        console.log('ðŸ“¤ [admin sessions route] Response data structure:', {
          hasSuccess: !!responseData.success,
          hasData: !!responseData.data,
          hasSessions: !!responseData.data.sessions,
          sessionsLength: responseData.data.sessions.length,
          firstSessionId: responseData.data.sessions[0]?.id,
          firstSessionCode: responseData.data.sessions[0]?.code_session,
          firstSessionFormation: responseData.data.sessions[0]?.formation,
          firstSessionKeys: responseData.data.sessions[0] ? Object.keys(responseData.data.sessions[0]) : [],
          firstSessionFull: JSON.stringify(responseData.data.sessions[0] || {}),
          responseStringLength: responseString.length,
          responseStringFirst1000: responseString.substring(0, 1000),
        });

        // Serialize to JSON string and send directly via reply.raw to bypass Fastify's serializer
        // This ensures the exact JSON string is sent without any modification
        reply.type('application/json');
        reply.raw.statusCode = 200;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(responseString);
        reply.sent = true; // Tell Fastify that the response has been sent
        return;
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }
        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: error.errors,
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while fetching sessions",
        });
      }
    },
  });

  // POST /api/v1/admin/sessions-pro - Create new session
  fastify.post("/admin/sessions-pro", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Create a new training session",
      description: "Create a new training session with trainer availability validation",
      body: {
        type: "object",
        properties: {
          formation_id: { type: "string", format: "uuid" },
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          horaires: { type: "string" },
          mode_formation: { type: "string", enum: ["presentiel", "distanciel", "hybride"] },
          lieu: { type: "string" },
          lien_visio: { type: "string" },
          places_totales: { type: "number", minimum: 1 },
          prix_ht: { type: "number" },
          prix_ttc: { type: "number" },
          formateur_ids: { type: "array", items: { type: "string", format: "uuid" } },
          statut: { type: "string", enum: ["planifiee", "ouverte"] },
          notes_internes: { type: "string" },
        },
        required: ["formation_id", "date_debut", "date_fin", "horaires", "mode_formation", "places_totales", "formateur_ids"],
      },
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        if (!CreateSessionSchema) {
          fastify.log.error("CreateSessionSchema is undefined");
          return reply.status(500).send({
            success: false,
            error: "INTERNAL_ERROR",
            message: "Schema validation not available",
          });
        }

        const body = request.body as any;
        const validatedData = CreateSessionSchema.parse(body);

        const session = await sessionService.createSession(tenantId, validatedData);

        return reply.status(201).send({
          success: true,
          data: session,
        });
      } catch (error: any) {
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid request data",
            details: error.errors,
          });
        }

        if (error.message?.startsWith("TRAINER_CONFLICT")) {
          return reply.status(400).send({
            success: false,
            error: "TRAINER_CONFLICT",
            message: error.message,
          });
        }

        if (error.message?.startsWith("VALIDATION_ERROR") || error.message?.startsWith("INVALID_DATES") || error.message === "FORMATION_NOT_FOUND") {
          return reply.status(400).send({
            success: false,
            error: error.message.split(":")[0],
            message: error.message,
          });
        }

        // Log full error for debugging
        fastify.log.error({
          error: error.message,
          stack: error.stack,
          name: error.name,
        });

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while creating the session",
          ...(process.env.NODE_ENV === 'development' && { details: error.stack }),
        });
      }
    },
  });

  // PUT /api/v1/admin/sessions-pro/:id - Update session (T076)
  fastify.put("/admin/sessions-pro/:id", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Update an existing session",
      description: "Update session details with validation and change detection",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          formation_id: { type: "string", format: "uuid" },
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          horaires: { type: "string" },
          mode_formation: { type: "string", enum: ["presentiel", "distanciel", "hybride"] },
          lieu: { type: "string" },
          lien_visio: { type: "string" },
          places_totales: { type: "number", minimum: 1 },
          prix_ht: { type: "number" },
          prix_ttc: { type: "number" },
          formateur_ids: { type: "array", items: { type: "string", format: "uuid" } },
          statut: { type: "string", enum: ["planifiee", "ouverte"] },
          notes_internes: { type: "string" },
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
            details: { type: "array" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const params = request.params as { id: string };
        const body = request.body as any;
        const validatedData = UpdateSessionSchema.parse(body);

        const session = await sessionService.updateSession(tenantId, params.id, validatedData);

        return reply.status(200).send({
          success: true,
          data: session,
        });
      } catch (error: any) {
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        if (error.message === "SESSION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Session not found",
          });
        }

        if (error.message?.startsWith("SESSION_LOCKED")) {
          return reply.status(400).send({
            success: false,
            error: "SESSION_LOCKED",
            message: error.message,
          });
        }

        if (error.message?.startsWith("CAPACITY_CONFLICT")) {
          return reply.status(400).send({
            success: false,
            error: "CAPACITY_CONFLICT",
            message: error.message,
          });
        }

        if (error.message?.startsWith("TRAINER_CONFLICT")) {
          return reply.status(400).send({
            success: false,
            error: "TRAINER_CONFLICT",
            message: error.message,
          });
        }

        if (error.message?.startsWith("INVALID_DATES")) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_DATES",
            message: error.message,
          });
        }

        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid request data",
            details: error.errors,
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while updating the session",
        });
      }
    },
  });

  // PATCH /api/v1/admin/sessions-pro/:id/statut - Update session status (T084)
  fastify.patch("/admin/sessions-pro/:id/statut", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Update session status",
      description: "Update session status with transition validation",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          statut: { 
            type: "string", 
            enum: ["planifiee", "ouverte", "complete", "en_cours", "terminee", "annulee"] 
          },
        },
        required: ["statut"],
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
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const params = request.params as { id: string };
        const body = request.body as { statut: string };
        
        // Validate status
        const validatedStatus = SessionProStatusSchema.parse(body.statut);

        const result = await sessionService.updateSessionStatus(tenantId, params.id, validatedStatus);

        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        if (error.message === "SESSION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Session not found",
          });
        }

        if (error.message?.startsWith("INVALID_STATUS_TRANSITION")) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_STATUS_TRANSITION",
            message: error.message,
          });
        }

        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid status value",
            details: error.errors,
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while updating the session status",
        });
      }
    },
  });

  // POST /api/v1/admin/formateurs - Create formateur
  fastify.post("/admin/formateurs", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Create formateur",
      description: "Create a new formateur (admin only)",
      body: {
        type: "object",
        required: ["nom", "prenom", "email"],
        properties: {
          password: { type: "string", minLength: 8 },
          civilite: { type: "string" },
          nom: { type: "string" },
          prenom: { type: "string" },
          email: { type: "string" },
          telephone: { type: "string" },
          specialites: {
            type: "array",
            items: { type: "string" },
          },
          bio: { type: "string" },
          linkedin_url: { type: "string" },
          tarif_journalier: { type: "number" },
          actif: { type: "boolean", default: true },
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);
        const body = request.body as any;

        const client = await (fastify.pg as any).connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
          await client.query("BEGIN");

          const formateursTable = getTableName(tenantId, "formateurs");

          const existingCheck = await client.query(
            `SELECT id FROM ${formateursTable} WHERE tenant_id = $1 AND email = $2`,
            [tenantId, body.email]
          );

          if (existingCheck.rows.length > 0) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              success: false,
              error: "EMAIL_EXISTS",
              message: "Un formateur avec cet email existe deja",
            });
          }
          const existingUser = await client.query(
            `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
            [tenantId, body.email]
          );

          if (existingUser.rows.length > 0) {
            await client.query("ROLLBACK");
            return reply.status(400).send({
              success: false,
              error: "EMAIL_EXISTS",
              message: "Un utilisateur avec cet email existe deja",
            });
          }

          const plainPassword = typeof body.password === "string" && body.password.trim().length >= 8
            ? body.password
            : generatePassword();
          const passwordHash = await bcrypt.hash(plainPassword, 12);
          const fullName = `${body.prenom} ${body.nom}`;

          const userInsert = await client.query(
            `
              INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id
            `,
            [tenantId, body.email, fullName, body.prenom, body.nom, passwordHash]
          );
          const userId = userInsert.rows[0].id;

          const roleResult = await client.query(
            `SELECT id FROM roles WHERE key = 'formateur' AND COALESCE(is_active, true) = true LIMIT 1`
          );
          let roleId = roleResult.rows[0]?.id;
          if (!roleId) {
            const createdRole = await client.query(
              `INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
               VALUES ('formateur', 'Formateur', true, true, NOW(), NOW()) RETURNING id`
            );
            roleId = createdRole.rows[0].id;
          }

          await client.query(
            `INSERT INTO user_roles (tenant_id, user_id, role_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
            [tenantId, userId, roleId]
          );

          const insertQuery = `
            INSERT INTO ${formateursTable} (
              tenant_id, user_id, civilite, nom, prenom, email, telephone,
              specialites, bio, linkedin_url, tarif_journalier, actif, initial_password
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id, user_id, civilite, nom, prenom, email, telephone, specialites, bio,
                      linkedin_url, tarif_journalier, actif, initial_password, created_at
          `;

          const result = await client.query(insertQuery, [
            tenantId,
            userId,
            body.civilite || null,
            body.nom,
            body.prenom,
            body.email,
            body.telephone || null,
            body.specialites ? JSON.stringify(body.specialites) : null,
            body.bio || null,
            body.linkedin_url || null,
            body.tarif_journalier || null,
            body.actif !== undefined ? body.actif : true,
            plainPassword,
          ]);

          const formateur = result.rows[0];
          await client.query("COMMIT");

          return reply.status(201).send({
            success: true,
            data: {
              id: formateur.id,
              user_id: formateur.user_id,
              civilite: formateur.civilite,
              nom: formateur.nom,
              prenom: formateur.prenom,
              email: formateur.email,
              telephone: formateur.telephone,
              specialites: formateur.specialites || [],
              bio: formateur.bio,
              linkedin_url: formateur.linkedin_url,
              tarif_journalier: formateur.tarif_journalier,
              actif: formateur.actif,
              initialPassword: formateur.initial_password,
              created_at: formateur.created_at,
            },
          });
        } catch (dbError) {
          await client.query("ROLLBACK");
          throw dbError;
        } finally {
          client.release();
        }
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        if (error.code === "23505") {
          return reply.status(400).send({
            success: false,
            error: "EMAIL_EXISTS",
            message: "Un formateur avec cet email existe deja",
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while creating formateur",
        });
      }
    },
  });

  // POST /api/v1/admin/formateurs/:id/reset-password - Reset formateur password
  fastify.post("/admin/formateurs/:id/reset-password", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Reset formateur password",
      description: "Generate and set a new temporary password for a formateur account (admin only)",
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
              properties: {
                formateurId: { type: "string" },
                initialPassword: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);
        const { id: formateurId } = request.params as { id: string };

        const client = await (fastify.pg as any).connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
          await client.query("BEGIN");

          const formateursTable = getTableName(tenantId, "formateurs");
          const formateurResult = await client.query(
            `SELECT id, user_id, email, nom, prenom FROM ${formateursTable} WHERE id = $1 AND tenant_id = $2`,
            [formateurId, tenantId]
          );

          if (formateurResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return reply.status(404).send({
              success: false,
              error: "FORMATEUR_NOT_FOUND",
              message: "Formateur not found",
            });
          }

          const formateurRow = formateurResult.rows[0];
          let userId: string | null = formateurRow.user_id || null;
          const temporaryPassword = generatePassword();
          const passwordHash = await bcrypt.hash(temporaryPassword, 12);

          if (!userId) {
            const userLookup = await client.query(
              `SELECT id FROM users WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
              [tenantId, formateurRow.email]
            );
            userId = userLookup.rows[0]?.id || null;

            // Create the user account on the fly if it doesn't exist yet
            if (!userId) {
              const fullName = `${formateurRow.prenom || ""} ${formateurRow.nom || ""}`.trim();
              const createdUser = await client.query(
                `
                  INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash)
                  VALUES ($1, $2, $3, $4, $5, $6)
                  RETURNING id
                `,
                [
                  tenantId,
                  formateurRow.email,
                  fullName || formateurRow.email,
                  formateurRow.prenom || null,
                  formateurRow.nom || null,
                  passwordHash,
                ]
              );
              userId = createdUser.rows[0].id;
            } else {
              // User exists: refresh the password
              const updateUser = await client.query(
                `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                [passwordHash, userId, tenantId]
              );
              if (updateUser.rowCount === 0) {
                await client.query("ROLLBACK");
                return reply.status(404).send({
                  success: false,
                  error: "USER_NOT_FOUND",
                  message: "Compte utilisateur introuvable pour ce formateur",
                });
              }
            }
          } else {
            // Existing linked user: refresh the password
            const updateUser = await client.query(
              `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
              [passwordHash, userId, tenantId]
            );
            if (updateUser.rowCount === 0) {
              await client.query("ROLLBACK");
              return reply.status(404).send({
                success: false,
                error: "USER_NOT_FOUND",
                message: "Compte utilisateur introuvable pour ce formateur",
              });
            }
          }

          // Persist the latest generated password for admin display and keep link to user account
          await client.query(
            `UPDATE ${formateursTable} SET user_id = $1, initial_password = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
            [userId, temporaryPassword, formateurId, tenantId]
          );

          // Ensure role formateur is assigned
          const roleResult = await client.query(
            `SELECT id FROM roles WHERE key = 'formateur' AND COALESCE(is_active, true) = true LIMIT 1`
          );
          let roleId = roleResult.rows[0]?.id;
          if (!roleId) {
            const createdRole = await client.query(
              `INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
               VALUES ('formateur', 'Formateur', true, true, NOW(), NOW()) RETURNING id`
            );
            roleId = createdRole.rows[0].id;
          }
          await client.query(
            `INSERT INTO user_roles (tenant_id, user_id, role_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
            [tenantId, userId, roleId]
          );

          await client.query("COMMIT");
          return reply.status(200).send({
            success: true,
            data: {
              formateurId,
              initialPassword: temporaryPassword,
            },
          });
        } catch (dbError) {
          await client.query("ROLLBACK");
          throw dbError;
        } finally {
          client.release();
        }
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while resetting password",
        });
      }
    },
  });

  // GET /api/v1/admin/formateurs - List formateurs (for admin selection)
  fastify.get("/admin/formateurs", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "List formateurs",
      description: "Get list of active formateurs for session assignment (admin only)",
      querystring: {
        type: "object",
        properties: {
          search: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "array",
              items: { type: "object" },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);
        const query = request.query as any;
        const search = query.search;

        const client = await (fastify.pg as any).connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          // Get tenant-specific table name
          const formateursTable = getTableName(tenantId, 'formateurs');

          let formateursQuery = `
            SELECT id, nom, prenom, email, specialites, bio, photo_url, actif, initial_password
            FROM ${formateursTable}
            WHERE tenant_id = $1 AND actif = true
          `;
          const params: any[] = [tenantId];

          if (search) {
            formateursQuery += ` AND (
              nom ILIKE $2 OR 
              prenom ILIKE $2 OR 
              email ILIKE $2
            )`;
            params.push(`%${search}%`);
          }

          formateursQuery += ` ORDER BY nom, prenom`;

          const result = await client.query(formateursQuery, params);

          // Create plain objects directly from database rows
          const formateurs = result.rows.map((row: any) => ({
            id: row.id,
            nom: row.nom,
            prenom: row.prenom,
            email: row.email,
            specialites: row.specialites || [],
            bio: row.bio,
            photo_url: row.photo_url,
            actif: row.actif,
            initialPassword: row.initial_password || null,
          }));

          // Build response object
          const response = {
            success: true,
            data: formateurs,
          };

          // Serialize to JSON string and send directly via reply.raw to bypass Fastify's serializer
          // This ensures the exact JSON string is sent without any modification
          const jsonString = JSON.stringify(response);
          reply.type('application/json');
          reply.raw.statusCode = 200;
          reply.raw.setHeader('Content-Type', 'application/json');
          reply.raw.end(jsonString);
          reply.sent = true; // Tell Fastify that the response has been sent
          return;
        } finally {
          client.release();
        }
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        if (error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: "Admin access required",
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while fetching formateurs",
        });
      }
    },
  });

  // GET /api/v1/sessions-pro/admin/formateurs/:id - Get formateur details
  fastify.get("/admin/formateurs/:id", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Get formateur details",
      description: "Get detailed information about a specific formateur (admin only)",
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);
        const { id } = request.params as { id: string };

        const client = await (fastify.pg as any).connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          // Get tenant-specific table name
          const formateursTable = getTableName(tenantId, 'formateurs');

          const formateurQuery = `
            SELECT 
              id, 
              civilite,
              nom, 
              prenom, 
              email, 
              telephone,
              specialites, 
              bio, 
              photo_url, 
              linkedin_url,
              tarif_journalier,
              actif,
              created_at,
              updated_at
            FROM ${formateursTable}
            WHERE id = $1 AND tenant_id = $2
          `;

          const result = await client.query(formateurQuery, [id, tenantId]);

          if (result.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: "NOT_FOUND",
              message: "Formateur not found",
            });
          }

          const row = result.rows[0];
          const formateur = {
            id: row.id,
            civilite: row.civilite,
            nom: row.nom,
            prenom: row.prenom,
            email: row.email,
            telephone: row.telephone,
            specialites: row.specialites || [],
            bio: row.bio,
            photo_url: row.photo_url,
            linkedin_url: row.linkedin_url,
            tarif_journalier: row.tarif_journalier,
            actif: row.actif,
            created_at: row.created_at,
            updated_at: row.updated_at,
          };

          // Build response object
          const response = {
            success: true,
            data: formateur,
          };

          // Serialize to JSON string and send directly via reply.raw to bypass Fastify's serializer
          const jsonString = JSON.stringify(response);
          reply.type('application/json');
          reply.raw.statusCode = 200;
          reply.raw.setHeader('Content-Type', 'application/json');
          reply.raw.end(jsonString);
          reply.sent = true;
          return;
        } finally {
          client.release();
        }
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        if (error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: "Admin access required",
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while fetching formateur details",
        });
      }
    },
  });

  // PUT /api/v1/sessions-pro/admin/formateurs/:id - Update formateur
  fastify.put("/admin/formateurs/:id", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Update formateur",
      description: "Update an existing formateur (admin only)",
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
          civilite: { type: "string" },
          nom: { type: "string" },
          prenom: { type: "string" },
          email: { type: "string" },
          telephone: { type: "string" },
          specialites: {
            type: "array",
            items: { type: "string" },
          },
          bio: { type: "string" },
          linkedin_url: { type: "string" },
          tarif_journalier: { type: "number" },
          actif: { type: "boolean" },
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const client = await (fastify.pg as any).connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          // Get tenant-specific table name
          const formateursTable = getTableName(tenantId, 'formateurs');

          // Check if formateur exists
          const existingCheck = await client.query(
            `SELECT id FROM ${formateursTable} WHERE id = $1 AND tenant_id = $2`,
            [id, tenantId]
          );

          if (existingCheck.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: "NOT_FOUND",
              message: "Formateur not found",
            });
          }

          // Check if email is being changed and if it already exists for another formateur
          if (body.email) {
            const emailCheck = await client.query(
              `SELECT id FROM ${formateursTable} WHERE tenant_id = $1 AND email = $2 AND id != $3`,
              [tenantId, body.email, id]
            );

            if (emailCheck.rows.length > 0) {
              return reply.status(400).send({
                success: false,
                error: "EMAIL_EXISTS",
                message: "Un formateur avec cet email existe dÃ©jÃ ",
              });
            }
          }

          // Build update query dynamically
          const updateFields: string[] = [];
          const updateValues: any[] = [];
          let paramIndex = 1;

          if (body.civilite !== undefined) {
            updateFields.push(`civilite = $${paramIndex++}`);
            updateValues.push(body.civilite || null);
          }
          if (body.nom !== undefined) {
            updateFields.push(`nom = $${paramIndex++}`);
            updateValues.push(body.nom);
          }
          if (body.prenom !== undefined) {
            updateFields.push(`prenom = $${paramIndex++}`);
            updateValues.push(body.prenom);
          }
          if (body.email !== undefined) {
            updateFields.push(`email = $${paramIndex++}`);
            updateValues.push(body.email);
          }
          if (body.telephone !== undefined) {
            updateFields.push(`telephone = $${paramIndex++}`);
            updateValues.push(body.telephone || null);
          }
          if (body.specialites !== undefined) {
            updateFields.push(`specialites = $${paramIndex++}`);
            updateValues.push(body.specialites ? JSON.stringify(body.specialites) : null);
          }
          if (body.bio !== undefined) {
            updateFields.push(`bio = $${paramIndex++}`);
            updateValues.push(body.bio || null);
          }
          if (body.linkedin_url !== undefined) {
            updateFields.push(`linkedin_url = $${paramIndex++}`);
            updateValues.push(body.linkedin_url || null);
          }
          if (body.tarif_journalier !== undefined) {
            updateFields.push(`tarif_journalier = $${paramIndex++}`);
            updateValues.push(body.tarif_journalier || null);
          }
          if (body.actif !== undefined) {
            updateFields.push(`actif = $${paramIndex++}`);
            updateValues.push(body.actif);
          }

          if (updateFields.length === 0) {
            return reply.status(400).send({
              success: false,
              error: "NO_UPDATES",
              message: "No fields to update",
            });
          }

          // Add updated_at
          updateFields.push(`updated_at = NOW()`);
          
          // Add WHERE clause parameters
          updateValues.push(id, tenantId);

          const updateQuery = `
            UPDATE ${formateursTable}
            SET ${updateFields.join(", ")}
            WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex}
            RETURNING id, civilite, nom, prenom, email, telephone, specialites, bio,
                      linkedin_url, tarif_journalier, actif, created_at, updated_at
          `;

          const result = await client.query(updateQuery, updateValues);
          const formateur = result.rows[0];

          // Build response object
          const response = {
            success: true,
            data: {
              id: formateur.id,
              civilite: formateur.civilite,
              nom: formateur.nom,
              prenom: formateur.prenom,
              email: formateur.email,
              telephone: formateur.telephone,
              specialites: formateur.specialites || [],
              bio: formateur.bio,
              linkedin_url: formateur.linkedin_url,
              tarif_journalier: formateur.tarif_journalier,
              actif: formateur.actif,
              created_at: formateur.created_at,
              updated_at: formateur.updated_at,
            },
          };

          // Serialize to JSON string and send directly via reply.raw
          const jsonString = JSON.stringify(response);
          reply.type('application/json');
          reply.raw.statusCode = 200;
          reply.raw.setHeader('Content-Type', 'application/json');
          reply.raw.end(jsonString);
          reply.sent = true;
          return;
        } finally {
          client.release();
        }
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        if (error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: "Admin access required",
          });
        }
        if (error.code === "23505") {
          // Unique constraint violation
          return reply.status(400).send({
            success: false,
            error: "EMAIL_EXISTS",
            message: "Un formateur avec cet email existe dÃ©jÃ ",
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while updating formateur",
        });
      }
    },
  });

  // DELETE /api/v1/sessions-pro/admin/formateurs/:id - Delete formateur
  fastify.delete("/admin/formateurs/:id", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Delete formateur",
      description: "Delete a formateur (admin only)",
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);
        const { id } = request.params as { id: string };

        const client = await (fastify.pg as any).connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          // Get tenant-specific table names
          const formateursTable = getTableName(tenantId, 'formateurs');
          const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

          // Check if formateur exists
          const existingCheck = await client.query(
            `SELECT id FROM ${formateursTable} WHERE id = $1 AND tenant_id = $2`,
            [id, tenantId]
          );

          if (existingCheck.rows.length === 0) {
            return reply.status(404).send({
              success: false,
              error: "NOT_FOUND",
              message: "Formateur not found",
            });
          }

          // Check if formateur is assigned to any sessions
          const sessionsCheck = await client.query(
            `SELECT COUNT(*) as count 
             FROM ${sessionFormateursTable} 
             WHERE formateur_id = $1 
             AND tenant_id = $2`,
            [id, tenantId]
          );

          const sessionCount = parseInt(sessionsCheck.rows[0].count, 10);
          if (sessionCount > 0) {
            return reply.status(400).send({
              success: false,
              error: "FORMATEUR_IN_USE",
              message: `Le formateur est assignÃ© Ã  ${sessionCount} session(s). Veuillez d'abord retirer le formateur de ces sessions.`,
            });
          }

          // Check if formateur has marked attendance (session_attendance.marked_by has ON DELETE RESTRICT)
          // Only check if the table exists (it's created in migration 0040)
          try {
            const sessionAttendanceTable = getTableName(tenantId, 'session_attendance');
            const attendanceCheck = await client.query(
              `SELECT COUNT(*) as count 
               FROM ${sessionAttendanceTable} 
               WHERE marked_by = $1 
               AND tenant_id = $2`,
              [id, tenantId]
            );

            const attendanceCount = parseInt(attendanceCheck.rows[0].count, 10);
            if (attendanceCount > 0) {
              return reply.status(400).send({
                success: false,
                error: "FORMATEUR_HAS_ATTENDANCE",
                message: `Le formateur a marquÃ© des prÃ©sences pour ${attendanceCount} inscription(s). Impossible de supprimer ce formateur.`,
              });
            }
          } catch (tableError: any) {
            // If table doesn't exist (migration 0040 not run), skip this check
            // Error code 42P01 is "relation does not exist"
            if (tableError.code !== "42P01") {
              // If it's a different error, log it but continue
              fastify.log.warn("Error checking session_attendance table:", tableError);
            }
            // Continue with deletion if table doesn't exist
          }

          // Delete formateur (soft delete by setting actif to false, or hard delete)
          // For now, we'll do a hard delete. You can change to soft delete if needed
          await client.query(
            `DELETE FROM ${formateursTable} WHERE id = $1 AND tenant_id = $2`,
            [id, tenantId]
          );

          return reply.send({
            success: true,
            message: "Formateur supprimÃ© avec succÃ¨s",
          });
        } finally {
          client.release();
        }
      } catch (error: any) {
        fastify.log.error("Error deleting formateur:", error);
        fastify.log.error("Error details:", {
          message: error.message,
          code: error.code,
          detail: error.detail,
          constraint: error.constraint,
        });
        
        if (error.message === "TENANT_REQUIRED") {
          return reply.status(400).send({
            success: false,
            error: "TENANT_REQUIRED",
            message: "This endpoint requires tenant context",
          });
        }
        if (error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: "Admin access required",
          });
        }
        
        // Check for foreign key constraint violations
        if (error.code === "23503") {
          // Foreign key constraint violation
          let errorMessage = "Impossible de supprimer ce formateur car il est rÃ©fÃ©rencÃ© dans d'autres enregistrements.";
          if (error.detail) {
            errorMessage += ` DÃ©tails: ${error.detail}`;
          }
          return reply.status(400).send({
            success: false,
            error: "FOREIGN_KEY_VIOLATION",
            message: errorMessage,
          });
        }
        
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || error.detail || "An error occurred while deleting formateur",
        });
      }
    },
  });

  // GET /api/v1/admin/formateurs/disponibilites - Check trainer availability
  fastify.get("/admin/formateurs/disponibilites", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Check trainer availability",
      description: "Check trainer availability for a given date range",
      querystring: {
        type: "object",
        properties: {
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          formateur_ids: { type: "string" }, // Comma-separated UUIDs
        },
        required: ["date_debut", "date_fin"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                formateurs: {
                  type: "array",
                  items: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const query = request.query as any;
        const dateDebut = query.date_debut;
        const dateFin = query.date_fin;
        const formateurIds = query.formateur_ids
          ? (query.formateur_ids as string).split(",").filter((id: string) => id.trim())
          : [];

        if (!dateDebut || !dateFin) {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "date_debut and date_fin are required",
          });
        }

        // Use getFormateursDisponibilites method (T106)
        const formateurs = await availabilityService.getFormateursDisponibilites(
          tenantId,
          dateDebut,
          dateFin,
          formateurIds.length > 0 ? formateurIds : undefined
        );

        return reply.send({
          success: true,
          data: { formateurs },
        });
      } catch (error: any) {
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while checking trainer availability",
        });
      }
    },
  });

  // GET /api/v1/admin/sessions-pro/export - Export sessions to Excel
  fastify.get("/admin/sessions-pro/export", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Export sessions to Excel",
      description: "Export sessions to Excel file with filters (admin only)",
      querystring: {
        type: "object",
        properties: {
          search: { type: "string" },
          formation_id: { type: "string", format: "uuid" },
          mode: { type: "string" },
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          statut: { type: "string" },
          sort: {
            type: "string",
            enum: ["date_asc", "date_desc", "prix_asc", "prix_desc"],
          },
          session_ids: { type: "string" }, // Comma-separated UUIDs for specific sessions
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const queryParams = request.query as any;
        const query = AdminSessionListQuerySchema.parse(queryParams);

        // Parse session_ids if provided
        const sessionIds = queryParams.session_ids
          ? queryParams.session_ids.split(",").filter((id: string) => id.trim())
          : undefined;

        // Export to Excel
        const buffer = await sessionService.exportSessionsToExcel(
          tenantId,
          query,
          sessionIds
        );

        // Set response headers
        const filename = `sessions_${new Date().toISOString().split("T")[0]}.xlsx`;
        reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        reply.header("Content-Disposition", `attachment; filename="${filename}"`);
        reply.send(buffer);
      } catch (error: any) {
        fastify.log.error(error);
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }
        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: error.errors,
          });
        }
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while exporting sessions",
        });
      }
    },
  });

  // GET /api/v1/admin/sessions-pro/:id/inscrits - Get session enrollments (T088)
  fastify.get("/admin/sessions-pro/:id/inscrits", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Get session enrollments",
      description: "Get list of enrolled participants for a session with filtering",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      querystring: {
        type: "object",
        properties: {
          statut: { type: "string" }, // Comma-separated enrollment statuses
          paiement: { type: "string" }, // Comma-separated payment statuses
          search: { type: "string" }, // Search by participant name or email
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
                inscrits: { type: "array" },
                total: { type: "number" },
              },
            },
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const params = request.params as { id: string };
        const query = request.query as any;
        
        // Validate query parameters
        const validatedQuery = EnrollmentListQuerySchema.parse(query);

        const result = await sessionService.getSessionEnrollments(
          tenantId,
          params.id,
          validatedQuery
        );

        return reply.status(200).send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        console.error('[GET /admin/sessions-pro/:id/inscrits] Error:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
          code: error.code,
          detail: error.detail,
          hint: error.hint,
        });
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        if (error.message === "SESSION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Session not found",
          });
        }

        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid query parameters",
            details: error.errors,
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: error.message || "An error occurred while fetching enrollments",
          ...(process.env.NODE_ENV === 'development' && { details: error.stack }),
        });
      }
    },
  });

  // GET /api/v1/admin/sessions-pro/:id/inscrits/export - Export enrollments to Excel (T097)
  fastify.get("/admin/sessions-pro/:id/inscrits/export", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Export session enrollments to Excel",
      description: "Export enrollment list to Excel file",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      querystring: {
        type: "object",
        properties: {
          statut: { type: "string" },
          paiement: { type: "string" },
          search: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const params = request.params as { id: string };
        const query = request.query as any;
        const validatedQuery = EnrollmentListQuerySchema.parse(query);

        const buffer = await sessionService.exportEnrollmentsToExcel(
          tenantId,
          params.id,
          validatedQuery
        );

        // Get session for filename
        const session = await sessionService.getSessionById(tenantId, params.id);
        const filename = session
          ? `inscriptions-${session.code_session}-${new Date().toISOString().split("T")[0]}.xlsx`
          : `inscriptions-${params.id}.xlsx`;

        reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        reply.header("Content-Disposition", `attachment; filename="${filename}"`);
        return reply.send(buffer);
      } catch (error: any) {
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        if (error.message === "SESSION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Session not found",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while exporting enrollments",
        });
      }
    },
  });

  // GET /api/v1/admin/sessions-pro/:id/stats - Get session statistics (T099)
  fastify.get("/admin/sessions-pro/:id/stats", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Get session statistics",
      description: "Get enrollment statistics and trends for a session",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const params = request.params as { id: string };
        const stats = await sessionService.getSessionStats(tenantId, params.id);

        return reply.status(200).send({
          success: true,
          data: stats,
        });
      } catch (error: any) {
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        if (error.message === "SESSION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Session not found",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while fetching statistics",
        });
      }
    },
  });

  // POST /api/v1/admin/sessions-pro/:id/dupliquer - Duplicate session (T103)
  fastify.post("/admin/sessions-pro/:id/dupliquer", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Duplicate a session",
      description: "Duplicate an existing session with new dates",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          date_debut: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_fin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
        required: ["date_debut", "date_fin"],
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const params = request.params as { id: string };
        const body = request.body as any;
        
        // Validate request body
        const validatedBody = DuplicateSessionSchema.parse(body);

        const newSession = await sessionService.duplicateSession(
          tenantId,
          params.id,
          validatedBody.date_debut,
          validatedBody.date_fin
        );

        return reply.status(201).send({
          success: true,
          data: newSession,
        });
      } catch (error: any) {
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        if (error.message === "SESSION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Source session not found",
          });
        }

        if (error.message === "INVALID_DATE_RANGE") {
          return reply.status(400).send({
            success: false,
            error: "INVALID_DATE_RANGE",
            message: "End date must be after start date",
          });
        }

        if (error.message === "TRAINERS_NOT_AVAILABLE") {
          return reply.status(400).send({
            success: false,
            error: "TRAINERS_NOT_AVAILABLE",
            message: "One or more trainers are not available for the selected dates",
          });
        }

        if (error.name === "ZodError") {
          return reply.status(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: error.errors,
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while duplicating the session",
        });
      }
    },
  });

  // DELETE /api/v1/admin/sessions-pro/:id - Delete session (T115)
  fastify.delete("/admin/sessions-pro/:id", {
    schema: {
      tags: ["Sessions Professionnelles - Admin"],
      summary: "Delete a session",
      description: "Delete a session (soft delete if enrollments exist, hard delete otherwise)",
      params: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
        },
        required: ["id"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
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
    handler: async (request, reply) => {
      try {
        const tenantId = getTenantId(request as AuthenticatedRequest);
        requireAdmin(request as AuthenticatedRequest);

        const params = request.params as { id: string };
        await sessionService.deleteSession(tenantId, params.id);

        return reply.status(200).send({
          success: true,
          message: "Session deleted successfully",
        });
      } catch (error: any) {
        fastify.log.error(error);
        
        if (error.message === "TENANT_REQUIRED" || error.message === "AUTHENTICATION_REQUIRED" || error.message === "ADMIN_REQUIRED") {
          return reply.status(403).send({
            success: false,
            error: error.message,
            message: error.message === "ADMIN_REQUIRED" ? "Admin access required" : "Authentication required",
          });
        }

        if (error.message === "SESSION_NOT_FOUND") {
          return reply.status(404).send({
            success: false,
            error: "SESSION_NOT_FOUND",
            message: "Session not found",
          });
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: "An error occurred while deleting the session",
        });
      }
    },
  });

  fastify.log.info("Sessions Pro routes registered");
}
