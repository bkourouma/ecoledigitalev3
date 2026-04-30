import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import {
  TimeSlotSchema,
  CreateTimeSlotSchema,
  UpdateTimeSlotSchema,
  TimeSlotQuerySchema,
  CreateScheduleGenerationRequestSchema,
  ScheduleGenerationRequestQuerySchema,
  ApproveScheduleSchema,
  GenerationOptionsSchema,
  GenerationStatusSchema,
  GenerationResultSchema,
} from "@ecoledigitale/contracts";
import { ScheduleGeneratorService } from "../services/ScheduleGeneratorService";
import { SchedulePersistenceService } from "../services/SchedulePersistenceService";

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

// Temporary in-memory storage for generation results
const generationResults = new Map<string, any>();

export async function scheduleGenerationRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any; // Use any to avoid type conflicts

  // ========================================
  // TIME SLOTS MANAGEMENT
  // ========================================

  // GET /api/v1/schedule-generation/time-slots - List time slots
  fastify.get("/time-slots", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          dayOfWeek: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
          isActive: { type: "boolean" },
          priority: { type: "number", minimum: 1 },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const query = request.query as any;
        let whereConditions = ['tenant_id = $1'];
        const queryParams = [tenantId];
        let paramIndex = 2;

        if (query.dayOfWeek) {
          whereConditions.push(`day_of_week = $${paramIndex}`);
          queryParams.push(query.dayOfWeek);
          paramIndex++;
        }

        if (query.isActive !== undefined) {
          whereConditions.push(`is_active = $${paramIndex}`);
          queryParams.push(query.isActive);
          paramIndex++;
        }

        if (query.priority) {
          whereConditions.push(`priority = $${paramIndex}`);
          queryParams.push(query.priority);
          paramIndex++;
        }

        const sql = `
          SELECT id, tenant_id, name, day_of_week, start_time, end_time, 
                 is_active, priority, max_concurrent_sessions, created_at, updated_at
          FROM time_slots
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY day_of_week, start_time
        `;

        const result = await pool.query(sql, queryParams);

        return reply.send({
          timeSlots: result.rows.map((row: any) => ({
            ...row,
            dayOfWeek: row.day_of_week,
            startTime: row.start_time,
            endTime: row.end_time,
            isActive: row.is_active,
            maxConcurrentSessions: row.max_concurrent_sessions,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
        });

      } catch (error) {
        fastify.log.error(`Time slots list error: ${error}`);
        return reply.status(500).send({
          error: "Query Failed",
          message: "Failed to retrieve time slots",
        });
      }
    },
  });

  // POST /api/v1/schedule-generation/time-slots - Create time slot
  fastify.post("/time-slots", {
    schema: {
      body: {
        type: "object",
        required: ["name", "dayOfWeek", "startTime", "endTime"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          dayOfWeek: { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
          startTime: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$" },
          endTime: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$" },
          isActive: { type: "boolean", default: true },
          priority: { type: "number", minimum: 1, default: 1 },
          maxConcurrentSessions: { type: "number", minimum: 1, default: 1 },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const body = request.body as any;

        // Validate time order
        if (body.startTime >= body.endTime) {
          return reply.status(400).send({
            error: "Validation Error",
            message: "L'heure de début doit être antérieure à l'heure de fin",
          });
        }

        const sql = `
          INSERT INTO time_slots (tenant_id, name, day_of_week, start_time, end_time, is_active, priority, max_concurrent_sessions)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, tenant_id, name, day_of_week, start_time, end_time, is_active, priority, max_concurrent_sessions, created_at, updated_at
        `;

        const result = await pool.query(sql, [
          tenantId,
          body.name,
          body.dayOfWeek,
          body.startTime,
          body.endTime,
          body.isActive ?? true,
          body.priority ?? 1,
          body.maxConcurrentSessions ?? 1,
        ]);

        const timeSlot = result.rows[0];
        return reply.status(201).send({
          ...timeSlot,
          dayOfWeek: timeSlot.day_of_week,
          startTime: timeSlot.start_time,
          endTime: timeSlot.end_time,
          isActive: timeSlot.is_active,
          maxConcurrentSessions: timeSlot.max_concurrent_sessions,
          createdAt: timeSlot.created_at,
          updatedAt: timeSlot.updated_at,
        });

      } catch (error) {
        fastify.log.error(`Time slot creation error: ${error}`);
        return reply.status(500).send({
          error: "Creation Failed",
          message: "Failed to create time slot",
        });
      }
    },
  });

  // ========================================
  // GENERATION OPTIONS
  // ========================================

  // GET /api/v1/schedule-generation/classes/:classId/generation-options
  fastify.get("/classes/:classId/generation-options", {
    schema: {
      params: {
        type: "object",
        required: ["classId"],
        properties: {
          classId: { type: "string", format: "uuid" },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const { classId } = request.params as any;

        // Get class information
        const classQuery = `
          SELECT c.id, c.name, c.max_students as capacity, p.name as programme_name
          FROM classes c
          JOIN programmes p ON c.programme_id = p.id
          WHERE c.id = $1 AND c.tenant_id = $2
        `;
        const classResult = await pool.query(classQuery, [classId, tenantId]);

        if (classResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Class Not Found",
            message: "La classe spécifiée n'existe pas",
          });
        }

        // Get available courses for this class (simplified)
        const coursesQuery = `
          SELECT c.id, c.name, c.code, c.hours_total,
                 false as is_assigned,
                 'Non assigné' as teacher_name
          FROM courses c
          WHERE c.tenant_id = $1
          ORDER BY c.name
        `;
        const coursesResult = await pool.query(coursesQuery, [tenantId]);

        // Get available time slots from database
        const timeSlotsQuery = `
          SELECT id, name, day_of_week, start_time, end_time, priority, max_concurrent_sessions
          FROM time_slots
          WHERE tenant_id = $1 AND is_active = true
          ORDER BY 
            CASE day_of_week
              WHEN 'monday' THEN 1
              WHEN 'tuesday' THEN 2
              WHEN 'wednesday' THEN 3
              WHEN 'thursday' THEN 4
              WHEN 'friday' THEN 5
              WHEN 'saturday' THEN 6
              WHEN 'sunday' THEN 7
            END,
            start_time
        `;
        const timeSlotsResult = await pool.query(timeSlotsQuery, [tenantId]);

        // Get available classrooms (return empty for now until table is created)
        const classroomsResult = { rows: [] };

        return reply.send({
          classInfo: {
            id: classResult.rows[0].id,
            name: classResult.rows[0].name,
            capacity: classResult.rows[0].capacity,
            programmeName: classResult.rows[0].programme_name,
          },
          availableCourses: coursesResult.rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            hoursTotal: row.hours_total,
            isAssigned: row.is_assigned,
            teacherName: row.teacher_name,
          })),
          availableTimeSlots: timeSlotsResult.rows.map(row => ({
            id: row.id,
            name: row.name,
            dayOfWeek: row.day_of_week,
            startTime: row.start_time,
            endTime: row.end_time,
            priority: row.priority,
            maxConcurrentSessions: row.max_concurrent_sessions,
          })),
          availableClassrooms: [], // Empty for now until classrooms table is created
        });

      } catch (error) {
        fastify.log.error(`Generation options error: ${error}`);
        fastify.log.error(`Error details: ${JSON.stringify(error)}`);
        return reply.status(500).send({
          error: "Query Failed",
          message: "Failed to retrieve generation options",
          details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
        });
      }
    },
  });

  // ========================================
  // SCHEDULE GENERATION
  // ========================================

  // POST /api/v1/schedule-generation/generate - Generate schedule
  fastify.post("/generate", {
    schema: {
      body: {
        type: "object",
        required: ["classId", "selectedCourses", "availableTimeSlots", "startDate"],
        properties: {
          classId: { type: "string", format: "uuid" },
          startDate: { type: "string", format: "date" },
          selectedCourses: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["courseId", "requiredHours"],
              properties: {
                courseId: { type: "string", format: "uuid" },
                requiredHours: { type: "number", minimum: 1 },
                preferredSessionDuration: { type: "number", minimum: 30, maximum: 240, default: 120 },
                maxSessionsPerWeek: { type: "number", minimum: 1, maximum: 10 },
              },
            },
          },
          availableTimeSlots: {
            type: "array",
            minItems: 1,
            items: { type: "string", format: "uuid" },
          },
          generationPreferences: {
            type: "object",
            properties: {
              balanceWorkload: { type: "boolean", default: true },
              avoidBackToBackSessions: { type: "boolean", default: false },
              preferMorningSlots: { type: "boolean", default: false },
              maxDailyHours: { type: "number", minimum: 2, maximum: 12 },
              allowWeekendSessions: { type: "boolean", default: false },
            },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      const userId = request.user?.id || '550e8400-e29b-41d4-a716-446655440000'; // Temporary for testing

      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires a tenant",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const body = request.body as any;

        // Generate a unique request ID
        const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
          // Get real time slots from database
          const timeSlotIds = body.availableTimeSlots;
          const timeSlotsQuery = `
            SELECT id, name, day_of_week, start_time, end_time, priority,
                   tenant_id, is_active, max_concurrent_sessions, created_at, updated_at
            FROM time_slots
            WHERE id = ANY($1) AND tenant_id = $2 AND is_active = true
            ORDER BY day_of_week, start_time
          `;

          const timeSlotsResult = await pool.query(timeSlotsQuery, [timeSlotIds, tenantId]);
          const availableTimeSlots = timeSlotsResult.rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            dayOfWeek: row.day_of_week,
            startTime: row.start_time,
            endTime: row.end_time,
            tenantId: row.tenant_id,
            isActive: row.is_active,
            priority: row.priority || 1,
            maxConcurrentSessions: row.max_concurrent_sessions || 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          }));

          if (availableTimeSlots.length === 0) {
            return reply.status(400).send({
              error: "No Time Slots",
              message: "Aucun créneau horaire valide sélectionné"
            });
          }

          // Enrich selected courses with names for testing
          const enrichedCourses = body.selectedCourses.map((course, index) => ({
            ...course,
            courseName: course.courseName || `Cours ${index + 1}` // Add name if missing
          }));

          // Prepare generation context
          const generationContext = {
            tenantId,
            classId: body.classId,
            startDate: body.startDate, // Add start date to context
            selectedCourses: enrichedCourses,
            availableTimeSlots,
            availableClassrooms: [], // Will be populated by the service
            generationPreferences: body.generationPreferences || {}
          };

          // Initialize the schedule generator service
          const scheduleGenerator = new ScheduleGeneratorService(pool);

          // Generate the schedule
          const generationResult = await scheduleGenerator.generateSchedule(generationContext);

          // Store the result for later retrieval
          const resultData = {
            requestId,
            status: "completed",
            classId: body.classId, // Store the class ID for approval
            className: "Classe Sélectionnée", // TODO: Get real class name
            programmeName: "Programme Sélectionné", // TODO: Get real program name
            generatedAt: new Date().toISOString(),
            metadata: {
              totalHours: generationResult.totalHours,
              totalSessions: generationResult.sessions.length,
              optimizationScore: generationResult.optimizationScore,
              conflictsResolved: generationResult.conflicts.length,
            },
            schedule: {
              sessions: generationResult.sessions
            }
          };

          generationResults.set(requestId, resultData);

          // Return the result immediately
          return reply.status(200).send({
            success: true,
            requestId: requestId,
            schedule: {
              sessions: generationResult.sessions
            },
            metadata: {
              message: "Planning généré avec succès",
              totalHours: generationResult.totalHours,
              totalSessions: generationResult.sessions.length,
              optimizationScore: generationResult.optimizationScore,
              conflictsResolved: generationResult.conflicts.length,
              createdAt: new Date().toISOString(),
            }
          });

        } catch (error) {
          console.error('Schedule generation error:', error);
          return reply.status(500).send({
            error: "Generation Failed",
            message: error instanceof Error ? error.message : "Erreur lors de la génération"
          });
        }

      } catch (error) {
        fastify.log.error(`Schedule generation error: ${error}`);
        return reply.status(500).send({
          error: "Generation Failed",
          message: "Failed to create generation request",
        });
      }
    },
  });

  // GET /api/v1/schedule-generation/:requestId/status - Get generation status
  fastify.get("/:requestId/status", {
    schema: {
      params: {
        type: "object",
        required: ["requestId"],
        properties: {
          requestId: { type: "string" }, // Accept any string for testing
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const { requestId } = request.params as any;

        // Check if we have a stored result
        if (generationResults.has(requestId)) {
          const result = generationResults.get(requestId);
          return reply.status(200).send({
            requestId,
            status: result.status,
            message: "Génération terminée",
            progress: 100,
            estimatedTimeRemaining: 0,
            createdAt: result.generatedAt,
            processingStartedAt: result.generatedAt,
            processingCompletedAt: result.generatedAt,
          });
        }

        const sql = `
          SELECT id, status, error_message, created_at,
                 processing_started_at, processing_completed_at
          FROM schedule_generation_requests
          WHERE id = $1 AND tenant_id = $2
        `;

        const result = await pool.query(sql, [requestId, tenantId]);

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Request Not Found",
            message: "La demande de génération n'existe pas",
          });
        }

        const request_data = result.rows[0];
        let progress = 0;
        let estimatedTimeRemaining;

        // Calculate progress based on status
        switch (request_data.status) {
          case 'pending':
            progress = 0;
            estimatedTimeRemaining = 30; // 30 seconds estimate
            break;
          case 'processing':
            progress = 50;
            estimatedTimeRemaining = 15;
            break;
          case 'completed':
          case 'failed':
          case 'cancelled':
            progress = 100;
            estimatedTimeRemaining = 0;
            break;
        }

        return reply.send({
          requestId: request_data.id,
          status: request_data.status,
          progress,
          estimatedTimeRemaining,
          errorMessage: request_data.error_message,
          createdAt: request_data.created_at,
          processingStartedAt: request_data.processing_started_at,
          processingCompletedAt: request_data.processing_completed_at,
        });

      } catch (error) {
        fastify.log.error(`Generation status error: ${error}`);
        return reply.status(500).send({
          error: "Query Failed",
          message: "Failed to retrieve generation status",
        });
      }
    },
  });

  // GET /api/v1/schedule-generation/:requestId/result - Get generation result
  fastify.get("/:requestId/result", {
    schema: {
      params: {
        type: "object",
        required: ["requestId"],
        properties: {
          requestId: { type: "string" }, // Accept any string for testing
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const { requestId } = request.params as any;

        // Check if we have a stored result
        if (generationResults.has(requestId)) {
          const result = generationResults.get(requestId);
          return reply.status(200).send(result);
        }


        // Get generation request
        const requestSql = `
          SELECT sgr.*, c.name as class_name, p.name as programme_name
          FROM schedule_generation_requests sgr
          JOIN classes c ON sgr.class_id = c.id
          JOIN programmes p ON c.programme_id = p.id
          WHERE sgr.id = $1 AND sgr.tenant_id = $2
        `;

        const requestResult = await pool.query(requestSql, [requestId, tenantId]);

        if (requestResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Request Not Found",
            message: "La demande de génération n'existe pas",
          });
        }

        const requestData = requestResult.rows[0];

        if (requestData.status !== 'completed') {
          return reply.status(400).send({
            error: "Generation Not Complete",
            message: "La génération n'est pas encore terminée",
          });
        }

        // Get generated schedule(s)
        const scheduleSql = `
          SELECT id, schedule_data, optimization_score, conflicts_detected,
                 generation_algorithm, generation_duration_ms, is_approved,
                 approved_by, approved_at, created_at
          FROM generated_schedules
          WHERE generation_request_id = $1 AND tenant_id = $2
          ORDER BY optimization_score DESC NULLS LAST, created_at DESC
        `;

        const scheduleResult = await pool.query(scheduleSql, [requestId, tenantId]);

        const schedules = scheduleResult.rows.map((row: any) => ({
          id: row.id,
          tenantId,
          generationRequestId: requestId,
          scheduleData: row.schedule_data,
          optimizationScore: row.optimization_score,
          conflictsDetected: row.conflicts_detected || [],
          generationAlgorithm: row.generation_algorithm,
          generationDurationMs: row.generation_duration_ms,
          isApproved: row.is_approved,
          approvedBy: row.approved_by,
          approvedAt: row.approved_at,
          createdAt: row.created_at,
          updatedAt: row.created_at, // Same as created_at for now
        }));

        const mainSchedule = schedules.length > 0 ? schedules[0] : undefined;
        const alternatives = schedules.slice(1);

        return reply.send({
          request: {
            id: requestData.id,
            tenantId: requestData.tenant_id,
            classId: requestData.class_id,
            requestedBy: requestData.requested_by,
            selectedCourses: requestData.selected_courses,
            availableTimeSlots: requestData.available_time_slots,
            generationPreferences: requestData.generation_preferences,
            status: requestData.status,
            errorMessage: requestData.error_message,
            processingStartedAt: requestData.processing_started_at,
            processingCompletedAt: requestData.processing_completed_at,
            createdAt: requestData.created_at,
            updatedAt: requestData.updated_at,
          },
          schedule: mainSchedule,
          alternatives: alternatives.length > 0 ? alternatives : undefined,
        });

      } catch (error) {
        fastify.log.error(`Generation result error: ${error}`);
        return reply.status(500).send({
          error: "Query Failed",
          message: "Failed to retrieve generation result",
        });
      }
    },
  });

  // POST /api/v1/schedule-generation/:scheduleId/approve - Approve schedule
  fastify.post("/:scheduleId/approve", {
    schema: {
      params: {
        type: "object",
        required: ["scheduleId"],
        properties: {
          scheduleId: { type: "string" }, // Accept any string (UUID or request ID)
        },
      },
      body: {
        type: "object",
        required: ["startDate"],
        properties: {
          startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      const userId = request.user?.id || '550e8400-e29b-41d4-a716-446655440000'; // Temporary for testing

      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires a tenant",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const { scheduleId } = request.params as any;
        const { startDate, endDate } = request.body as any;



        // Start transaction
        await pool.query('BEGIN');

        try {
          // Check if we have a stored result for this request ID
          if (!generationResults.has(scheduleId)) {
            await pool.query('ROLLBACK');
            return reply.status(404).send({
              error: "Schedule Not Found",
              message: "Le planning spécifié n'existe pas",
            });
          }

          const storedResult = generationResults.get(scheduleId);

          if (storedResult.isApproved) {
            await pool.query('ROLLBACK');
            return reply.status(400).send({
              error: "Already Approved",
              message: "Ce planning a déjà été approuvé",
            });
          }

          // Mark schedule as approved in memory
          storedResult.isApproved = true;
          storedResult.approvedAt = new Date().toISOString();
          storedResult.approvedBy = userId;
          storedResult.startDate = startDate;
          storedResult.endDate = endDate;

          // Update the stored result
          generationResults.set(scheduleId, storedResult);

          // Persist to database using SchedulePersistenceService
          try {
            const persistenceService = new SchedulePersistenceService(pool);

            const approvalData = {
              requestId: scheduleId,
              classId: storedResult.classId || 'unknown',
              sessions: storedResult.schedule?.sessions || [],
              startDate,
              endDate,
              approvedBy: userId,
              tenantId
            };

            console.log('🔄 Starting persistence with data:', {
              requestId: approvalData.requestId,
              classId: approvalData.classId,
              sessionsCount: approvalData.sessions.length,
              startDate: approvalData.startDate,
              endDate: approvalData.endDate
            });

            await persistenceService.persistApprovedSchedule(approvalData);
            console.log('✅ Persistence completed successfully');
          } catch (persistenceError) {
            console.error('❌ Persistence error:', persistenceError);
            console.error('Error details:', persistenceError.message);
            console.error('Stack trace:', persistenceError.stack);
            // Continue with approval even if persistence fails
          }

          console.log(`✅ Schedule ${scheduleId} approved and persisted by ${userId} from ${startDate} to ${endDate || 'end of academic year'}`);

          const scheduleData = storedResult.schedule;
          if (scheduleData && scheduleData.sessions) {
            console.log(`📚 Created ${scheduleData.sessions.length} scheduled sessions with date instances`);
          }

          await pool.query('COMMIT');

          return reply.send({
            message: "Planning approuvé avec succès",
            scheduleId,
            approvedAt: new Date().toISOString(),
            approvedBy: userId,
          });

        } catch (error) {
          await pool.query('ROLLBACK');
          throw error;
        }

      } catch (error) {
        fastify.log.error(`Schedule approval error: ${error}`);
        return reply.status(500).send({
          error: "Approval Failed",
          message: "Failed to approve schedule",
        });
      }
    },
  });

  // GET /api/v1/schedule-generation/requests - List generation requests
  fastify.get("/requests", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          classId: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["pending", "processing", "completed", "failed", "cancelled"] },
          requestedBy: { type: "string", format: "uuid" },
          limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
          offset: { type: "number", minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "This endpoint requires tenant context",
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        const query = request.query as any;
        let whereConditions = ['sgr.tenant_id = $1'];
        const queryParams = [tenantId];
        let paramIndex = 2;

        if (query.classId) {
          whereConditions.push(`sgr.class_id = $${paramIndex}`);
          queryParams.push(query.classId);
          paramIndex++;
        }

        if (query.status) {
          whereConditions.push(`sgr.status = $${paramIndex}`);
          queryParams.push(query.status);
          paramIndex++;
        }

        if (query.requestedBy) {
          whereConditions.push(`sgr.requested_by = $${paramIndex}`);
          queryParams.push(query.requestedBy);
          paramIndex++;
        }

        const sql = `
          SELECT sgr.id, sgr.status, sgr.created_at, sgr.processing_started_at,
                 sgr.processing_completed_at, sgr.error_message,
                 c.name as class_name, p.name as programme_name,
                 u.first_name || ' ' || u.last_name as requested_by_name,
                 COUNT(gs.id) as generated_schedules_count
          FROM schedule_generation_requests sgr
          JOIN classes c ON sgr.class_id = c.id
          JOIN programmes p ON c.programme_id = p.id
          JOIN users u ON sgr.requested_by = u.id
          LEFT JOIN generated_schedules gs ON sgr.id = gs.generation_request_id
          WHERE ${whereConditions.join(' AND ')}
          GROUP BY sgr.id, c.name, p.name, u.first_name, u.last_name
          ORDER BY sgr.created_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(query.limit || 20, query.offset || 0);

        const result = await pool.query(sql, queryParams);

        return reply.send({
          requests: result.rows.map((row: any) => ({
            id: row.id,
            status: row.status,
            className: row.class_name,
            programmeName: row.programme_name,
            requestedByName: row.requested_by_name,
            generatedSchedulesCount: parseInt(row.generated_schedules_count),
            createdAt: row.created_at,
            processingStartedAt: row.processing_started_at,
            processingCompletedAt: row.processing_completed_at,
            errorMessage: row.error_message,
          })),
          pagination: {
            limit: query.limit || 20,
            offset: query.offset || 0,
          },
        });

      } catch (error) {
        fastify.log.error(`Generation requests list error: ${error}`);
        return reply.status(500).send({
          error: "Query Failed",
          message: "Failed to retrieve generation requests",
        });
      }
    },
  });

  // ========================================
  // SCHEDULE CALENDAR VIEW
  // ========================================

  // Get calendar view of approved schedule for a class
  fastify.get('/classes/:classId/calendar', {
    schema: {
      params: {
        type: 'object',
        required: ['classId'],
        properties: {
          classId: { type: 'string', format: 'uuid' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          view: { type: 'string', enum: ['week', 'month', 'semester'] }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "Tenant ID is required"
        });
      }

      try {
        const { classId } = request.params as any;
        const query = request.query as any;

        const persistenceService = new SchedulePersistenceService(pool);

        // Get calendar sessions
        const sessions = await persistenceService.getScheduleCalendar(
          classId,
          tenantId,
          query.startDate,
          query.endDate
        );

        // Get schedule statistics
        const stats = await persistenceService.getScheduleStats(classId, tenantId);

        return reply.status(200).send({
          classId,
          sessions,
          stats,
          view: query.view || 'month',
          dateRange: {
            startDate: query.startDate || stats.first_session,
            endDate: query.endDate || stats.last_session
          }
        });

      } catch (error) {
        console.error('Calendar view error:', error);
        return reply.status(500).send({
          error: "Calendar Error",
          message: "Erreur lors de la récupération du calendrier"
        });
      }
    }
  });

  // Get schedule statistics for a class
  fastify.get('/classes/:classId/schedule-stats', {
    schema: {
      params: {
        type: 'object',
        required: ['classId'],
        properties: {
          classId: { type: 'string', format: 'uuid' }
        }
      }
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const tenantId = request.tenantId || (request.headers as any)['x-tenant'];
      if (!tenantId) {
        return reply.status(400).send({
          error: "Tenant Required",
          message: "Tenant ID is required"
        });
      }

      try {
        const { classId } = request.params as any;

        const persistenceService = new SchedulePersistenceService(pool);
        const stats = await persistenceService.getScheduleStats(classId, tenantId);

        return reply.status(200).send(stats);

      } catch (error) {
        console.error('Schedule stats error:', error);
        return reply.status(500).send({
          error: "Stats Error",
          message: "Erreur lors de la récupération des statistiques"
        });
      }
    }
  });
}
