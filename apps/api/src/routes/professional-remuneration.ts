import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ProfessionalSeancePaieQuerySchema,
  SetProfessionalSeanceStatutSchema,
  ValidateProfessionalSeancesSchema,
  SetSeanceDureePayeeSchema,
  CreateSeanceComptableSchema,
  CreateProfessionalEcueHourlyRateSchema,
  UpdateProfessionalEcueHourlyRateSchema,
  ProfessionalEcueHourlyRateQuerySchema,
  EcueRateResolveQuerySchema,
} from "@ecoledigitale/contracts";
import { requireAdmin, requireTeacher } from "../middlewares/professional-guards";
import type { ServiceResult } from "../services/professional-base.service";
import { ProfessionalSeanceValidationService } from "../services/professional-seance-validation.service";
import { ProfessionalEcueRatesService } from "../services/professional-ecue-rates.service";
import { TeacherPayrollOverviewService } from "../services/teacher-payroll-overview.service";

/**
 * Rémunération du Module Professionnel — feature 031.
 *
 * Deux surfaces seulement, celles qui n'ont pas d'équivalent académique :
 * la validation des séances (source des heures) et les tarifs par ECUE. Les
 * périodes, le calcul, la gestion et les rapports restent les écrans partagés :
 * les dupliquer donnerait deux endroits pour approuver le même paiement.
 */

const ERROR_STATUS: Record<string, number> = {
  SEANCE_NOT_FOUND: 404,
  SEANCE_ALREADY_PAID: 409,
  SEANCE_NOT_PAYABLE: 422,
  RATE_NOT_FOUND: 404,
  RATE_OVERLAP: 409,
  NO_RATE_RESOLVED: 422,
  INVALID_RANGE: 400,
  ECUE_NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  TEACHER_NOT_FOUND: 404,
  FORBIDDEN: 403,
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
        message: error?.message ?? "Erreur interne du serveur.",
      });
    }
  };
}

function currentUserId(request: FastifyRequest): string | null {
  return ((request as any).user?.id as string) ?? null;
}

function validationError(reply: FastifyReply, issues: unknown) {
  return reply.status(422).send({
    success: false,
    error: "VALIDATION_ERROR",
    message: "Requête invalide.",
    details: issues,
  });
}

export async function professionalRemunerationRoutes(fastify: FastifyInstance): Promise<void> {
  const seances = new ProfessionalSeanceValidationService(fastify.pg as any);
  const rates = new ProfessionalEcueRatesService(fastify.pg as any);
  const paie = new TeacherPayrollOverviewService(fastify.pg as any);

  /* ============ Bulletins de paie — vue d'ensemble =================== */

  /**
   * Tous les enseignants avec leur configuration de paie courante, ou son
   * absence. Alimente l'écran « Bulletins de paie » : c'est le point d'entrée
   * qui doit rendre visibles les enseignants NON configurés, que la liste des
   * configurations ne peut par construction pas montrer.
   */
  fastify.get(
    "/bulletins/enseignants",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const result = await paie.listEnseignants(request.tenantId as string);
      return sendResult(reply, result);
    })
  );

  /**
   * Période en attente de calcul, s'il en existe une — celle qui interdit d'en
   * créer une autre. L'écran doit pouvoir désactiver son formulaire AVANT que
   * l'utilisateur remplisse tout pour se voir opposer un 409.
   */
  fastify.get(
    "/bulletins/periode-en-attente",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const result = await paie.periodeEnAttente(request.tenantId as string);
      return sendResult(reply, result);
    })
  );

  /** Classe un ou plusieurs bulletins : ils quittent le plan de travail. */
  fastify.post(
    "/bulletins/archiver",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const body = request.body as { paymentIds?: string[]; tous?: boolean };

      /* `tous: true` archive TOUT ce qui reste au plan de travail. L'écran ne
         peut pas énumérer les identifiants : sa vue d'ensemble ne lui remonte
         qu'un bulletin par enseignant, si bien qu'il n'archivait que ceux qu'il
         affichait et en laissait d'autres derrière.

         L'exigence sur `paymentIds` reste entière quand `tous` est absent : un
         tableau vide ne doit jamais valoir « tout », sans quoi un appel mal
         formé clôturerait la période entière. */
      const tous = body?.tous === true;
      if (!tous && (!Array.isArray(body?.paymentIds) || body.paymentIds.length === 0)) {
        return validationError(
          reply,
          "paymentIds est requis et ne peut pas être vide, ou passer tous: true."
        );
      }
      const result = await paie.archiverBulletins(
        request.tenantId as string,
        tous ? null : (body.paymentIds as string[]),
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  /** Historique des bulletins archivés, filtrable par enseignant. */
  fastify.get(
    "/bulletins/historique",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as { enseignantId?: string };
      const result = await paie.historiqueBulletins(
        request.tenantId as string,
        q.enseignantId || undefined
      );
      return sendResult(reply, result);
    })
  );

  /** Périodes récentes, avec leur périmètre et leur consommation. */
  fastify.get(
    "/bulletins/periodes",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const result = await paie.listPeriodes(request.tenantId as string);
      return sendResult(reply, result);
    })
  );

  /* ============ Validation des séances (administration) ============= */

  fastify.get(
    "/seances",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = ProfessionalSeancePaieQuerySchema.safeParse(request.query);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const result = await seances.listSeances(request.tenantId as string, parsed.data);
      return sendResult(reply, result);
    })
  );

  /**
   * Années scolaires réellement présentes dans les séances. Les options du
   * filtre viennent de la base, pas de la page affichée : sinon une année
   * disparaîtrait du menu au premier écrêtage de la pagination.
   */
  fastify.get(
    "/seances/annees-scolaires",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const result = await seances.listAnneesScolaires(request.tenantId as string);
      return sendResult(reply, result);
    })
  );

  // Avant "/seances/:id" — sinon Fastify ferait correspondre "enseignants"
  // au paramètre d'identifiant.
  fastify.get(
    "/seances/enseignants",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const result = await seances.listEnseignantsATraiter(request.tenantId as string);
      return sendResult(reply, result);
    })
  );

  fastify.patch(
    "/seances/:id/statut",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = SetProfessionalSeanceStatutSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const { id } = request.params as { id: string };
      const result = await seances.setStatut(
        request.tenantId as string,
        id,
        parsed.data.statut,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/seances/validate",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = ValidateProfessionalSeancesSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const result = await seances.validateBatch(
        request.tenantId as string,
        parsed.data.seanceIds,
        parsed.data.validated,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  /**
   * Dérogation comptable sur le volume horaire. Les horaires ne bougent pas :
   * corriger un volume de paie n'est pas corriger un emploi du temps.
   */
  fastify.patch(
    "/seances/:id/duree",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = SetSeanceDureePayeeSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const { id } = request.params as { id: string };
      const result = await seances.setDureePayee(
        request.tenantId as string,
        id,
        parsed.data.duree,
        currentUserId(request)
      );
      return sendResult(reply, result);
    })
  );

  /** Ajout d'une séance que l'enseignant n'avait pas enregistrée. */
  fastify.post(
    "/seances",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateSeanceComptableSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const result = await seances.createSeanceComptable(
        request.tenantId as string,
        parsed.data,
        currentUserId(request)
      );
      return sendResult(reply, result, 201);
    })
  );

  /**
   * Rapprochement : créneaux d'emploi du temps attendus sans séance.
   * C'est ce qui permet au comptable de savoir CE QUI manque, au lieu
   * d'ajouter à l'aveugle.
   */
  fastify.get(
    "/seances/manquantes",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      if (!q.fromDate || !q.toDate) {
        return validationError(reply, "fromDate et toDate sont requis.");
      }
      const result = await seances.findSeancesManquantes(
        request.tenantId as string,
        q.fromDate,
        q.toDate
      );
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/seances/overlaps",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const result = await seances.findOverlaps(request.tenantId as string, {
        fromDate: q.fromDate,
        toDate: q.toDate,
        enseignantId: q.enseignantId,
      });
      return sendResult(reply, result);
    })
  );

  /**
   * Fiche d'une séance. Déclarée APRÈS tous les chemins statiques
   * (`/annees-scolaires`, `/enseignants`, `/manquantes`, `/overlaps`) : placée
   * avant, `:id` les capterait et « overlaps » serait cherché comme un uuid.
   */
  fastify.get(
    "/seances/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      return sendResult(reply, await seances.getSeance(request.tenantId as string, id));
    })
  );

  /* ================= Tarifs horaires ECUE (admin) =================== */

  fastify.get(
    "/ecue-rates",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = ProfessionalEcueHourlyRateQuerySchema.safeParse(request.query);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const result = await rates.list(request.tenantId as string, parsed.data);
      return sendResult(reply, result);
    })
  );

  // Déclaré avant `/ecue-rates/:id` : sinon « resolve » serait capté comme un id.
  fastify.get(
    "/ecue-rates/resolve",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = EcueRateResolveQuerySchema.safeParse(request.query);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const result = await rates.resolve(
        request.tenantId as string,
        parsed.data.ecueId,
        parsed.data.enseignantId,
        parsed.data.date
      );
      return sendResult(reply, result);
    })
  );

  fastify.post(
    "/ecue-rates",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = CreateProfessionalEcueHourlyRateSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const result = await rates.create(
        request.tenantId as string,
        parsed.data,
        currentUserId(request) || undefined
      );
      return sendResult(reply, result, 201);
    })
  );

  fastify.get(
    "/ecue-rates/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      return sendResult(reply, await rates.getById(request.tenantId as string, id));
    })
  );

  fastify.put(
    "/ecue-rates/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const parsed = UpdateProfessionalEcueHourlyRateSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const { id } = request.params as { id: string };
      return sendResult(reply, await rates.update(request.tenantId as string, id, parsed.data));
    })
  );

  fastify.delete(
    "/ecue-rates/:id",
    { preHandler: requireAdmin },
    handler(async (request, reply) => {
      const { id } = request.params as { id: string };
      return sendResult(reply, await rates.remove(request.tenantId as string, id));
    })
  );

  /* ==================== Espace enseignant =========================== */

  /**
   * Le `teacher_id` est dérivé du jeton, jamais d'un paramètre : accepter un
   * `teacherId` en query rendrait toutes les rémunérations lisibles par
   * n'importe quel enseignant authentifié.
   */
  async function resolveOwnTeacherId(request: FastifyRequest): Promise<string | null> {
    const userId = currentUserId(request);
    if (!userId) return null;
    const client = await (fastify.pg as any).connect();
    try {
      const res = await client.query(
        `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
        [userId, request.tenantId]
      );
      return res.rows[0]?.id ?? null;
    } finally {
      client.release();
    }
  }

  fastify.get(
    "/my/seances",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const teacherId = await resolveOwnTeacherId(request);
      if (!teacherId) {
        return reply
          .status(404)
          .send({ success: false, error: "TEACHER_NOT_FOUND", message: "Profil enseignant introuvable." });
      }
      const parsed = ProfessionalSeancePaieQuerySchema.safeParse(request.query);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const result = await seances.listSeances(request.tenantId as string, {
        ...parsed.data,
        enseignantId: teacherId,
      });
      return sendResult(reply, result);
    })
  );

  fastify.get(
    "/my/payments",
    { preHandler: requireTeacher },
    handler(async (request, reply) => {
      const teacherId = await resolveOwnTeacherId(request);
      if (!teacherId) {
        return reply
          .status(404)
          .send({ success: false, error: "TEACHER_NOT_FOUND", message: "Profil enseignant introuvable." });
      }
      const client = await (fastify.pg as any).connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [request.tenantId]);
        const res = await client.query(
          `SELECT tp.id, tp.payment_type::text AS payment_type, tp.status::text AS status,
                  tp.total_amount::float8 AS total_amount, tp.currency,
                  tp.calculated_at, tp.approved_at, tp.paid_at,
                  pp.name AS period_name,
                  pp.period_start::text AS period_start, pp.period_end::text AS period_end,
                  COALESCE(SUM(phd.hours_count) FILTER (WHERE phd.source = 'professionnel'), 0)::float8 AS heures_professionnelles,
                  COALESCE(SUM(phd.hours_count) FILTER (WHERE phd.source = 'academique'), 0)::float8 AS heures_academiques
           FROM teacher_payments tp
           LEFT JOIN payment_periods pp ON pp.id = tp.payment_period_id
           LEFT JOIN payment_hour_details phd ON phd.payment_id = tp.id
           WHERE tp.tenant_id = $1 AND tp.teacher_id = $2
           GROUP BY tp.id, pp.name, pp.period_start, pp.period_end
           ORDER BY pp.period_start DESC NULLS LAST, tp.calculated_at DESC`,
          [request.tenantId, teacherId]
        );
        return reply.send({ success: true, data: res.rows });
      } finally {
        client.release();
      }
    })
  );
}
