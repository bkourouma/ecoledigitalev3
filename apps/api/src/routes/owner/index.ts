import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  OwnerDashboardResponseSchema,
  OwnerFinancesQuerySchema,
  OwnerFinancesResponseSchema,
  OwnerFinancialReportQuerySchema,
  OwnerPayrollValidateResponseSchema,
  OwnerAcademicResponseSchema,
  OwnerStaffResponseSchema,
  OwnerFormationsResponseSchema,
  OwnerAlertsListResponseSchema,
  OwnerUsersListResponseSchema,
  OwnerAssignableRolesResponseSchema,
  OwnerUserRolesPatchBodySchema,
  OwnerUserRolesPatchResponseSchema,
  OwnerAlertSchema,
  type OwnerAlert,
} from "@ecoledigitale/contracts/src/owner.schema";
import {
  OwnerPedagogieQuerySchema,
  OwnerPedagogieResponseSchema,
  OwnerFinancesProQuerySchema,
  OwnerFinancesProResponseSchema,
  OwnerStatsFiltersResponseSchema,
  OwnerReferentielQuerySchema,
  OwnerReferentielResponseSchema,
  OwnerAssiduiteQuerySchema,
  OwnerAssiduiteResponseSchema,
  OwnerPersonnesQuerySchema,
  OwnerPersonnesResponseSchema,
  OwnerRecrutementQuerySchema,
  OwnerRecrutementResponseSchema,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import { fetchOwnerReferentiel } from "../../services/owner-referentiel.service";
import { fetchOwnerAssiduite } from "../../services/owner-assiduite.service";
import { fetchOwnerPersonnes } from "../../services/owner-personnes.service";
import { fetchOwnerRecrutement } from "../../services/owner-recrutement.service";
import {
  buildOwnerAssiduiteCsv,
  buildOwnerFinancesProCsv,
  buildOwnerPedagogieCsv,
  buildOwnerPersonnesCsv,
  buildOwnerRecrutementCsv,
} from "../../services/owner-stats-csv.service";
import { requireOwner, requireOwnerOrAdmin } from "../../middlewares/requireOwner";
import { fetchOwnerPedagogie } from "../../services/owner-pedagogie.service";
import { fetchOwnerFinancesPro } from "../../services/owner-finances-pro.service";
import { fetchOwnerStatsFilters } from "../../services/owner-stats-filters.service";
import { fetchOwnerDashboardKpis } from "../../services/owner-dashboard.service";
import {
  buildOwnerFinancialReportCsv,
  buildOwnerFinancialReportHtml,
  fetchOwnerFinances,
  type OwnerFinancesQuery,
} from "../../services/owner-finances.service";
import { PDFGenerationService } from "../../services/pdf-generation.service";
import { validateTeacherPaymentAsOwner } from "../../services/owner-payroll.service";
import { fetchOwnerAcademic } from "../../services/owner-academic.service";
import { fetchOwnerStaff } from "../../services/owner-staff.service";
import { fetchOwnerFormations } from "../../services/owner-formations.service";
import { syncOwnerPilotageAlerts } from "../../services/owner-alerts-feed.service";
import {
  OWNER_ASSIGNABLE_ROLE_KEYS,
  listOwnerTenantUsers,
  patchUserRolesAsOwner,
} from "../../services/owner-users.service";

/**
 * Normalise la query string des routes de statistiques avant validation Zod.
 *
 * Fastify parse `?filiereIds=a&filiereIds=b` en tableau mais `?filiereIds=a` en
 * chaîne : sans ce passage, un filtre à une seule filière échouerait la validation
 * `z.array(...)`. On accepte aussi la forme CSV `?filiereIds=a,b`, plus commode à
 * construire côté front.
 */
function normalizeStatsQuery(q: unknown): Record<string, unknown> {
  const src = (q ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  for (const key of ["filiereIds"]) {
    const raw = src[key];
    if (raw === undefined || raw === null || raw === "") {
      delete out[key];
      continue;
    }
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    const cleaned = list.map((v) => String(v).trim()).filter((v) => v.length > 0);
    if (cleaned.length === 0) delete out[key];
    else out[key] = cleaned;
  }

  // Une chaîne vide vaut « filtre absent », pas « valeur invalide ».
  for (const key of Object.keys(out)) {
    if (out[key] === "") delete out[key];
  }

  return out;
}

function parseOwnerFinancesQuery(q: unknown): OwnerFinancesQuery {
  const parsed = OwnerFinancesQuerySchema.safeParse(q);
  const d = parsed.success ? parsed.data : { period: "month" as const };
  const cycleRaw = d.cycleId ?? d.cycle;
  const cycleId = z.string().uuid().safeParse(cycleRaw ?? "").success ? cycleRaw : undefined;
  return {
    period: d.period,
    academicYearId: d.academicYearId,
    cycleId,
  };
}

function emptyDashboard(): z.infer<typeof OwnerDashboardResponseSchema> {
  return {
    finances: {
      revenueCurrentMonth: 0,
      recoveryRate: 0,
      recoveryByCycle: [],
      teacherPaymentRate: 0,
      overdueCount: 0,
    },
    academic: {
      totalStudents: 0,
      totalClasses: 0,
      averageGrade: 0,
      successRate: 0,
      attendanceRate: 0,
      assignmentsGradedRate: 0,
    },
    staff: {
      activeTeachers: 0,
      totalHoursTaught: 0,
      coursesWithoutTeacher: 0,
      pendingPayrollValidations: 0,
    },
    formations: {
      activeSessions: 0,
      totalEnrollments: 0,
      revenueFormations: 0,
      clientCompanies: 0,
    },
    professional: {
      enrolledStudents: 0,
      enrolledStudentsPrevMonth: 0,
      recoveryRate: 0,
      // `null` et non 0 : « aucun semestre clos avec bulletins » n'est pas
      // « 0 % de réussite ». La carte affiche « — » dans ce cas.
      successRateLastSemester: null,
      attendanceRate30d: 0,
    },
    alerts: [],
  };
}

function mapAlertRow(row: {
  id: string;
  severity: string;
  message: string;
  domain: string;
  created_at: Date | string;
  acknowledged_at: Date | string | null;
}): OwnerAlert {
  return {
    id: row.id,
    severity: row.severity as OwnerAlert["severity"],
    message: row.message,
    domain: row.domain,
    createdAt: new Date(row.created_at).toISOString(),
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
  };
}

export async function ownerRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/dashboard",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      let base;
      try {
        base = await fetchOwnerDashboardKpis(fastify.pg as Pool, tenantId, request.log);
      } catch (e) {
        request.log.error({ err: e }, "owner dashboard KPI aggregation failed");
        base = OwnerDashboardResponseSchema.parse(emptyDashboard());
      }

      const client = await fastify.pg.connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const res = await client.query<{
          id: string;
          severity: string;
          message: string;
          domain: string;
          created_at: Date;
          acknowledged_at: Date | null;
        }>(
          `SELECT id, severity, message, domain, created_at, acknowledged_at
           FROM owner_pilotage_alerts
           WHERE tenant_id = $1 AND acknowledged_at IS NULL
           ORDER BY created_at DESC
           LIMIT 50`,
          [tenantId]
        );
        base = { ...base, alerts: res.rows.map(mapAlertRow) };
      } catch (e) {
        request.log.warn({ err: e }, "owner dashboard alerts query skipped or failed");
        base = { ...base, alerts: [] };
      } finally {
        client.release();
      }

      reply.send(OwnerDashboardResponseSchema.parse(base));
    }
  );

  fastify.get(
    "/finances",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const input = parseOwnerFinancesQuery(request.query);
      try {
        const data = await fetchOwnerFinances(
          fastify.pg as Pool,
          tenantId,
          input,
          request.log
        );
        reply.send(OwnerFinancesResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner finances failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données financières",
        });
      }
    }
  );

  fastify.get(
    "/academic",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerAcademic(fastify.pg as Pool, tenantId, request.log);
        reply.send(OwnerAcademicResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner academic failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les synthèses académiques",
        });
      }
    }
  );

  /* ---------------- Statistiques Module Professionnel (LMD) ---------------- */

  /**
   * Référentiel des filtres (filières, semestres, années scolaires).
   * `requireOwnerOrAdmin` : purement descriptif, utile aussi aux admins.
   */
  fastify.get(
    "/stats/filters",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerStatsFilters(fastify.pg as Pool, tenantId, request.log);
        reply.send(OwnerStatsFiltersResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner stats filters failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les filtres",
        });
      }
    }
  );

  /**
   * Pilotage pédagogique LMD.
   * `requireOwnerOrAdmin` : la performance académique est un outil de pilotage
   * pédagogique dont les admins ont aussi l'usage (§8-3).
   */
  fastify.get(
    "/pedagogie",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerPedagogieQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerPedagogie(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerPedagogieResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner pedagogie failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger le pilotage pédagogique",
        });
      }
    }
  );

  /**
   * Recouvrement du module professionnel.
   * `requireOwner` strict : vue financière consolidée réservée au propriétaire (§8-3).
   */
  fastify.get(
    "/finances/professionnel",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerFinancesProQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerFinancesPro(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerFinancesProResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner finances pro failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger le recouvrement du module professionnel",
        });
      }
    }
  );

  /**
   * Santé du catalogue et incohérences structurelles.
   * `requireOwnerOrAdmin` : ce sont les admins qui corrigeront les anomalies (§8-3).
   */
  fastify.get(
    "/referentiel",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerReferentielQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerReferentiel(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerReferentielResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner referentiel failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger la santé du référentiel",
        });
      }
    }
  );

  /**
   * Assiduité, occupation des salles et charge enseignante.
   * `requireOwnerOrAdmin` : exploitation opérationnelle, utile aux admins (§8-3).
   */
  fastify.get(
    "/assiduite",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerAssiduiteQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerAssiduite(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerAssiduiteResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner assiduite failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données d'assiduité",
        });
      }
    }
  );

  /**
   * Démographie et état des comptes.
   * `requireOwner` strict : données personnelles agrégées de toute la population.
   */
  fastify.get(
    "/personnes",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerPersonnesQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerPersonnes(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerPersonnesResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner personnes failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger la démographie",
        });
      }
    }
  );

  /**
   * Entonnoir des inscriptions en ligne.
   * `requireOwnerOrAdmin` : ce sont les admins qui traitent les demandes (§8-3).
   */
  fastify.get(
    "/recrutement",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerRecrutementQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerRecrutement(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerRecrutementResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner recrutement failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données de recrutement",
        });
      }
    }
  );

  /* ------------------- Exports CSV des pages de statistiques ------------------ */

  /**
   * Chaque export reprend la garde de sa page : un admin qui n'a pas accès aux
   * finances consolidées ne doit pas pouvoir les récupérer par l'export.
   *
   * Le BOM `﻿` est indispensable pour qu'Excel en configuration française
   * affiche correctement les accents.
   */
  function sendCsv(reply: FastifyReply, filename: string, csv: string) {
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    // ⚠️ Le littéral ci-dessous est un vrai caractère BOM (U+FEFF), invisible à
    // la relecture. Ailleurs dans ce fichier la convention est la séquence
    // d'échappement "﻿" (cf. /reports/financial) — les octets produits sont
    // identiques. Ne pas supprimer ce caractère en croyant à une coquille : sans
    // lui, Excel en configuration française n'affiche pas les accents.
    return reply.send("﻿" + csv);
  }

  fastify.get(
    "/pedagogie/export",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerPedagogieQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerPedagogie(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "pilotage-pedagogique.csv", buildOwnerPedagogieCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner pedagogie export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/finances/professionnel/export",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerFinancesProQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerFinancesPro(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(
          reply,
          "recouvrement-professionnel.csv",
          buildOwnerFinancesProCsv(data)
        );
      } catch (e) {
        request.log.error({ err: e }, "owner finances pro export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/assiduite/export",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerAssiduiteQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerAssiduite(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "assiduite.csv", buildOwnerAssiduiteCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner assiduite export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/personnes/export",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerPersonnesQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerPersonnes(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "personnes.csv", buildOwnerPersonnesCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner personnes export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/recrutement/export",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerRecrutementQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerRecrutement(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "recrutement.csv", buildOwnerRecrutementCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner recrutement export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/staff",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerStaff(fastify.pg as Pool, tenantId, request.log);
        reply.send(OwnerStaffResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner staff failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données RH",
        });
      }
    }
  );

  fastify.get(
    "/formations",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerFormations(fastify.pg as Pool, tenantId, request.log);
        reply.send(OwnerFormationsResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner formations failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les formations professionnelles",
        });
      }
    }
  );

  fastify.get(
    "/alerts",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const client = await fastify.pg.connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await syncOwnerPilotageAlerts(client, tenantId, request.log);
        const res = await client.query<{
          id: string;
          severity: string;
          message: string;
          domain: string;
          created_at: Date;
          acknowledged_at: Date | null;
        }>(
          `SELECT id, severity, message, domain, created_at, acknowledged_at
           FROM owner_pilotage_alerts
           WHERE tenant_id = $1 AND acknowledged_at IS NULL
           ORDER BY created_at DESC`,
          [tenantId]
        );
        reply.send(OwnerAlertsListResponseSchema.parse({ alerts: res.rows.map(mapAlertRow) }));
      } catch (e) {
        request.log.warn({ err: e }, "owner alerts list failed");
        reply.send(OwnerAlertsListResponseSchema.parse({ alerts: [] }));
      } finally {
        client.release();
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/alerts/:id/acknowledge",
    { preHandler: requireOwner },
    async (request, reply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Identifiant d’alerte invalide",
        });
      }
      const tenantId = request.tenantId!;
      const userId = (request as { user?: { id: string } }).user?.id;
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: "Unauthorized",
          message: "Contexte utilisateur manquant",
        });
      }

      const client = await fastify.pg.connect();
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const res = await client.query<{
          id: string;
          severity: string;
          message: string;
          domain: string;
          created_at: Date;
          acknowledged_at: Date | null;
        }>(
          `UPDATE owner_pilotage_alerts
           SET acknowledged_at = NOW(), acknowledged_by_user_id = $3
           WHERE id = $1 AND tenant_id = $2 AND acknowledged_at IS NULL
           RETURNING id, severity, message, domain, created_at, acknowledged_at`,
          [id, tenantId, userId]
        );
        if (res.rowCount === 0) {
          return reply.status(404).send({
            success: false,
            error: "Not Found",
            message: "Alerte introuvable ou déjà acquittée",
          });
        }
        reply.send(OwnerAlertSchema.parse(mapAlertRow(res.rows[0])));
      } finally {
        client.release();
      }
    }
  );

  fastify.get(
    "/roles/assignable",
    { preHandler: requireOwnerOrAdmin },
    async (_request, reply) => {
      reply.send(
        OwnerAssignableRolesResponseSchema.parse({
          roleKeys: [...OWNER_ASSIGNABLE_ROLE_KEYS],
        })
      );
    }
  );

  fastify.get(
    "/users",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const users = await listOwnerTenantUsers(fastify.pg as Pool, tenantId, request.log);
      reply.send(OwnerUsersListResponseSchema.parse({ users }));
    }
  );

  fastify.patch<{ Params: { userId: string } }>(
    "/users/:userId/roles",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const { userId: targetUserId } = request.params;
      if (!z.string().uuid().safeParse(targetUserId).success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Identifiant utilisateur invalide",
        });
      }

      const parsed = OwnerUserRolesPatchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }

      const tenantId = request.tenantId!;
      const result = await patchUserRolesAsOwner(
        fastify.pg as Pool,
        tenantId,
        targetUserId,
        parsed.data.roleKeys,
        request.log
      );

      if (!result.ok) {
        return reply.status(result.status).send({
          success: false,
          error: result.status === 409 ? "Conflict" : result.status === 404 ? "Not Found" : "Bad Request",
          message: result.message,
        });
      }

      reply.send(OwnerUserRolesPatchResponseSchema.parse(result.body));
    }
  );

  fastify.get(
    "/reports/financial",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerFinancialReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const { format, ...rest } = parsed.data;
      const input = parseOwnerFinancesQuery(rest);
      const tenantId = request.tenantId!;
      let data;
      try {
        data = await fetchOwnerFinances(fastify.pg as Pool, tenantId, input, request.log);
      } catch (e) {
        request.log.error({ err: e }, "owner financial report failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer le rapport",
        });
      }

      if (format === "csv") {
        const csv = buildOwnerFinancialReportCsv(data);
        const filename = `rapport-financier-${input.period}.csv`;
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="${filename}"`);
        return reply.send("\ufeff" + csv);
      }

      const html = buildOwnerFinancialReportHtml(data);
      const pdfService = new PDFGenerationService();
      try {
        const buf = await pdfService.generatePdfFromHtml(html);
        const filename = `rapport-financier-${input.period}.pdf`;
        reply.header("Content-Type", "application/pdf");
        reply.header("Content-Disposition", `attachment; filename="${filename}"`);
        return reply.send(buf);
      } catch (e) {
        request.log.error({ err: e }, "owner financial PDF failed");
        return reply.status(503).send({
          success: false,
          error: "Service Unavailable",
          message:
            e instanceof Error ? e.message : "Génération PDF indisponible (navigateur / Chrome requis)",
        });
      } finally {
        await pdfService.close().catch(() => {});
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/payroll/:id/validate",
    { preHandler: requireOwner },
    async (request, reply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Identifiant de paiement invalide",
        });
      }

      const tenantId = request.tenantId!;
      const userId = (request as { user?: { id: string } }).user?.id;
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: "Unauthorized",
          message: "Utilisateur non authentifié",
        });
      }

      try {
        const result = await validateTeacherPaymentAsOwner(
          fastify.pg as Pool,
          tenantId,
          id,
          userId,
          request.log
        );

        if (!result.ok) {
          if (result.reason === "not_found") {
            return reply.status(404).send({
              success: false,
              error: "Not Found",
              message: "Paiement introuvable pour ce tenant",
            });
          }
          return reply.status(409).send({
            success: false,
            error: "Conflict",
            message:
              "Validation impossible : le paiement doit être au statut « calculé » et ne pas déjà être approuvé.",
          });
        }

        reply.send(OwnerPayrollValidateResponseSchema.parse(result.payment));
      } catch (e) {
        request.log.error({ err: e, id }, "owner payroll validate failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Erreur lors de la validation du paiement",
        });
      }
    }
  );
}
