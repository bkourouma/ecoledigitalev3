import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CreateCommercialSchema,
  LignesCommissionQuerySchema,
  ProspectionDashboardQuerySchema,
  ProvenanceBulkSchema,
  ProvenanceInputSchema,
  ProvenanceQuerySchema,
  ReglerCommissionsSchema,
  UpdateCommercialSchema,
} from "@ecoledigitale/contracts";
import { requireAdmin } from "../middlewares/professional-guards";
import type { ServiceResult } from "../services/professional-base.service";
import { ProspectionService } from "../services/prospection.service";
import { publicErrorMessage } from "../utils/public-error-message";

/**
 * Prospection — d'où viennent les étudiants, qui les a amenés, et ce qui est dû
 * aux commerciaux (migrations `0120`, `0124`, `0125`).
 *
 * Écrans d'administration uniquement : la provenance d'un étudiant et le solde
 * d'un commercial ne regardent ni l'étudiant ni l'enseignant.
 */

const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 422,
  COMMERCIAL_NOT_FOUND: 404,
  COMMERCIAL_DUPLICATE: 409,
  COMMERCIAL_IN_USE: 409,
  STUDENT_NOT_FOUND: 404,
  REFERENT_NOT_FOUND: 404,
  REFERENT_SELF: 422,
  PROVENANCE_NOT_FOUND: 404,
  VERSEMENT_NOT_FOUND: 404,
  AUCUNE_LIGNE_A_REGLER: 422,
  INTERNAL_ERROR: 500,
};

function sendResult(reply: FastifyReply, result: ServiceResult<unknown>, successStatus = 200) {
  if (!result.success) {
    const failure = result as { error: string };
    return reply.status(ERROR_STATUS[failure.error] ?? 400).send(result);
  }
  return reply.status(successStatus).send(result);
}

function handler(fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn(request, reply);
    } catch (error: any) {
      request.log?.error?.(error);
      return reply.status(500).send({
        success: false,
        error: "INTERNAL_ERROR",
        message: publicErrorMessage(error),
      });
    }
  };
}

function validationError(reply: FastifyReply, message: string, issues: unknown) {
  return reply.status(422).send({
    success: false,
    error: "VALIDATION_ERROR",
    message,
    details: issues,
  });
}

function currentUserId(request: FastifyRequest): string | null {
  return ((request as any).user?.id as string) ?? null;
}

export async function prospectionRoutes(fastify: FastifyInstance) {
  const service = new ProspectionService(fastify.pg as any);
  const tenantOf = (request: FastifyRequest) => (request as any).tenantId as string;

  // ---------------------------------------------------------------- Commerciaux

  fastify.get(
    "/commerciaux",
    { preHandler: requireAdmin },
    handler(async (request, reply) =>
      sendResult(reply, await service.listCommerciaux(tenantOf(request)))
    )
  );

  fastify.post(
    "/commerciaux",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateCommercialSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, "Commercial invalide.", parsed.error.issues);
      }
      return sendResult(reply, await service.createCommercial(tenantOf(request), parsed.data), 201);
    })
  );

  fastify.patch(
    "/commerciaux/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateCommercialSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, "Commercial invalide.", parsed.error.issues);
      }
      return sendResult(reply, await service.updateCommercial(tenantOf(request), id, parsed.data));
    })
  );

  fastify.delete(
    "/commerciaux/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      return sendResult(reply, await service.deleteCommercial(tenantOf(request), id));
    })
  );

  // ---------------------------------------------------------------- Provenances

  fastify.get(
    "/provenances",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const raw = request.query as Record<string, string | undefined>;
      const parsed = ProvenanceQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return validationError(reply, "Filtres invalides.", parsed.error.issues);
      }
      const limit = raw.limit ? Number(raw.limit) : undefined;
      const offset = raw.offset ? Number(raw.offset) : undefined;
      return sendResult(
        reply,
        await service.listProvenances(tenantOf(request), { ...parsed.data, limit, offset })
      );
    })
  );

  // Provenance d'un étudiant précis — alimente le bloc « Provenance » de sa
  // fiche. Renvoie `null` quand elle n'a jamais été renseignée.
  fastify.get(
    "/provenances/:studentId",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { studentId } = request.params as { studentId: string };
      const result = await service.listProvenances(tenantOf(request), {
        student_id: studentId,
        limit: 1,
      });
      if (!result.success) return sendResult(reply, result);
      const items = (result.data as { items: unknown[] }).items;
      return reply.status(200).send({ success: true, data: items[0] ?? null });
    })
  );

  fastify.put(
    "/provenances/:studentId",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { studentId } = request.params as { studentId: string };
      const parsed = ProvenanceInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, "Provenance invalide.", parsed.error.issues);
      }
      return sendResult(
        reply,
        await service.setProvenance(
          tenantOf(request),
          studentId,
          parsed.data,
          currentUserId(request)
        )
      );
    })
  );

  fastify.post(
    "/provenances/bulk",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = ProvenanceBulkSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, "Provenances invalides.", parsed.error.issues);
      }
      return sendResult(
        reply,
        await service.setProvenancesBulk(
          tenantOf(request),
          parsed.data.entrees,
          currentUserId(request)
        ),
        201
      );
    })
  );

  fastify.delete(
    "/provenances/:studentId",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { studentId } = request.params as { studentId: string };
      return sendResult(reply, await service.deleteProvenance(tenantOf(request), studentId));
    })
  );

  // ---------------------------------------------------------------- Commissions

  // Lignes de commission : une par paiement de scolarité rémunérable. C'est la
  // seule lecture exposée — le solde d'un commercial se déduit des lignes
  // elles-mêmes, il n'a pas besoin d'un point d'entrée à part.
  fastify.get(
    "/commissions/lignes",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = LignesCommissionQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return validationError(reply, "Filtres invalides.", parsed.error.issues);
      }
      return sendResult(reply, await service.listLignesCommission(tenantOf(request), parsed.data));
    })
  );

  // ---------------------------------------------------------------- Règlements

  // Règle des LIGNES de commission : une ligne = un paiement de scolarité
  // rémunérable. Le montant n'est pas transmis, le serveur le recalcule.
  fastify.post(
    "/commissions/regler",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = ReglerCommissionsSchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, "Sélection invalide.", parsed.error.issues);
      }
      return sendResult(
        reply,
        await service.reglerLignesCommission(
          tenantOf(request),
          parsed.data,
          currentUserId(request)
        ),
        201
      );
    })
  );

  // Annule un règlement : la commission correspondante redevient impayée.
  // Les règlements se LISENT par `/commissions/lignes?statut=regle`, qui les
  // rend avec la commission qu'ils soldent — une liste de versements nus
  // n'aurait dit ni pour qui ni au titre de quoi.
  fastify.delete(
    "/versements/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      return sendResult(reply, await service.deleteVersement(tenantOf(request), id));
    })
  );

  // ---------------------------------------------------------------- Tableau de bord

  fastify.get(
    "/dashboard",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = ProspectionDashboardQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return validationError(reply, "Période invalide.", parsed.error.issues);
      }
      return sendResult(reply, await service.dashboard(tenantOf(request), parsed.data));
    })
  );
}
