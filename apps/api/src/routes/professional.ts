import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import {
  CreateProfessionalEcueSchema,
  UpdateProfessionalEcueSchema,
  CreateProfessionalUeSchema,
  UpdateProfessionalUeSchema,
  ProfessionalUeEcueInputSchema,
  UpdateProfessionalUeEcueSchema,
  SetProfessionalUePrerequisitesSchema,
  CreateProfessionalUeSessionSchema,
  UpdateProfessionalUeSessionSchema,
  ProfessionalUeSessionStatusTransitionSchema,
  CreateProfessionalSemestreSchema,
  CreateProfessionalSemestresBatchSchema,
  CreateSessionsBySemestreSchema,
  ReopenSessionsSchema,
  CreateEmploiTempsSlotSchema,
  UpdateEmploiTempsSlotSchema,
  UpdateProfessionalSemestreSchema,
  CreateProfessionalCoursePlanningSchema,
  UpdateProfessionalCoursePlanningSchema,
  CreateProfessionalEcueSeanceSchema,
  UpdateProfessionalEcueSeanceSchema,
  SetSessionEcueTeacherSchema,
  MarkProfessionalAttendanceSchema,
  ValidateProfessionalEcueResultSchema,
  CreateEcueManualNoteSchema,
  UpdateEcueManualNoteSchema,
  ProfessionalCartItemSchema,
  AdminEnrollStudentSchema,
  AdminEnrollBulkSchema,
  AdminUpdateEnrollmentSchema,
  AdminRecordPaymentSchema,
  AdminRecordStudentPaymentSchema,
  EnrollmentIdsSchema,
  CreateProfessionalPaymentSchema,
  DiplomaCreateInputSchema,
  DiplomaUpdateInputSchema,
  DiplomaRequirementsReplaceInputSchema,
  DiplomaAwardManualInputSchema,
  DiplomaRevokeInputSchema,
} from "@ecoledigitale/contracts";
import { ProfessionalCatalogService } from "../services/professional-catalog.service";
import { ProfessionalUeService } from "../services/professional-ue.service";
import { ProfessionalSemestreService } from "../services/professional-semestre.service";
import { ProfessionalEmploiTempsService } from "../services/professional-emploi-temps.service";
import { ProfessionalPlanningService } from "../services/professional-planning.service";
import { ProfessionalResultsService } from "../services/professional-results.service";
import { ProfessionalBulletinService } from "../services/professional-bulletin.service";
import { ProfessionalEnrollmentService } from "../services/professional-enrollment.service";
import { ProfessionalPaymentService } from "../services/professional-payment.service";
import { ProfessionalTeacherService } from "../services/professional-teacher.service";
import { ProfessionalDiplomasService } from "../services/professional-diplomas.service";
import {
  ProfessionalEcueMaterialsService,
  type MaterialKind,
} from "../services/professional-ecue-materials.service";
import {
  ProfessionalAssignmentsService,
  type CreateAssignmentInput,
  type UpdateAssignmentInput,
} from "../services/professional-assignments.service";
import { ProfessionalLiveSessionsService } from "../services/professional-live-sessions.service";
import type { ServiceResult } from "../services/professional-base.service";
import {
  requireAdmin,
  requireStudent,
  requireParent,
  requireAdminOrTeacher,
  requireTeacher,
} from "../middlewares/professional-guards";

/**
 * Routes du Module Professionnel — Filière → UE → ECUE (feature 030).
 *
 * Enregistré dans src/index.ts avec le préfixe `/api/v1/professional`,
 * APRÈS `authMiddleware`. UE = administratif (prix/UV/cohortes/inscription/
 * diplôme), ECUE = pédagogique (supports/devoirs/séances/présence).
 */

const ERROR_STATUS: Record<string, number> = {
  TENANT_REQUIRED: 400,
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  DUPLICATE_CODE: 409,
  // ECUE / UE
  ECUE_NOT_FOUND: 404,
  ECUE_STILL_LINKED: 409,
  ECUE_NOT_IN_UE: 422,
  UE_NOT_FOUND: 404,
  UE_INACTIVE: 409,
  UE_HAS_ENROLLMENTS: 409,
  UE_ECUE_LINK_EXISTS: 409,
  UE_ECUE_LINK_NOT_FOUND: 404,
  UE_PREREQ_NOT_SAME_FILIERE: 422,
  UE_PREREQ_CYCLE: 422,
  UE_PREREQ_NOT_VALIDATED: 422,
  UE_SESSION_NOT_FOUND: 404,
  SESSION_ECUE_TEACHERS_MISSING: 422,
  // Semestre
  SEMESTRE_NOT_FOUND: 404,
  FILIERE_NOT_FOUND: 404,
  SEMESTRE_SESSIONS_INVALID: 422,
  DUPLICATE_SEMESTRE: 409,
  // Planning des cours
  PLANNING_NOT_FOUND: 404,
  SESSION_NOT_OPEN: 422,
  ECUE_NOT_IN_SESSION: 422,
  SEANCE_NOT_FOUND: 404,
  ECUE_RESULT_NOT_FOUND: 404,
  SESSION_HAS_ENROLLMENTS: 409,
  INVALID_TRANSITION: 422,
  FORBIDDEN: 403,
  SESSION_NOT_ENROLLABLE: 422,
  SESSION_FULL: 409,
  DUPLICATE_ENROLLMENT: 409,
  ALREADY_PAID: 409,
  INVALID_ORDER_STATE: 409,
  // Diplômes professionnels
  DIPLOMA_NOT_FOUND: 404,
  DUPLICATE_DIPLOMA_CODE: 409,
  DIPLOMA_UE_NOT_SAME_FILIERE: 422,
  DIPLOMA_HAS_AWARDS: 409,
  DIPLOMA_ALREADY_AWARDED: 409,
  DIPLOMA_NOT_ELIGIBLE: 422,
  DIPLOMA_NOT_AWARDED: 404,
  LIVEKIT_NOT_CONFIGURED: 503,
  LIVEKIT_UPSTREAM_ERROR: 502,
  FILE_TOO_LARGE: 413,
  ALREADY_SUBMITTED: 409,
  INTERNAL_ERROR: 500,
};

function statusFor(code: string): number {
  return ERROR_STATUS[code] ?? 400;
}

function sendResult(reply: FastifyReply, result: ServiceResult<unknown>, successStatus = 200) {
  if (!result.success) {
    const failure = result as { error: string };
    return reply.status(statusFor(failure.error)).send(result);
  }
  return reply.status(successStatus).send(result);
}

/** Enveloppe un handler : capture les erreurs inattendues → 500 normalisé. */
function handler(fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn(request, reply);
    } catch (error: any) {
      request.log?.error?.(error);
      return reply.status(500).send({
        success: false,
        error: "INTERNAL_ERROR",
        message: error?.message ?? "Erreur interne du serveur.",
      });
    }
  };
}

/** Id `users` de l'utilisateur authentifié (peuplé par authMiddleware). */
function currentUserId(request: FastifyRequest): string {
  return ((request as any).user?.id as string) ?? "";
}

export async function professionalRoutes(fastify: FastifyInstance): Promise<void> {
  const catalog = new ProfessionalCatalogService(fastify.pg as any);
  const ue = new ProfessionalUeService(fastify.pg as any);
  const semestre = new ProfessionalSemestreService(fastify.pg as any);
  const emploiTemps = new ProfessionalEmploiTempsService(fastify.pg as any);
  const planning = new ProfessionalPlanningService(fastify.pg as any);
  const results = new ProfessionalResultsService(fastify.pg as any);
  const bulletin = new ProfessionalBulletinService(fastify.pg as any);
  const enrollment = new ProfessionalEnrollmentService(fastify.pg as any);
  const payment = new ProfessionalPaymentService(fastify.pg as any);
  const teacher = new ProfessionalTeacherService(fastify.pg as any);
  const diplomas = new ProfessionalDiplomasService(fastify.pg as any);
  const ecueMaterials = new ProfessionalEcueMaterialsService(fastify.pg as any);
  const assignments = new ProfessionalAssignmentsService(fastify.pg as any);
  const profLive = new ProfessionalLiveSessionsService(fastify.pg as any);

  function isAdminRequest(request: FastifyRequest): boolean {
    const roles: string[] = ((request as any).user?.roles ?? []).map((r: string) =>
      String(r).toLowerCase()
    );
    return roles.some((r) => ["admin", "super_admin", "administrateur"].includes(r));
  }

  // Sonde de disponibilité du module.
  fastify.get("/_health", async () => ({
    success: true,
    data: { module: "professional", status: "ok" },
  }));

  /* ===================== ECUE (référentiel pédagogique, admin) ===================== */

  fastify.get(
    "/ecue",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const result = await catalog.listEcue(request.tenantId as string, {
        statut: q.statut,
        q: q.q,
        page: q.page ? Number(q.page) : undefined,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      });
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/ecue",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateProfessionalEcueSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données d'ECUE invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await catalog.createEcue(request.tenantId as string, parsed.data);
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/ecue/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await catalog.getEcue(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/ecue/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateProfessionalEcueSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données d'ECUE invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await catalog.updateEcue(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/ecue/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await catalog.deleteEcue(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  /* ===================== UE (référentiel administratif, admin) ===================== */

  fastify.get(
    "/ue",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const result = await ue.listUe(request.tenantId as string, {
        filiere_id: q.filiere_id,
        statut: q.statut,
        q: q.q,
        page: q.page ? Number(q.page) : undefined,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      });
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/ue",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateProfessionalUeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données d'UE invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.createUe(
        request.tenantId as string,
        parsed.data,
        currentUserId(request) || undefined
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/ue/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.getUe(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/ue/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateProfessionalUeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données d'UE invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.updateUe(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/ue/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.deleteUe(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  /* ----------------------- Composition UE↔ECUE ----------------------- */

  fastify.get(
    "/ue/:id/ecue",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.listUeEcue(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/ue/:id/ecue",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ProfessionalUeEcueInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de liaison UE↔ECUE invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.addEcueToUe(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result, 201);
    })
  );

  fastify.patch(
    "/ue/:id/ecue/:ecueId",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id, ecueId } = request.params as { id: string; ecueId: string };
      const parsed = UpdateProfessionalUeEcueSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de liaison UE↔ECUE invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.updateUeEcueLink(request.tenantId as string, id, ecueId, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/ue/:id/ecue/:ecueId",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id, ecueId } = request.params as { id: string; ecueId: string };
      const result = await ue.removeEcueFromUe(request.tenantId as string, id, ecueId);
      return sendResult(reply, result);
    })
  );

  /* ----------------------- Prérequis UE ----------------------- */

  fastify.get(
    "/ue/:id/prerequisites",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.getUePrerequisites(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.put(
    "/ue/:id/prerequisites",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = SetProfessionalUePrerequisitesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Liste de prérequis invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.setUePrerequisites(
        request.tenantId as string,
        id,
        parsed.data.prerequisite_ue_ids
      );
      return sendResult(reply, result);
    })
  );

  /* ===================== Cohortes d'UE (admin) ===================== */

  fastify.get(
    "/ue/:id/sessions",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.listSessions(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/ue/:id/sessions",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = CreateProfessionalUeSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de cohorte invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.createSession(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result, 201);
    })
  );

  // Réouverture d'un lot de sessions terminées (nouvelle date de fin).
  fastify.post(
    "/sessions/reopen",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = ReopenSessionsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de réouverture invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.reopenSessions(request.tenantId as string, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/ue-sessions",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const result = await ue.adminListSessions(request.tenantId as string, {
        ue_id: q.ue_id,
        statut: q.statut,
        semestre_id: q.semestre_id,
        page: q.page ? Number(q.page) : undefined,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      });
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/ue-sessions/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.getSession(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/ue-sessions/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateProfessionalUeSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de cohorte invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.updateSession(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/ue-sessions/:id/status",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ProfessionalUeSessionStatusTransitionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Statut de cohorte invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.transitionSessionStatus(
        request.tenantId as string,
        id,
        parsed.data.statut
      );
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/ue-sessions/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.deleteSession(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  /* ===================== Semestres (regroupement de cohortes, admin) ===================== */

  // UE d'une filière, sélectionnables dans un semestre.
  // Déclarée avant `/semestres/:id` (route statique prioritaire dans Fastify).
  fastify.get(
    "/semestres/eligible-ue",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (!q.filiere_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre filiere_id est requis.",
        });
      }
      const result = await semestre.listEligibleUe(request.tenantId as string, q.filiere_id);
      return sendResult(reply, result);
    })
  );

  // Création groupée de plusieurs semestres d'une même filière.
  fastify.post(
    "/semestres/batch",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateProfessionalSemestresBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de semestres invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await semestre.createSemestresBatch(
        request.tenantId as string,
        parsed.data,
        currentUserId(request) || undefined
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/semestres",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const result = await semestre.listSemestres(request.tenantId as string, {
        filiere_id: q.filiere_id,
      });
      return sendResult(reply, result);
    })
  );

  // Création groupée de sessions par semestre (un semestre ou toute la filière).
  fastify.post(
    "/sessions/by-semestre",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateSessionsBySemestreSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de sessions invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await semestre.createSessionsBySemestre(
        request.tenantId as string,
        parsed.data
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.post(
    "/semestres",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateProfessionalSemestreSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de semestre invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await semestre.createSemestre(
        request.tenantId as string,
        parsed.data,
        currentUserId(request) || undefined
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/semestres/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await semestre.getSemestre(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/semestres/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateProfessionalSemestreSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de semestre invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await semestre.updateSemestre(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/semestres/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await semestre.deleteSemestre(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  /* ===================== Emploi du temps (hebdomadaire) ===================== */

  // Filières ayant au moins une session encore ouverte (pour créer un planning).
  fastify.get(
    "/emploi-temps/filieres-open-sessions",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const result = await emploiTemps.listFilieresWithOpenSessions(request.tenantId as string);
      return sendResult(reply, result);
    })
  );

  // Semestres d'une filière ayant au moins une session encore ouverte.
  fastify.get(
    "/emploi-temps/filieres/:id/semestres-open-sessions",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await emploiTemps.listSemestresWithOpenSessions(
        request.tenantId as string,
        id
      );
      return sendResult(reply, result);
    })
  );

  // Filières ayant déjà un emploi du temps.
  fastify.get(
    "/emploi-temps/filieres",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const result = await emploiTemps.listFilieresWithEmploiTemps(request.tenantId as string);
      return sendResult(reply, result);
    })
  );

  // Semestres d'une filière ayant déjà un emploi du temps.
  fastify.get(
    "/emploi-temps/filieres/:id/semestres",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await emploiTemps.listSemestresWithEmploiTemps(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Liste des emplois du temps d'un semestre (périodes distinctes).
  fastify.get(
    "/emploi-temps/semestre/:id/list",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await emploiTemps.listEmploisDuTemps(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Grille d'un semestre (en-tête + créneaux), filtrable par période ?date_debut&date_fin.
  fastify.get(
    "/emploi-temps/semestre/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const { date_debut, date_fin } = (request.query as any) ?? {};
      const result = await emploiTemps.getEmploiTemps(request.tenantId as string, id, {
        date_debut,
        date_fin,
      });
      return sendResult(reply, result);
    })
  );

  // ECUE programmables d'un semestre.
  fastify.get(
    "/emploi-temps/semestre/:id/ecue",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await emploiTemps.listSemestreEcue(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/emploi-temps",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateEmploiTempsSlotSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de créneau invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await emploiTemps.createSlot(
        request.tenantId as string,
        parsed.data,
        currentUserId(request) || undefined
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.patch(
    "/emploi-temps/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateEmploiTempsSlotSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de créneau invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await emploiTemps.updateSlot(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/emploi-temps/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await emploiTemps.deleteSlot(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  /* ===================== Planning des cours (admin / enseignant) ===================== */

  // Sessions ouvertes sélectionnables (admin = toutes, enseignant = les siennes).
  fastify.get(
    "/planning/sessions",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const scope = { isAdmin: isAdminRequest(request), userId: currentUserId(request) };
      const result = await planning.listPlannableSessions(request.tenantId as string, scope);
      return sendResult(reply, result);
    })
  );

  // ECUE de la session (enseignant = uniquement ses ECUE).
  fastify.get(
    "/planning/sessions/:sessionId/ecue",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const scope = { isAdmin: isAdminRequest(request), userId: currentUserId(request) };
      const result = await planning.listSessionEcue(request.tenantId as string, sessionId, scope);
      return sendResult(reply, result);
    })
  );

  // Liste des plannings (calendrier), filtrable par période ?from=&to=.
  fastify.get(
    "/planning",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const scope = { isAdmin: isAdminRequest(request), userId: currentUserId(request) };
      const result = await planning.listPlannings(request.tenantId as string, scope, {
        from: q.from,
        to: q.to,
      });
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/planning",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const parsed = CreateProfessionalCoursePlanningSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de planning invalides.",
          details: parsed.error.issues,
        });
      }
      const scope = { isAdmin: isAdminRequest(request), userId: currentUserId(request) };
      const result = await planning.createPlanning(request.tenantId as string, parsed.data, scope);
      return sendResult(reply, result, 201);
    })
  );

  fastify.patch(
    "/planning/:id",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateProfessionalCoursePlanningSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de planning invalides.",
          details: parsed.error.issues,
        });
      }
      const scope = { isAdmin: isAdminRequest(request), userId: currentUserId(request) };
      const result = await planning.updatePlanning(request.tenantId as string, id, parsed.data, scope);
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/planning/:id",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const scope = { isAdmin: isAdminRequest(request), userId: currentUserId(request) };
      const result = await planning.deletePlanning(request.tenantId as string, id, scope);
      return sendResult(reply, result);
    })
  );

  /* ===================== Séances d'ECUE (admin / enseignant) ===================== */

  fastify.get(
    "/ue-sessions/:id/seances",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.listSeances(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/ue-sessions/:id/seances",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = CreateProfessionalEcueSeanceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de séance invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.createSeance(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result, 201);
    })
  );

  fastify.patch(
    "/seances/:seanceId",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { seanceId } = request.params as { seanceId: string };
      const parsed = UpdateProfessionalEcueSeanceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de séance invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.updateSeance(request.tenantId as string, seanceId, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/seances/:seanceId",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { seanceId } = request.params as { seanceId: string };
      const result = await ue.deleteSeance(request.tenantId as string, seanceId);
      return sendResult(reply, result);
    })
  );

  // Historique complet des présences d'une filière (admin) : séances + récap étudiants.
  fastify.get(
    "/presences/history",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as { filiere_id?: string; semestre_id?: string; statut?: string };
      if (!q.filiere_id) {
        return reply
          .status(400)
          .send({ success: false, error: "VALIDATION_ERROR", message: "filiere_id requis." });
      }
      const statut =
        q.statut === "terminee" || q.statut === "en_cours" ? q.statut : undefined;
      const result = await ue.getPresencesHistory(
        request.tenantId as string,
        q.filiere_id,
        q.semestre_id || undefined,
        statut
      );
      return sendResult(reply, result);
    })
  );

  // Affectation enseignant ↔ ECUE (au sein d'une session).
  fastify.get(
    "/ue-sessions/:id/ecue-teachers",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await ue.listSessionEcueTeachers(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.put(
    "/ue-sessions/:id/ecue-teachers",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = SetSessionEcueTeacherSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données d'affectation invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.setSessionEcueTeacher(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result);
    })
  );

  // Présence par séance (admin / enseignant).
  fastify.get(
    "/seances/:seanceId/attendance",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { seanceId } = request.params as { seanceId: string };
      const result = await ue.getSeanceAttendance(request.tenantId as string, seanceId);
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/seances/:seanceId/attendance",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { seanceId } = request.params as { seanceId: string };
      const parsed = MarkProfessionalAttendanceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de présence invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await ue.markSeanceAttendance(
        request.tenantId as string,
        seanceId,
        parsed.data,
        currentUserId(request) || undefined
      );
      return sendResult(reply, result);
    })
  );

  /* ===================== Résultats ECUE & validation UE ===================== */

  fastify.get(
    "/ue-sessions/:id/results",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await results.listSessionResults(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/ue-sessions/:id/results/recompute",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await results.recomputeSessionResults(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Grille de saisie d'une cohorte (ECUE × étudiants + notes existantes).
  fastify.get(
    "/ue-sessions/:id/grid",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await results.getSessionGrid(
        request.tenantId as string,
        id,
        isAdminRequest(request) ? undefined : currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Conduite d'un semestre (ECUE dédiée + étudiants + notes) — saisie admin.
  fastify.get(
    "/semestres/:id/conduite",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await results.getSemestreConduite(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/ecue-results/:resultId/validate",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { resultId } = request.params as { resultId: string };
      const parsed = ValidateProfessionalEcueResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Donnée de validation invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await results.validateEcueResultManually(
        request.tenantId as string,
        resultId,
        parsed.data.validee,
        currentUserId(request) || undefined
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/students/:studentId/ue-results",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { studentId } = request.params as { studentId: string };
      const result = await results.listStudentUeResults(request.tenantId as string, studentId);
      return sendResult(reply, result);
    })
  );

  /* ============ Notes manuelles par ECUE (devoir / examen) ============ */

  // Liste des notes manuelles d'une ECUE (filtrable par cohorte / étudiant).
  fastify.get(
    "/ecue/:ecueId/manual-notes",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { ecueId } = request.params as { ecueId: string };
      const q = request.query as { ue_session_id?: string; student_id?: string };
      const result = await results.listEcueNotes(
        request.tenantId as string,
        ecueId,
        q.ue_session_id,
        q.student_id
      );
      return sendResult(reply, result);
    })
  );

  // Saisie manuelle d'une note (devoir multiple / examen unique) sur une ECUE.
  fastify.post(
    "/ecue/:ecueId/manual-notes",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { ecueId } = request.params as { ecueId: string };
      const parsed = CreateEcueManualNoteSchema.safeParse({
        ...(request.body as object),
        ecue_id: ecueId,
      });
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Note invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await results.upsertManualEcueNote(
        request.tenantId as string,
        parsed.data,
        currentUserId(request) || undefined,
        isAdminRequest(request) ? undefined : currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/manual-notes/:id",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateEcueManualNoteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Modification invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await results.updateManualEcueNote(
        request.tenantId as string,
        id,
        parsed.data,
        isAdminRequest(request) ? undefined : currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/manual-notes/:id",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await results.deleteManualEcueNote(
        request.tenantId as string,
        id,
        isAdminRequest(request) ? undefined : currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  /* ===================== Bulletins par semestre ===================== */

  // Tableau récapitulatif des étudiants d'un semestre + décision.
  fastify.get(
    "/semestres/:id/bulletins",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await bulletin.listRoster(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Génère les bulletins officiels de tous les étudiants du semestre
  // (date de génération permanente + statut définitif/provisoire).
  fastify.post(
    "/semestres/:id/bulletins/generate",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await bulletin.generateBulletins(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Historique des bulletins d'une filière (semestres + étudiants + bulletins générés).
  fastify.get(
    "/bulletins/history",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { filiere_id } = request.query as { filiere_id?: string };
      if (!filiere_id) {
        return reply
          .status(400)
          .send({ success: false, error: "VALIDATION_ERROR", message: "filiere_id requis." });
      }
      const result = await bulletin.getBulletinHistory(request.tenantId as string, filiere_id);
      return sendResult(reply, result);
    })
  );

  // Bulletins complets d'un semestre — pour le PDF combiné « Tous les bulletins ».
  // Chemin distinct de « :studentId » pour éviter toute collision de route.
  fastify.get(
    "/semestres/:id/bulletins-full",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await bulletin.listFullBulletins(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Filières pour la saisie des notes (admin = toutes ; enseignant = les siennes).
  fastify.get(
    "/notes/filieres",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const result = await bulletin.listNotesFilieres(
        request.tenantId as string,
        isAdminRequest(request) ? undefined : currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Semestres (avec sessions) d'une filière — pour la saisie des notes.
  fastify.get(
    "/notes/semestres",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { filiere_id } = request.query as { filiere_id?: string };
      if (!filiere_id) {
        return reply
          .status(400)
          .send({ success: false, error: "VALIDATION_ERROR", message: "filiere_id requis." });
      }
      const result = await bulletin.listNotesSemestres(
        request.tenantId as string,
        filiere_id,
        isAdminRequest(request) ? undefined : currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Sessions (cohortes UE) d'un semestre — pour la saisie des notes.
  fastify.get(
    "/semestres/:id/sessions",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await bulletin.listSemestreSessions(
        request.tenantId as string,
        id,
        isAdminRequest(request) ? undefined : currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Recalcule les résultats de toutes les cohortes du semestre.
  fastify.post(
    "/semestres/:id/bulletins/recompute",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const ids = await bulletin.listSemestreSessionIds(request.tenantId as string, id);
      if (!ids.success) return sendResult(reply, ids);
      let recomputed = 0;
      for (const sessionId of ids.data) {
        const r = await results.recomputeSessionResults(request.tenantId as string, sessionId);
        if (r.success) recomputed++;
      }
      return sendResult(reply, {
        success: true as const,
        data: { sessions_recomputed: recomputed },
      });
    })
  );

  // Bulletin détaillé d'un étudiant pour un semestre.
  fastify.get(
    "/semestres/:id/bulletins/:studentId",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id, studentId } = request.params as { id: string; studentId: string };
      const result = await bulletin.getBulletin(request.tenantId as string, id, studentId);
      return sendResult(reply, result);
    })
  );

  // Semestres où l'étudiant connecté est inscrit.
  fastify.get(
    "/student/semestres",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const result = await bulletin.listStudentSemestres(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Bulletin de l'étudiant connecté (son propre relevé).
  fastify.get(
    "/student/bulletins/:semestreId",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { semestreId } = request.params as { semestreId: string };
      const result = await bulletin.getBulletinForUser(
        request.tenantId as string,
        semestreId,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Détail des notes individuelles (devoirs + examen) de l'étudiant connecté.
  fastify.get(
    "/student/bulletins/:semestreId/notes",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { semestreId } = request.params as { semestreId: string };
      const result = await bulletin.getStudentSemestreNotes(
        request.tenantId as string,
        semestreId,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  /* ===================== Supports d'ECUE (admin + enseignant) ===================== */

  const MATERIAL_KIND_BY_MIME: Record<string, MaterialKind> = {
    "application/pdf": "pdf",
    "application/vnd.ms-powerpoint": "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "video/mp4": "video",
    "video/webm": "video",
    "video/quicktime": "video",
    "video/x-m4v": "video",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/webp": "image",
  };

  function kindFromMime(mime: string): MaterialKind {
    return MATERIAL_KIND_BY_MIME[mime] ?? "autre";
  }

  // Liste les supports d'une ECUE (admin, enseignant, étudiant inscrit, parent).
  fastify.get(
    "/ecue/:id/materials",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { id } = request.params as { id: string };
      const result = await ecueMaterials.listForEcue(
        request.tenantId,
        currentUserId(request),
        id,
        isAdminRequest(request)
      );
      return sendResult(reply, result);
    })
  );

  // Upload d'un support sur une ECUE (admin ou enseignant de cette ECUE).
  fastify.post(
    "/ecue/:id/materials/upload",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id: ecueId } = request.params as { id: string };
      const data = await (request as any).file();
      if (!data) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Aucun fichier fourni.",
        });
      }
      const titre = (data.fields?.titre?.value ?? data.filename ?? "").toString().trim();
      const description = (data.fields?.description?.value ?? "").toString() || null;
      if (!titre) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le titre du support est requis.",
        });
      }

      const mime = String(data.mimetype || "application/octet-stream");
      const kind = kindFromMime(mime);

      const safeName = String(data.filename || "document").replace(/[^a-zA-Z0-9._-]/g, "_");
      const uniqueName = `${randomUUID()}_${safeName}`;
      const uploadDir = path.join(process.cwd(), "uploads", "professional", "ecue", ecueId);
      await fs.mkdir(uploadDir, { recursive: true });
      const filePath = path.join(uploadDir, uniqueName);

      try {
        await pipeline(data.file, createWriteStream(filePath));
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: err?.message ?? "Erreur lors de l'écriture du fichier.",
        });
      }

      if ((data.file as any).truncated) {
        await fs.unlink(filePath).catch(() => undefined);
        return reply.status(413).send({
          success: false,
          error: "FILE_TOO_LARGE",
          message: "Fichier trop volumineux.",
        });
      }

      // Non-admin : vérifie l'accès à l'ECUE (sinon FORBIDDEN, on nettoie le fichier).
      if (!isAdminRequest(request)) {
        const accessResult = await ecueMaterials.listForEcue(
          request.tenantId as string,
          currentUserId(request),
          ecueId,
          false
        );
        if (!accessResult.success) {
          await fs.unlink(filePath).catch(() => undefined);
          return sendResult(reply, accessResult);
        }
      }

      const stat = await fs.stat(filePath);
      const result = await ecueMaterials.insertMaterial(request.tenantId as string, {
        ecueId,
        titre,
        description,
        kind,
        storagePath: path.join("uploads", "professional", "ecue", ecueId, uniqueName),
        mimeType: mime,
        fileSize: stat.size,
        uploadedBy: currentUserId(request),
      });

      if (!result.success) {
        await fs.unlink(filePath).catch(() => undefined);
        return sendResult(reply, result);
      }
      return sendResult(reply, result, 201);
    })
  );

  // Suppression d'un support (admin, ou enseignant de l'ECUE).
  fastify.delete(
    "/materials/:materialId",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { materialId } = request.params as { materialId: string };
      const result = await ecueMaterials.deleteMaterial(request.tenantId as string, materialId, {
        userId: currentUserId(request),
        isAdmin: isAdminRequest(request),
      });
      if (result.success) {
        const abs = path.join(process.cwd(), result.data.storage_path);
        await fs.unlink(abs).catch(() => undefined);
        return reply.status(200).send({ success: true, data: { deleted: true } });
      }
      return sendResult(reply, result);
    })
  );

  // Lecture (streaming inline) d'un support. Log la consultation.
  fastify.get(
    "/materials/:materialId/view",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { materialId } = request.params as { materialId: string };
      const userId = currentUserId(request);
      if (!userId) {
        return reply
          .status(401)
          .send({ success: false, error: "FORBIDDEN", message: "Authentification requise." });
      }
      const accessResult = await ecueMaterials.getMaterialForRead(
        request.tenantId,
        userId,
        materialId,
        isAdminRequest(request)
      );
      if (!accessResult.success) return sendResult(reply, accessResult);
      const m = accessResult.data;
      const abs = path.join(process.cwd(), m.storage_path);
      try {
        await fs.access(abs);
      } catch {
        return reply
          .status(404)
          .send({ success: false, error: "NOT_FOUND", message: "Fichier introuvable." });
      }

      ecueMaterials
        .logView(request.tenantId, materialId, userId)
        .catch((err) => request.log?.warn?.({ err }, "logView failed"));

      reply.type(m.mime_type || "application/octet-stream");
      reply.header("Content-Disposition", `inline; filename="${m.titre.replace(/"/g, "")}"`);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "private, max-age=0, no-store");
      const buf = await fs.readFile(abs);
      return reply.send(buf);
    })
  );

  // Détail des consultations d'un support (admin + enseignant de l'ECUE).
  fastify.get(
    "/materials/:materialId/views",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { materialId } = request.params as { materialId: string };
      const result = await ecueMaterials.listViews(
        request.tenantId,
        currentUserId(request),
        materialId,
        isAdminRequest(request)
      );
      return sendResult(reply, result);
    })
  );

  // Agrégation des consultations par utilisateur.
  fastify.get(
    "/materials/:materialId/views/summary",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { materialId } = request.params as { materialId: string };
      const result = await ecueMaterials.listViewsAggregated(
        request.tenantId,
        currentUserId(request),
        materialId,
        isAdminRequest(request)
      );
      return sendResult(reply, result);
    })
  );

  /* ===================== Évaluations professionnelles (ECUE) ===================== */

  fastify.get(
    "/assignments",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const q = request.query as Record<string, string | undefined>;
      const result = await assignments.list(request.tenantId, {
        ecue_id: q.ecue_id,
        ue_session_id: q.ue_session_id,
      });
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/assignments",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const body = (request.body ?? {}) as CreateAssignmentInput;
      if (!body.ecue_id || !body.titre) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "ecue_id et titre sont requis.",
        });
      }
      const result = await assignments.create(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        body
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.patch(
    "/assignments/:id",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await assignments.update(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        id,
        (request.body ?? {}) as UpdateAssignmentInput
      );
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/assignments/:id",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await assignments.delete(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        id
      );
      return sendResult(reply, result);
    })
  );

  // Duplique (« assigne ») une évaluation vers d'autres cibles ECUE × cohorte
  // affectées à l'enseignant. Copie la config + les questions, et recopie le
  // fichier sujet éventuel dans le dossier du duplicata.
  fastify.post(
    "/assignments/:id/duplicate",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        targets?: Array<{ ecue_id: string; ue_session_id?: string | null }>;
        due_at?: string | null;
        starts_at?: string | null;
        statut?: string | null;
      };
      if (!Array.isArray(body.targets) || body.targets.length === 0) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Au moins une filière / cohorte cible est requise.",
        });
      }

      const result = await assignments.duplicateToTargets(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        id,
        body.targets,
        {
          due_at: body.due_at ?? null,
          starts_at: body.starts_at ?? null,
          statut: body.statut ?? null,
        }
      );
      if (!result.success) return sendResult(reply, result);

      // Recopie du fichier sujet pour chaque duplicata (si l'évaluation source
      // avait un sujet PDF/Word). Best-effort : un échec laisse le duplicata sans
      // sujet, l'enseignant pourra le ré-uploader.
      for (const dup of result.data.created as any[]) {
        const meta = dup.document_to_copy as
          | { source_assignment_id: string; filename: string }
          | null
          | undefined;
        delete dup.document_to_copy;
        if (!meta) continue;
        try {
          const srcPath = path.join(
            process.cwd(),
            "uploads",
            "professional",
            "assignments",
            meta.source_assignment_id,
            meta.filename
          );
          await fs.access(srcPath);
          const destDir = path.join(
            process.cwd(),
            "uploads",
            "professional",
            "assignments",
            dup.id
          );
          await fs.mkdir(destDir, { recursive: true });
          await fs.copyFile(srcPath, path.join(destDir, meta.filename));
          const url = `/api/v1/professional/assignments/${encodeURIComponent(
            dup.id
          )}/subject-document/${encodeURIComponent(meta.filename)}`;
          const upd = await assignments.setSubjectDocumentUrl(
            request.tenantId as string,
            currentUserId(request),
            isAdminRequest(request),
            dup.id,
            url
          );
          if (upd.success) dup.subject_document_url = url;
        } catch {
          /* fichier source absent → duplicata sans sujet */
        }
      }

      return reply.status(201).send({ success: true, data: result.data });
    })
  );

  fastify.get(
    "/assignments/:id/submissions",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await assignments.listSubmissions(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        id
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/assignments/:id/submit",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { contenu?: string | null; file_url?: string | null };
      const result = await assignments.submit(
        request.tenantId as string,
        currentUserId(request),
        id,
        body
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/assignments/:id/my-submission",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await assignments.getMySubmission(
        request.tenantId as string,
        currentUserId(request),
        id
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/assignments",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const result = await assignments.listForStudent(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/assignments/:id/submissions/:studentId/grade",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id, studentId } = request.params as { id: string; studentId: string };
      const body = (request.body ?? {}) as { note?: number; appreciation?: string | null };
      if (typeof body.note !== "number") {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "note (number) requise.",
        });
      }
      const result = await assignments.grade(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        id,
        studentId,
        { note: body.note, appreciation: body.appreciation ?? null }
      );
      // Auto-capture : réintègre la note dans le résultat ECUE.
      if (result.success) {
        await results
          .recomputeAfterGrade(request.tenantId as string, id, studentId)
          .catch(() => undefined);
      }
      return sendResult(reply, result);
    })
  );

  // Upload du sujet PDF d'une évaluation (admin / enseignant).
  fastify.post(
    "/assignments/:id/subject-document/upload",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id: assignmentId } = request.params as { id: string };
      const data = await (request as any).file();
      if (!data) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Aucun fichier fourni.",
        });
      }
      const safeName = String(data.filename || "sujet.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      const uniqueName = `${randomUUID()}_${safeName}`;
      const uploadDir = path.join(
        process.cwd(),
        "uploads",
        "professional",
        "assignments",
        assignmentId
      );
      await fs.mkdir(uploadDir, { recursive: true });
      const filePath = path.join(uploadDir, uniqueName);
      try {
        await pipeline(data.file, createWriteStream(filePath));
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: err?.message ?? "Erreur lors de l'écriture du fichier.",
        });
      }
      if ((data.file as any).truncated) {
        await fs.unlink(filePath).catch(() => undefined);
        return reply.status(413).send({
          success: false,
          error: "FILE_TOO_LARGE",
          message: "Fichier trop volumineux.",
        });
      }
      const url = `/api/v1/professional/assignments/${encodeURIComponent(
        assignmentId
      )}/subject-document/${encodeURIComponent(uniqueName)}`;
      const result = await assignments.setSubjectDocumentUrl(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        assignmentId,
        url
      );
      if (!result.success) {
        await fs.unlink(filePath).catch(() => undefined);
        return sendResult(reply, result);
      }
      return reply.status(201).send({ success: true, data: { url, ...result.data } });
    })
  );

  // Soumission étudiante avec FICHIER (multipart : file + contenu optionnel).
  fastify.post(
    "/assignments/:id/submit-upload",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id: assignmentId } = request.params as { id: string };
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const userId = currentUserId(request);

      const data = await (request as any).file();
      if (!data) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Aucun fichier fourni.",
        });
      }
      const contenu = (data.fields?.contenu?.value ?? "").toString() || null;

      const access = await assignments.getAssignmentForStudent(
        request.tenantId,
        userId,
        assignmentId
      );
      if (!access.success) return sendResult(reply, access);

      const safeName = String(data.filename || "rendu.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      const uniqueName = `${access.data.studentProfileId}_${randomUUID()}_${safeName}`;
      const uploadDir = path.join(
        process.cwd(),
        "uploads",
        "professional",
        "submissions",
        assignmentId
      );
      await fs.mkdir(uploadDir, { recursive: true });
      const filePath = path.join(uploadDir, uniqueName);
      try {
        await pipeline(data.file, createWriteStream(filePath));
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: "INTERNAL_ERROR",
          message: err?.message ?? "Erreur lors de l'écriture du fichier.",
        });
      }
      if ((data.file as any).truncated) {
        await fs.unlink(filePath).catch(() => undefined);
        return reply.status(413).send({
          success: false,
          error: "FILE_TOO_LARGE",
          message: "Fichier trop volumineux.",
        });
      }

      const tempUrl = `__pending__/${uniqueName}`;
      const submitResult = await assignments.submit(request.tenantId, userId, assignmentId, {
        contenu,
        file_url: tempUrl,
      });
      if (!submitResult.success) {
        await fs.unlink(filePath).catch(() => undefined);
        return sendResult(reply, submitResult);
      }
      const submissionId = submitResult.data.id;
      const finalUrl = `/api/v1/professional/submissions/${encodeURIComponent(
        submissionId
      )}/file/${encodeURIComponent(uniqueName)}`;
      await (fastify.pg as any).query(
        `UPDATE professional_assignment_submissions SET file_url = $1, updated_at = now() WHERE id = $2`,
        [finalUrl, submissionId]
      );
      return reply
        .status(201)
        .send({ success: true, data: { ...submitResult.data, file_url: finalUrl } });
    })
  );

  // Téléchargement / visualisation du fichier d'une soumission.
  fastify.get(
    "/submissions/:submissionId/file/:filename",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { submissionId, filename } = request.params as {
        submissionId: string;
        filename: string;
      };
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return reply.status(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Nom de fichier invalide.",
        });
      }
      const userId = currentUserId(request);
      if (!userId) {
        return reply
          .status(401)
          .send({ success: false, error: "FORBIDDEN", message: "Authentification requise." });
      }
      const expectedUrl = `/api/v1/professional/submissions/${encodeURIComponent(
        submissionId
      )}/file/${encodeURIComponent(filename)}`;
      const access = await assignments.getSubmissionFileAccess(
        request.tenantId,
        userId,
        isAdminRequest(request),
        submissionId,
        expectedUrl
      );
      if (!access.success) return sendResult(reply, access);

      const abs = path.join(
        process.cwd(),
        "uploads",
        "professional",
        "submissions",
        access.data.assignmentId,
        filename
      );
      try {
        await fs.access(abs);
      } catch {
        return reply
          .status(404)
          .send({ success: false, error: "NOT_FOUND", message: "Fichier introuvable." });
      }
      const ext = path.extname(filename).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".zip": "application/zip",
        ".txt": "text/plain; charset=utf-8",
      };
      const mime = mimeMap[ext] ?? "application/octet-stream";
      const originalName = filename.replace(/^[0-9a-f-]{36}_[0-9a-f-]{36}_/, "");
      reply.type(mime);
      reply.header("Content-Disposition", `inline; filename="${originalName}"`);
      const buf = await fs.readFile(abs);
      return reply.send(buf);
    })
  );

  // Téléchargement / visualisation du sujet PDF (admin, enseignant, étudiant inscrit).
  fastify.get(
    "/assignments/:id/subject-document/:filename",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { id: assignmentId, filename } = request.params as { id: string; filename: string };
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return reply.status(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Nom de fichier invalide.",
        });
      }
      const userId = currentUserId(request);
      if (!userId) {
        return reply
          .status(401)
          .send({ success: false, error: "FORBIDDEN", message: "Authentification requise." });
      }
      const access = await assignments.getAssignmentForRead(
        request.tenantId,
        userId,
        isAdminRequest(request),
        assignmentId
      );
      if (!access.success) return sendResult(reply, access);

      const abs = path.join(
        process.cwd(),
        "uploads",
        "professional",
        "assignments",
        assignmentId,
        filename
      );
      try {
        await fs.access(abs);
      } catch {
        return reply
          .status(404)
          .send({ success: false, error: "NOT_FOUND", message: "Fichier introuvable." });
      }
      const ext = path.extname(filename).toLowerCase();
      const mimeMap2: Record<string, string> = {
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".txt": "text/plain; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };
      const mime = mimeMap2[ext] ?? "application/octet-stream";
      const originalName = filename.replace(/^[0-9a-f-]{36}_/, "");
      reply.type(mime);
      reply.header("Content-Disposition", `inline; filename="${originalName}"`);
      reply.header("X-Content-Type-Options", "nosniff");
      const buf = await fs.readFile(abs);
      return reply.send(buf);
    })
  );

  /* ===================== Questions interactives (évaluations en ligne) ===================== */

  fastify.get(
    "/assignments/:id/questions",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { id } = request.params as { id: string };
      const result = await assignments.listQuestions(
        request.tenantId,
        currentUserId(request),
        isAdminRequest(request),
        id
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/assignments/:id/questions",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await assignments.createQuestion(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        id,
        (request.body ?? {}) as any
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.patch(
    "/questions/:questionId",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { questionId } = request.params as { questionId: string };
      const result = await assignments.updateQuestion(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        questionId,
        (request.body ?? {}) as any
      );
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/questions/:questionId",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { questionId } = request.params as { questionId: string };
      const result = await assignments.deleteQuestion(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        questionId
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/assignments/:id/submit-answers",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { answers?: any[] };
      const result = await assignments.submitOnlineAnswers(
        request.tenantId as string,
        currentUserId(request),
        id,
        Array.isArray(body.answers) ? body.answers : []
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/assignments/:id/my-answers",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await assignments.getMyAnswers(
        request.tenantId as string,
        currentUserId(request),
        id
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/submissions/:submissionId/detail",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { submissionId } = request.params as { submissionId: string };
      const result = await assignments.getSubmissionDetail(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        submissionId
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/answers/:answerId/grade",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { answerId } = request.params as { answerId: string };
      const body = (request.body ?? {}) as { points?: number; feedback?: string | null };
      if (typeof body.points !== "number") {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "points (number) requis.",
        });
      }
      const result = await assignments.gradeQuestionAnswer(
        request.tenantId as string,
        currentUserId(request),
        isAdminRequest(request),
        answerId,
        { points: body.points, feedback: body.feedback ?? null }
      );
      // Auto-capture : réintègre la note agrégée dans le résultat ECUE.
      if (result.success && (result as any).data?.assignment_id) {
        await results
          .recomputeAfterGrade(
            request.tenantId as string,
            (result as any).data.assignment_id,
            (result as any).data.student_id
          )
          .catch(() => undefined);
      }
      return sendResult(reply, result);
    })
  );

  /* ===================== Séances visio LiveKit (par séance ECUE) ===================== */

  fastify.get(
    "/seances/:seanceId/live-sessions",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { seanceId } = request.params as { seanceId: string };
      const result = await profLive.list(
        request.tenantId,
        currentUserId(request),
        seanceId,
        isAdminRequest(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/seances/:seanceId/live-sessions",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { seanceId } = request.params as { seanceId: string };
      const body = (request.body ?? {}) as {
        titre?: string | null;
        scheduled_at?: string | null;
        recording_enabled?: boolean;
      };
      const result = await profLive.create(
        request.tenantId as string,
        currentUserId(request),
        seanceId,
        body
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.post(
    "/live-sessions/:liveSessionId/join-token",
    handler(async (request, reply) => {
      if (!request.tenantId) {
        return reply
          .status(400)
          .send({ success: false, error: "TENANT_REQUIRED", message: "Tenant requis." });
      }
      const { liveSessionId } = request.params as { liveSessionId: string };
      const userId = currentUserId(request);
      if (!userId) {
        return reply
          .status(401)
          .send({ success: false, error: "FORBIDDEN", message: "Authentification requise." });
      }
      const roles: string[] = ((request as any).user?.roles ?? []).map((r: string) =>
        String(r).toLowerCase()
      );
      const isMod = roles.some((r) =>
        ["admin", "super_admin", "administrateur", "teacher"].includes(r)
      );
      const user = (request as any).user ?? {};
      const displayName =
        `${user.first_name ?? user.firstName ?? ""} ${user.last_name ?? user.lastName ?? ""}`.trim() ||
        user.email ||
        userId;
      const result = await profLive.getJoinToken(
        request.tenantId,
        userId,
        liveSessionId,
        isMod ? "moderator" : "participant",
        displayName
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/live-sessions/:liveSessionId/end",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { liveSessionId } = request.params as { liveSessionId: string };
      const result = await profLive.end(request.tenantId as string, liveSessionId);
      return sendResult(reply, result);
    })
  );

  /* ============ Suivi & achèvement (admin / enseignant) ============ */

  // Inscription directe d'un étudiant à une session (admin, sans paiement).
  fastify.post(
    "/ue-sessions/:id/enrollments",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = AdminEnrollStudentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "student_id invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await enrollment.adminEnrollStudent(
        request.tenantId as string,
        id,
        parsed.data.student_id
      );
      return sendResult(reply, result, 201);
    })
  );

  // Inscription en lot : N étudiants × M sessions (admin).
  fastify.post(
    "/enrollments/bulk",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = AdminEnrollBulkSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Sélection invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await enrollment.adminEnrollBulk(
        request.tenantId as string,
        parsed.data.ue_session_ids,
        parsed.data.student_ids
      );
      return sendResult(reply, result, 201);
    })
  );

  // Détail d'une inscription (admin).
  fastify.get(
    "/enrollments/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await enrollment.adminGetEnrollment(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Mise à jour du statut d'une inscription (admin).
  fastify.patch(
    "/enrollments/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = AdminUpdateEnrollmentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Statut invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await enrollment.adminUpdateEnrollment(
        request.tenantId as string,
        id,
        parsed.data.statut
      );
      return sendResult(reply, result);
    })
  );

  // Suppression d'une inscription (admin).
  fastify.delete(
    "/enrollments/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await enrollment.adminDeleteEnrollment(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Paiement d'un étudiant réparti sur plusieurs inscriptions (lot).
  fastify.post(
    "/enrollments/pay",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = AdminRecordStudentPaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Paiement invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await payment.adminRecordStudentPayment(
        request.tenantId as string,
        parsed.data.enrollment_ids,
        {
          montant: parsed.data.montant,
          mode: parsed.data.mode,
          reference_transaction: parsed.data.reference_transaction || null,
        }
      );
      return sendResult(reply, result, 201);
    })
  );

  // Historique fusionné des paiements d'un lot (plusieurs inscriptions).
  fastify.post(
    "/enrollments/payments-history",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = EnrollmentIdsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Liste d'inscriptions invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await payment.adminListPaymentsForEnrollments(
        request.tenantId as string,
        parsed.data.enrollment_ids
      );
      return sendResult(reply, result);
    })
  );

  // Paiements d'une inscription (admin) : historique.
  fastify.get(
    "/enrollments/:id/payments",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await payment.adminListEnrollmentPayments(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  // Enregistrer un paiement (partiel possible) sur une inscription (admin).
  fastify.post(
    "/enrollments/:id/payments",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = AdminRecordPaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Paiement invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await payment.adminRecordPayment(request.tenantId as string, id, {
        montant: parsed.data.montant,
        mode: parsed.data.mode,
        reference_transaction: parsed.data.reference_transaction || null,
      });
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/enrollments",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const result = await enrollment.adminListEnrollments(request.tenantId as string, {
        filiere_id: q.filiere_id,
        ue_session_id: q.ue_session_id,
        ue_id: q.ue_id,
        student_id: q.student_id,
        statut: q.statut,
        page: q.page ? Number(q.page) : undefined,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      });
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/payments",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const result = await payment.adminListPayments(request.tenantId as string, {
        statut: q.statut,
        order_id: q.order_id,
        page: q.page ? Number(q.page) : undefined,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      });
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/enrollments/:id/complete",
    { preHandler: requireAdminOrTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId as string;
      const result = await enrollment.completeEnrollment(tenantId, id);
      // Best-effort : recalcul des résultats UE puis des diplômes — sans jamais
      // compromettre l'achèvement de l'inscription.
      if (result.success) {
        const data = result.data as {
          student_id?: string;
          ue_id?: string;
          ue_session_id?: string;
        };
        try {
          if (data?.ue_session_id) {
            await results.recomputeSessionResults(tenantId, data.ue_session_id);
          }
          if (data?.student_id && data?.ue_id) {
            await diplomas.recomputeForStudent(tenantId, data.student_id, data.ue_id);
          }
        } catch (err) {
          request.log?.error?.(err, "recompute après completeEnrollment a échoué (sans incidence)");
        }
      }
      return sendResult(reply, result);
    })
  );

  /* ===================== Espace étudiant ===================== */

  fastify.get(
    "/student/programmes",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const result = await enrollment.listFilieres(request.tenantId as string);
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/catalog",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const filiereId = q.filiere_id ?? q.programme_id;
      if (!filiereId) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre filiere_id est requis.",
        });
      }
      const result = await enrollment.getCatalog(
        request.tenantId as string,
        currentUserId(request),
        filiereId
      );
      return sendResult(reply, result);
    })
  );

  // ECUE débloquées par une inscription confirmée à une cohorte.
  fastify.get(
    "/student/ue/:ueSessionId/ecue",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { ueSessionId } = request.params as { ueSessionId: string };
      const result = await enrollment.listSessionEcueForStudent(
        request.tenantId as string,
        currentUserId(request),
        ueSessionId
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/cart",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const result = await enrollment.getCart(request.tenantId as string, currentUserId(request));
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/student/cart/items",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const parsed = ProfessionalCartItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "ue_session_id invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await enrollment.addToCart(
        request.tenantId as string,
        currentUserId(request),
        parsed.data.ue_session_id
      );
      return sendResult(reply, result, 201);
    })
  );

  // Auto-inscription directe d'un étudiant à une session (sans panier).
  fastify.post(
    "/student/enroll",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const parsed = ProfessionalCartItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "ue_session_id invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await enrollment.studentSelfEnroll(
        request.tenantId as string,
        currentUserId(request),
        parsed.data.ue_session_id
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.delete(
    "/student/cart/items/:enrollmentId",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { enrollmentId } = request.params as { enrollmentId: string };
      const result = await enrollment.removeFromCart(
        request.tenantId as string,
        currentUserId(request),
        enrollmentId
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/student/orders",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const result = await enrollment.validateOrder(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/student/orders",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const result = await enrollment.listOrders(request.tenantId as string, currentUserId(request));
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/orders/:id",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await enrollment.getOrder(
        request.tenantId as string,
        currentUserId(request),
        id
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/student/orders/:id/payment",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = CreateProfessionalPaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de paiement invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await payment.payOrder(
        request.tenantId as string,
        currentUserId(request),
        id,
        parsed.data
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/enrollments",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const result = await enrollment.listEnrollments(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/emploi-temps",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const result = await emploiTemps.listStudentEmploiTemps(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/receipts/:paymentId",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { paymentId } = request.params as { paymentId: string };
      const result = await payment.getReceipt(
        request.tenantId as string,
        currentUserId(request),
        paymentId
      );
      return sendResult(reply, result);
    })
  );

  /* ===================== Espace parent ====================== */

  fastify.get(
    "/parent/children",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const result = await enrollment.parentListChildren(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/parent/enrollments",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (!q.child_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre child_id est requis.",
        });
      }
      const result = await enrollment.parentListChildEnrollments(
        request.tenantId as string,
        currentUserId(request),
        q.child_id
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/parent/payments",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (!q.child_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre child_id est requis.",
        });
      }
      const result = await enrollment.parentListChildPayments(
        request.tenantId as string,
        currentUserId(request),
        q.child_id
      );
      return sendResult(reply, result);
    })
  );

  // Historique de présence/absence d'un enfant (parent).
  fastify.get(
    "/parent/attendance",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (!q.child_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre child_id est requis.",
        });
      }
      const result = await enrollment.parentListChildAttendance(
        request.tenantId as string,
        currentUserId(request),
        q.child_id
      );
      return sendResult(reply, result);
    })
  );

  // Semestres où l'enfant est inscrit (parent).
  fastify.get(
    "/parent/bulletins/semestres",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (!q.child_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre child_id est requis.",
        });
      }
      const result = await bulletin.listChildSemestres(
        request.tenantId as string,
        currentUserId(request),
        q.child_id
      );
      return sendResult(reply, result);
    })
  );

  // Bulletin (notes) d'un enfant pour un semestre (parent).
  fastify.get(
    "/parent/bulletins/:semestreId",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const { semestreId } = request.params as { semestreId: string };
      const q = request.query as Record<string, string | undefined>;
      if (!q.child_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre child_id est requis.",
        });
      }
      const result = await bulletin.getChildBulletin(
        request.tenantId as string,
        currentUserId(request),
        semestreId,
        q.child_id
      );
      return sendResult(reply, result);
    })
  );

  // Détail des notes individuelles d'un enfant pour un semestre (parent).
  fastify.get(
    "/parent/bulletins/:semestreId/notes",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const { semestreId } = request.params as { semestreId: string };
      const q = request.query as Record<string, string | undefined>;
      if (!q.child_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre child_id est requis.",
        });
      }
      const result = await bulletin.getChildSemestreNotes(
        request.tenantId as string,
        currentUserId(request),
        semestreId,
        q.child_id
      );
      return sendResult(reply, result);
    })
  );

  // Devoirs & évaluations d'un enfant (parent).
  fastify.get(
    "/parent/assignments",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (!q.child_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre child_id est requis.",
        });
      }
      const result = await assignments.listForChild(
        request.tenantId as string,
        currentUserId(request),
        q.child_id
      );
      return sendResult(reply, result);
    })
  );

  /* ============== Espace enseignant (cohortes / séances) ============== */

  fastify.get(
    "/teacher/sessions",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const result = await teacher.listTeacherSessions(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Étudiants de l'enseignant (par filière / session, selon ses ECUE).
  fastify.get(
    "/teacher/students",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const result = await teacher.listTeacherStudents(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Historique des présences effectuées par l'enseignant.
  fastify.get(
    "/teacher/attendance-history",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const result = await teacher.listTeacherAttendanceHistory(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Historique complet des évaluations des ECUE affectés à l'enseignant.
  fastify.get(
    "/teacher/assignments",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const result = await teacher.listTeacherAssignments(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // Emploi du temps hebdomadaire de l'enseignant.
  fastify.get(
    "/teacher/emploi-temps",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const result = await teacher.listTeacherEmploiTemps(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  // ECUE (matières) affectées à l'enseignant.
  fastify.get(
    "/teacher/ecue",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const result = await teacher.listTeacherEcue(
        request.tenantId as string,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/teacher/sessions/:id/seances",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await teacher.listSessionSeances(
        request.tenantId as string,
        currentUserId(request),
        id
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/teacher/sessions/:id/ecue",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await teacher.listSessionEcue(
        request.tenantId as string,
        currentUserId(request),
        id
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/teacher/sessions/:id/seances",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = CreateProfessionalEcueSeanceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de séance invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await teacher.createSessionSeance(
        request.tenantId as string,
        currentUserId(request),
        id,
        parsed.data
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.delete(
    "/teacher/seances/:seanceId",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const { seanceId } = request.params as { seanceId: string };
      const result = await teacher.deleteSeance(
        request.tenantId as string,
        currentUserId(request),
        seanceId
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/teacher/seances/:seanceId/attendance",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const { seanceId } = request.params as { seanceId: string };
      const result = await teacher.listSeanceAttendance(
        request.tenantId as string,
        currentUserId(request),
        seanceId
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/teacher/seances/:seanceId/attendance",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const { seanceId } = request.params as { seanceId: string };
      const body = (request.body ?? {}) as {
        records?: Array<{ student_id?: string; statut?: string }>;
      };
      if (!Array.isArray(body.records) || body.records.length === 0) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le champ records (tableau non vide) est requis.",
        });
      }
      for (const r of body.records) {
        if (!r || typeof r.student_id !== "string" || typeof r.statut !== "string") {
          return reply.status(422).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Chaque enregistrement requiert student_id et statut.",
          });
        }
      }
      const result = await teacher.markSeanceAttendance(
        request.tenantId as string,
        currentUserId(request),
        seanceId,
        body.records as Array<{ student_id: string; statut: string }>
      );
      return sendResult(reply, result);
    })
  );

  /* ============== Diplômes professionnels (admin) ============== */

  fastify.get(
    "/diplomas",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const result = await diplomas.list(request.tenantId as string, {
        filiere_id: q.filiere_id,
        statut: q.statut,
        q: q.q,
      });
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/diplomas",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = DiplomaCreateInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de diplôme invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await diplomas.create(
        request.tenantId as string,
        parsed.data,
        currentUserId(request) || null
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/diplomas/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await diplomas.getById(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/diplomas/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = DiplomaUpdateInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de diplôme invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await diplomas.update(request.tenantId as string, id, parsed.data);
      return sendResult(reply, result);
    })
  );

  fastify.delete(
    "/diplomas/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await diplomas.delete(request.tenantId as string, id);
      if (!result.success) return sendResult(reply, result);
      return reply.status(204).send();
    })
  );

  fastify.get(
    "/diplomas/:id/requirements",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await diplomas.getRequirements(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.put(
    "/diplomas/:id/requirements",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = DiplomaRequirementsReplaceInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Liste d'exigences invalide.",
          details: parsed.error.issues,
        });
      }
      const result = await diplomas.replaceRequirements(
        request.tenantId as string,
        id,
        parsed.data.requirements
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/diplomas/:id/recompute",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await diplomas.recomputeAllForDiploma(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/diplomas/:id/awarded",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const q = request.query as Record<string, string | undefined>;
      const result = await diplomas.listAwarded(request.tenantId as string, id, q.statut);
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/diplomas/:id/candidates",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await diplomas.listCandidates(request.tenantId as string, id);
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/diplomas/:id/award",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = DiplomaAwardManualInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données d'octroi invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await diplomas.awardManual(
        request.tenantId as string,
        id,
        parsed.data.student_id,
        { force: parsed.data.force },
        currentUserId(request)
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.post(
    "/diplomas/:id/revoke",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = DiplomaRevokeInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Données de révocation invalides.",
          details: parsed.error.issues,
        });
      }
      const result = await diplomas.revoke(
        request.tenantId as string,
        id,
        parsed.data.student_id,
        parsed.data.motif,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  /* ============== Diplômes (espace étudiant) ================== */

  fastify.get(
    "/student/diplomas",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const tenantId = request.tenantId as string;
      const sid = await diplomas.getStudentProfileId(tenantId, currentUserId(request));
      if (!sid.success) return sendResult(reply, sid);
      const result = await diplomas.listStudentDiplomas(tenantId, sid.data);
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/diplomas/:id/progress",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId as string;
      const sid = await diplomas.getStudentProfileId(tenantId, currentUserId(request));
      if (!sid.success) return sendResult(reply, sid);
      const result = await diplomas.computeProgress(tenantId, id, sid.data);
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/student/diplomas/:id/attestation",
    { preHandler: requireStudent },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = request.tenantId as string;
      const sid = await diplomas.getStudentProfileId(tenantId, currentUserId(request));
      if (!sid.success) return sendResult(reply, sid);
      const result = await diplomas.getAttestation(tenantId, id, sid.data);
      return sendResult(reply, result);
    })
  );

  /* ========= Diplômes (espace parent, lecture seule) ========== */

  fastify.get(
    "/parent/diplomas",
    { preHandler: requireParent },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (!q.child_id) {
        return reply.status(422).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Le paramètre child_id est requis.",
        });
      }
      const result = await diplomas.listChildDiplomas(
        request.tenantId as string,
        currentUserId(request),
        q.child_id
      );
      return sendResult(reply, result);
    })
  );
}

export default professionalRoutes;
