/**
 * RSO Activities Routes
 * Handles activity consultation (read-only for PFSO agents)
 * 
 * Note: This is a placeholder implementation for Phase 1.
 * Full functionality will be available in Phase 3 (Activity Management).
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  listActivities, 
  getActivityById, 
  getActivityTypes,
  createActivity,
  updateActivity,
  deleteActivity,
  CreateRSOActivityRequest,
  UpdateRSOActivityRequest,
} from '../../services/rso/activity.service';
import {
  createActivitySchema,
  updateActivitySchema,
  listActivitiesQuerySchema,
} from '../../schemas/rso/activity.schemas';

// Minimal interfaces for RSO user (Phase 021 removed, keeping minimal compatibility)
interface RSOUser {
  id: number;
  role: string;
  installationId?: number | null;
}

interface RSOModuleRequest extends FastifyRequest {
  rsoUser?: RSOUser;
}

// Stub functions for removed permission and logging services
function checkPermission(role: string, module: string, action: string): boolean {
  // Simplified permission check - allow all roles for now
  // Original permission system was removed with Phase 021
  return true;
}

async function logActivity(server: FastifyInstance, logData: any): Promise<void> {
  // Stub function - activity logging was removed with Phase 021
  // Logs are no longer recorded
  return Promise.resolve();
}

/**
 * GET /api/v1/rso/activities
 * List activities with filters (read-only for PFSO)
 */
async function listActivitiesHandler(
  request: RSOModuleRequest,
  reply: FastifyReply
) {
  const user = request.rsoUser!;
  const tenantId = (request as any).tenantId;

  // Check permission (PFSO agents can read activities)
  if (!checkPermission(user.role, 'gestion_activites', 'read')) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Vous n\'avez pas la permission de consulter les activités',
    });
  }

  // For PFSO agents, enforce installation restriction
  const userInstallationId = user.installationId || undefined;

  // Validate query parameters
  const queryValidation = listActivitiesQuerySchema.safeParse(request.query);
  if (!queryValidation.success) {
    return reply.status(400).send({
      error: 'Validation Error',
      message: 'Paramètres de requête invalides',
      details: queryValidation.error.errors,
    });
  }

  const queryData = queryValidation.data;
  const filters = {
    installationId: queryData.installationId || userInstallationId, // PFSO agents see only their installation
    year: queryData.year,
    type: queryData.type,
    statut: queryData.statut,
    page: queryData.page,
    limit: queryData.limit,
  };

  try {
    const result = await listActivities(
      request.server,
      tenantId,
      filters,
      userInstallationId
    );

    // Log activity
    await logActivity(request.server, {
      userId: user.id,
      action: 'view_activities',
      entityType: 'activite',
      description: `Consultation des activités (filtres: ${JSON.stringify(filters)})`,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send(result);
  } catch (error: any) {
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message || 'Erreur lors de la récupération des activités',
    });
  }
}

/**
 * GET /api/v1/rso/activities/:id
 * Get activity by ID (read-only for PFSO)
 */
async function getActivityHandler(
  request: FastifyRequest<{ Params: { id: string } }> & RSOModuleRequest,
  reply: FastifyReply
) {
  const user = request.rsoUser!;
  const tenantId = (request as any).tenantId;
  const activityId = parseInt(request.params.id, 10);

  if (isNaN(activityId)) {
    return reply.status(400).send({
      error: 'Invalid Activity ID',
      message: 'L\'ID activité doit être un nombre',
    });
  }

  // Check permission
  if (!checkPermission(user.role, 'gestion_activites', 'read')) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Vous n\'avez pas la permission de consulter les activités',
    });
  }

  // For PFSO agents, enforce installation restriction
  const userInstallationId = user.installationId || undefined;

  try {
    const activity = await getActivityById(
      request.server,
      tenantId,
      activityId,
      userInstallationId
    );

    if (!activity) {
      return reply.status(404).send({
        error: 'Activity Not Found',
        message: 'Activité non trouvée ou vous n\'avez pas la permission d\'y accéder',
      });
    }

    // Log activity
    await logActivity(request.server, {
      userId: user.id,
      action: 'view_activity',
      entityType: 'activite',
      entityId: activityId,
      description: `Consultation de l'activité: ${activity.titre}`,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send(activity);
  } catch (error: any) {
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message || 'Erreur lors de la récupération de l\'activité',
    });
  }
}

/**
 * GET /api/v1/rso/activities/types
 * Get list of activity types (for dropdown)
 */
async function getActivityTypesHandler(
  request: RSOModuleRequest,
  reply: FastifyReply
) {
  const user = request.rsoUser!;

  // Check permission
  if (!checkPermission(user.role, 'gestion_activites', 'read')) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Vous n\'avez pas la permission de consulter les activités',
    });
  }

  try {
    const types = getActivityTypes();
    return reply.send({ types });
  } catch (error: any) {
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message || 'Erreur lors de la récupération des types d\'activités',
    });
  }
}

/**
 * POST /api/v1/rso/activities/:id/log-download
 * Log download report activity
 */
async function logDownloadHandler(
  request: FastifyRequest<{ Params: { id: string } }> & RSOModuleRequest,
  reply: FastifyReply
) {
  const user = request.rsoUser!;
  const activityId = parseInt(request.params.id, 10);

  if (isNaN(activityId)) {
    return reply.status(400).send({
      error: 'Invalid Activity ID',
      message: 'L\'ID activité doit être un nombre',
    });
  }

  // Check permission
  if (!checkPermission(user.role, 'gestion_activites', 'read')) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Vous n\'avez pas la permission de consulter les activités',
    });
  }

  try {
    // Log activity
    await logActivity(request.server, {
      userId: user.id,
      action: 'download_report',
      entityType: 'activite',
      entityId: activityId,
      description: `Téléchargement du rapport de l'activité #${activityId}`,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.status(204).send();
  } catch (error: any) {
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message || 'Erreur lors de l\'enregistrement de l\'activité',
    });
  }
}

/**
 * POST /api/v1/rso/activities/:id/log-print
 * Log print report activity
 */
async function logPrintHandler(
  request: FastifyRequest<{ Params: { id: string } }> & RSOModuleRequest,
  reply: FastifyReply
) {
  const user = request.rsoUser!;
  const activityId = parseInt(request.params.id, 10);

  if (isNaN(activityId)) {
    return reply.status(400).send({
      error: 'Invalid Activity ID',
      message: 'L\'ID activité doit être un nombre',
    });
  }

  // Check permission
  if (!checkPermission(user.role, 'gestion_activites', 'read')) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Vous n\'avez pas la permission de consulter les activités',
    });
  }

  try {
    // Log activity
    await logActivity(request.server, {
      userId: user.id,
      action: 'print_report',
      entityType: 'activite',
      entityId: activityId,
      description: `Impression du rapport de l'activité #${activityId}`,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.status(204).send();
  } catch (error: any) {
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message || 'Erreur lors de l\'enregistrement de l\'activité',
    });
  }
}

/**
 * POST /api/v1/rso/activities
 * Create a new activity
 */
async function createActivityHandler(
  request: FastifyRequest<{ Body: CreateRSOActivityRequest }> & RSOModuleRequest,
  reply: FastifyReply
) {
  const user = request.rsoUser!;
  const tenantId = (request as any).tenantId;

  // Check permission (only formateurs and admins can create)
  if (!checkPermission(user.role, 'gestion_activites', 'create')) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Vous n\'avez pas la permission de créer des activités',
    });
  }

  // Validate request body
  const validation = createActivitySchema.safeParse(request.body);
  if (!validation.success) {
    return reply.status(400).send({
      error: 'Validation Error',
      message: 'Données invalides',
      details: validation.error.errors,
    });
  }

  const validatedData = validation.data;

  try {
    const activity = await createActivity(
      request.server,
      tenantId,
      validatedData,
      user.id
    );

    // Log activity
    await logActivity(request.server, {
      userId: user.id,
      action: 'create_activity',
      entityType: 'activite',
      entityId: activity.id,
      description: `Création de l'activité: ${activity.titre}`,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.status(201).send(activity);
  } catch (error: any) {
    console.error('[createActivityHandler] Error:', error);
    const errorMessage = error.message || 'Erreur lors de la création de l\'activité';
    const statusCode = error.code === '23503' ? 400 : 500; // 400 for foreign key violations
    
    return reply.status(statusCode).send({
      error: statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
      message: errorMessage,
    });
  }
}

/**
 * PUT /api/v1/rso/activities/:id
 * Update an existing activity
 */
async function updateActivityHandler(
  request: FastifyRequest<{ 
    Params: { id: string };
    Body: UpdateRSOActivityRequest;
  }> & RSOModuleRequest,
  reply: FastifyReply
) {
  const user = request.rsoUser!;
  const tenantId = (request as any).tenantId;
  const activityId = parseInt(request.params.id, 10);

  if (isNaN(activityId)) {
    return reply.status(400).send({
      error: 'Invalid Activity ID',
      message: 'L\'ID activité doit être un nombre',
    });
  }

  // Check permission
  if (!checkPermission(user.role, 'gestion_activites', 'update')) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Vous n\'avez pas la permission de modifier des activités',
    });
  }

  // For PFSO agents, enforce installation restriction
  const userInstallationId = user.role === 'agent_pfso' ? user.installationId : undefined;

  try {
    const activity = await updateActivity(
      request.server,
      tenantId,
      activityId,
      request.body,
      userInstallationId
    );

    if (!activity) {
      return reply.status(404).send({
        error: 'Activity Not Found',
        message: 'Activité non trouvée ou vous n\'avez pas la permission de la modifier',
      });
    }

    // Log activity
    await logActivity(request.server, {
      userId: user.id,
      action: 'update_activity',
      entityType: 'activite',
      entityId: activityId,
      description: `Modification de l'activité: ${activity.titre}`,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send(activity);
  } catch (error: any) {
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message || 'Erreur lors de la modification de l\'activité',
    });
  }
}

/**
 * DELETE /api/v1/rso/activities/:id
 * Delete an activity
 */
async function deleteActivityHandler(
  request: FastifyRequest<{ Params: { id: string } }> & RSOModuleRequest,
  reply: FastifyReply
) {
  const user = request.rsoUser!;
  const tenantId = (request as any).tenantId;
  const activityId = parseInt(request.params.id, 10);

  if (isNaN(activityId)) {
    return reply.status(400).send({
      error: 'Invalid Activity ID',
      message: 'L\'ID activité doit être un nombre',
    });
  }

  // Check permission
  if (!checkPermission(user.role, 'gestion_activites', 'delete')) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Vous n\'avez pas la permission de supprimer des activités',
    });
  }

  // For PFSO agents, enforce installation restriction
  const userInstallationId = user.role === 'agent_pfso' ? user.installationId : undefined;

  try {
    // Get activity details before deletion for logging
    const activity = await getActivityById(
      request.server,
      tenantId,
      activityId,
      userInstallationId
    );

    if (!activity) {
      return reply.status(404).send({
        error: 'Activity Not Found',
        message: 'Activité non trouvée ou vous n\'avez pas la permission de la supprimer',
      });
    }

    const deleted = await deleteActivity(
      request.server,
      tenantId,
      activityId,
      userInstallationId
    );

    if (!deleted) {
      return reply.status(404).send({
        error: 'Activity Not Found',
        message: 'Activité non trouvée',
      });
    }

    // Log activity
    await logActivity(request.server, {
      userId: user.id,
      action: 'delete_activity',
      entityType: 'activite',
      entityId: activityId,
      description: `Suppression de l'activité: ${activity.titre}`,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.status(204).send();
  } catch (error: any) {
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message || 'Erreur lors de la suppression de l\'activité',
    });
  }
}

export async function rsoActivityRoutes(fastify: FastifyInstance) {
  // Get activity types (must be before /activities/:id to avoid route conflict)
  fastify.get('/activities/types', getActivityTypesHandler);

  // List activities
  fastify.get('/activities', listActivitiesHandler);

  // Get activity by ID
  fastify.get('/activities/:id', getActivityHandler);

  // Create activity
  fastify.post('/activities', createActivityHandler);

  // Update activity
  fastify.put('/activities/:id', updateActivityHandler);

  // Delete activity
  fastify.delete('/activities/:id', deleteActivityHandler);

  // Log download
  fastify.post('/activities/:id/log-download', logDownloadHandler);

  // Log print
  fastify.post('/activities/:id/log-print', logPrintHandler);

  // Download PDF report
  fastify.get('/activities/:id/pdf', async (
    request: FastifyRequest<{ Params: { id: string } }> & RSOModuleRequest,
    reply: FastifyReply
  ) => {
    const user = request.rsoUser!;
    const tenantId = (request as any).tenantId;
    const activityId = parseInt(request.params.id, 10);

    if (isNaN(activityId)) {
      return reply.status(400).send({
        error: 'Invalid Activity ID',
        message: 'L\'ID activité doit être un nombre',
      });
    }

    // Check permission
    if (!checkPermission(user.role, 'gestion_activites', 'read')) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Vous n\'avez pas la permission de consulter les activités',
      });
    }

    // For PFSO agents, enforce installation restriction
    const userInstallationId = user.role === 'agent_pfso' ? user.installationId : undefined;

    try {
      const activity = await getActivityById(
        request.server,
        tenantId,
        activityId,
        userInstallationId
      );

      if (!activity) {
        return reply.status(404).send({
          error: 'Activity Not Found',
          message: 'Activité non trouvée ou vous n\'avez pas la permission d\'y accéder',
        });
      }

      // Generate PDF
      const pdfService = new RSOActivityPDFService();
      try {
        const pdfBuffer = await pdfService.generateActivityPDF(activity);

        // Log activity
        await logActivity(request.server, {
          userId: user.id,
          action: 'download_report',
          entityType: 'activite',
          entityId: activityId,
          description: `Téléchargement du rapport PDF de l'activité: ${activity.titre}`,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });

        // Set headers for PDF download
        reply.header('Content-Type', 'application/pdf');
        reply.header(
          'Content-Disposition',
          `attachment; filename="rapport-activite-${activity.id}-${activity.titre.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf"`
        );

        return reply.send(pdfBuffer);
      } finally {
        await pdfService.close();
      }
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Erreur lors de la génération du rapport PDF',
      });
    }
  });
}

