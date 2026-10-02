/**
 * Plugin Fastify du module `analytics`, chargé par le registre : `export default async function (app, runtime)`, routes
 * SANS préfixe (le registre applique `/api/v1/analytics`), `setup(app, runtime)` à la racine pour le registre de ports.
 *
 * Toutes les routes sont des LECTURES (sauf `PUT /settings` et `POST /rebuild`), protégées par une permission DU MANIFESTE
 * et par la feature `analytics.direction` (la paie exige aussi `analytics.payroll-insights`, et la MFA : permission
 * `sensitive`). Les réponses portent `meta.asOf` ; elles sont mises en cache côté client (`Cache-Control: private`,
 * `ETag`, 304 sur `If-None-Match`) : la fraîcheur est celle des read-models, jamais celle d'un calcul à la volée.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeAny, z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError, isUuid, type AppError, type Result } from "@ecoledigitale/kernel";
import {
  ANALYTICS_FEATURES,
  ANALYTICS_PERMISSIONS as P,
  analyticsAdmissionsFunnelQuerySchema,
  analyticsAlertAcknowledgeBodySchema,
  analyticsAlertRuleCreateSchema,
  analyticsAlertRuleUpdateSchema,
  analyticsAlertsQuerySchema,
  analyticsCollectionsQuerySchema,
  analyticsCompareQuerySchema,
  analyticsExportDatasetSchema,
  analyticsRebuildBodySchema,
  analyticsReceivablesQuerySchema,
  analyticsResultsQuerySchema,
  analyticsScopeQuerySchema,
  analyticsSettingsUpdateSchema,
} from "@ecoledigitale/contracts/src/v2/analytics";
import type { ModuleRuntime } from "../../../platform/runtime";
import * as admin from "../application/admin";
import * as alerts from "../application/alerts";
import { ALERT_METRICS } from "../domain/alert-metrics";
import * as indicators from "../application/indicators";
import { createAnalyticsDeps } from "../application/deps";
import { EXPORT_PERMISSIONS, exportDataset } from "../application/exports";
import { createAnalyticsPortRegistry, type AnalyticsPortRegistry } from "../application/port-registry";
import type { AnalyticsSourcePorts } from "../application/ports";
import * as q from "../application/queries";

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports sources d'`analytics` (posé par `setup`, renseigné par `registerAnalyticsPorts`). */
    analyticsPorts: AnalyticsPortRegistry;
  }
}

/** Décore la RACINE avec le registre de ports (visible des adaptateurs de plateforme, quel que soit l'ordre de chargement). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("analyticsPorts")) app.decorate("analyticsPorts", createAnalyticsPortRegistry());
}

/** À appeler par la plateforme (adaptateurs) : `calendar`, `enrollments`, `results`, `attendance`, `finance`… */
export function registerAnalyticsPorts(app: FastifyInstance, ports: Partial<AnalyticsSourcePorts>): void {
  if (!app.hasDecorator("analyticsPorts")) app.decorate("analyticsPorts", createAnalyticsPortRegistry());
  app.analyticsPorts.register(ports);
}

function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ValidationError(
      "Paramètres invalides.",
      r.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
    );
  }
  return r.data;
}

const unwrap = <T>(r: Result<T, AppError>): T => {
  if (!r.ok) throw r.error;
  return r.value;
};

/** Réponse JSON avec cache explicite : `ETag` sur le contenu, 304 si inchangé, `asOf` en en-tête. */
function sendCached(request: FastifyRequest, reply: FastifyReply, body: { meta: { asOf: string | null } }): FastifyReply | unknown {
  const json = JSON.stringify(body);
  const etag = `W/"${createHash("sha256").update(json).digest("base64url").slice(0, 27)}"`;
  reply.header("etag", etag).header("cache-control", "private, max-age=15, must-revalidate").header("vary", "Authorization, Cookie");
  if (body.meta.asOf) reply.header("x-analytics-as-of", body.meta.asOf);
  if (request.headers["if-none-match"] === etag) return reply.status(304).send();
  return reply.header("content-type", "application/json; charset=utf-8").send(json);
}

export default async function modulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("analyticsPorts")) app.decorate("analyticsPorts", createAnalyticsPortRegistry());
  const deps = createAnalyticsDeps({ db: runtime.tenantDb, clock: runtime.clock, logger: runtime.logger, audit: runtime.auditPort, portsProvider: () => app.analyticsPorts.current });
  const ctxOf = (request: FastifyRequest) => runtime.resolveContext(request);
  const feature = runtime.entitlements.requireFeature(ANALYTICS_FEATURES.direction);
  const guard = (permission: string) => [runtime.requirePermission(permission), feature];

  /** L'appelant détient-il cette permission ? (garde du module rbac exécutée à la main ; toute autre erreur remonte.) */
  const has = async (request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean> => {
    try {
      await runtime.requirePermission(permission).call(app, request, reply);
      return true;
    } catch (e) {
      if (e instanceof ForbiddenError) return false;
      throw e;
    }
  };
  /** Indicateurs d'alerte dont l'appelant détient la permission de DONNÉES (voir, configurer, acquitter). */
  const allowedMetrics = async (request: FastifyRequest, reply: FastifyReply): Promise<string[]> => {
    const cache = new Map<string, boolean>();
    const out: string[] = [];
    for (const m of ALERT_METRICS) {
      if (!cache.has(m.permission)) cache.set(m.permission, await has(request, reply, m.permission));
      if (cache.get(m.permission)) out.push(m.metric);
    }
    return out;
  };
  /** Identifiant de ressource : un identifiant mal formé est INDISCERNABLE d'une ressource absente (404 uniforme). */
  const idParam = (request: FastifyRequest, what: "alert" | "rule"): string => {
    const id = (request.params as { id?: string }).id ?? "";
    if (!isUuid(id)) throw what === "alert" ? new NotFoundError("Alerte introuvable.", { code: "analytics.alert_not_found" }) : new NotFoundError("Règle d'alerte introuvable.", { code: "analytics.alert_rule_not_found" });
    return id;
  };

  // --- Filtres et fraîcheur ---------------------------------------------------------------------------------------
  app.get("/scopes", { preHandler: guard(P.read) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getScopes(deps, ctxOf(request), parse(analyticsScopeQuerySchema, request.query)))));
  app.get("/freshness", { preHandler: guard(P.read) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getFreshness(deps, ctxOf(request)))));

  // --- Direction : vue d'ensemble, effectifs, présences ------------------------------------------------------------
  app.get("/overview", { preHandler: guard(P.read) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getOverview(deps, ctxOf(request), parse(analyticsScopeQuerySchema, request.query)))));
  app.get("/enrollment", { preHandler: guard(P.read) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getEnrollment(deps, ctxOf(request), parse(analyticsScopeQuerySchema, request.query)))));
  app.get("/attendance", { preHandler: guard(P.attendance) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getAttendance(deps, ctxOf(request), parse(analyticsScopeQuerySchema, request.query)))));

  // --- Pédagogie (résultats FINAL de `results`) ------------------------------------------------------------------
  app.get("/pedagogy/results", { preHandler: guard(P.pedagogy) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getResults(deps, ctxOf(request), parse(analyticsResultsQuerySchema, request.query)))));
  app.get("/pedagogy/teaching-load", { preHandler: guard(P.pedagogy) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getTeachingLoad(deps, ctxOf(request), parse(analyticsScopeQuerySchema, request.query)))));

  // --- Scolarité (facturation) et trésorerie ------------------------------------------------------------------------
  app.get("/finance/summary", { preHandler: guard(P.finance) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getFinanceSummary(deps, ctxOf(request), parse(analyticsScopeQuerySchema, request.query)))));
  app.get("/finance/receivables", { preHandler: guard(P.finance) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getReceivables(deps, ctxOf(request), parse(analyticsReceivablesQuerySchema, request.query)))));
  app.get("/treasury/collections", { preHandler: guard(P.treasury) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getCollections(deps, ctxOf(request), parse(analyticsCollectionsQuerySchema, request.query)))));
  app.get("/treasury/aged", { preHandler: guard(P.treasury) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getAged(deps, ctxOf(request), parse(analyticsScopeQuerySchema, request.query)))));
  app.get("/treasury/cash", { preHandler: guard(P.treasury) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getCash(deps, ctxOf(request), parse(analyticsScopeQuerySchema, request.query)))));

  // --- Paie (sensible : MFA) et charges -------------------------------------------------------------------------
  app.get(
    "/payroll/mass",
    { preHandler: [runtime.requirePermission(P.payroll), runtime.entitlements.requireFeature(ANALYTICS_FEATURES.payroll)] },
    async (request, reply) => {
      const query = parse(analyticsScopeQuerySchema, request.query);
      const result = unwrap(await q.getPayroll(deps, ctxOf(request), query));
      // Donnée sensible : la lecture est consignée AVANT d'être livrée (un échec d'audit refuse la lecture).
      await admin.auditSensitiveRead(deps, ctxOf(request), { resource: "payroll", metadata: { institutionId: query.institutionId ?? null, campusId: query.campusId ?? null, yearId: query.yearId ?? null, periodId: query.periodId ?? null } });
      return sendCached(request, reply, result);
    },
  );
  app.get("/charges", { preHandler: guard(P.charges) }, async (request, reply) => sendCached(request, reply, unwrap(await q.getCharges(deps, ctxOf(request)))));

  // --- Indicateurs transverses : admissions, vie scolaire agrégée, comparaisons -----------------------------------------
  app.get("/admissions/funnel", { preHandler: guard(P.admissions) }, async (request, reply) => sendCached(request, reply, unwrap(await indicators.getAdmissionsFunnel(deps, ctxOf(request), parse(analyticsAdmissionsFunnelQuerySchema, request.query)))));
  app.get("/schoollife/summary", { preHandler: guard(P.schoollife) }, async (request, reply) => sendCached(request, reply, unwrap(await indicators.getSchoolLife(deps, ctxOf(request), parse(analyticsScopeQuerySchema.pick({ institutionId: true }), request.query)))));
  app.get("/compare/enrollment", { preHandler: guard(P.read) }, async (request, reply) => sendCached(request, reply, unwrap(await indicators.compareEnrollment(deps, ctxOf(request), parse(analyticsCompareQuerySchema, request.query)))));
  app.get("/compare/attendance", { preHandler: guard(P.attendance) }, async (request, reply) => sendCached(request, reply, unwrap(await indicators.compareAttendance(deps, ctxOf(request), parse(analyticsCompareQuerySchema, request.query)))));
  app.get("/compare/results", { preHandler: guard(P.pedagogy) }, async (request, reply) => sendCached(request, reply, unwrap(await indicators.compareResults(deps, ctxOf(request), parse(analyticsCompareQuerySchema, request.query)))));
  app.get("/compare/finance", { preHandler: guard(P.finance) }, async (request, reply) => sendCached(request, reply, unwrap(await indicators.compareFinance(deps, ctxOf(request), parse(analyticsCompareQuerySchema, request.query)))));

  // --- Alertes configurables : catalogue, règles, alertes, historique, accusé de réception -----------------------------
  // Les réponses d'alertes ne sont PAS mises en cache (état vivant : acquittement, résolution).
  app.get("/alerts/metrics", { preHandler: guard(P.alertsRead) }, async (request, reply) => alerts.listMetrics(await allowedMetrics(request, reply)));
  app.get("/alerts/rules", { preHandler: guard(P.alertsRead) }, async (request, reply) => unwrap(await alerts.listRules(deps, ctxOf(request), await allowedMetrics(request, reply))));
  app.post("/alerts/rules", { preHandler: guard(P.alertsManage) }, async (request, reply) => reply.status(201).send(unwrap(await alerts.createRule(deps, ctxOf(request), parse(analyticsAlertRuleCreateSchema, request.body), await allowedMetrics(request, reply)))));
  app.put("/alerts/rules/:id", { preHandler: guard(P.alertsManage) }, async (request, reply) => unwrap(await alerts.updateRule(deps, ctxOf(request), idParam(request, "rule"), parse(analyticsAlertRuleUpdateSchema, request.body), await allowedMetrics(request, reply))));
  app.get("/alerts", { preHandler: guard(P.alertsRead) }, async (request, reply) => unwrap(await alerts.listAlerts(deps, ctxOf(request), parse(analyticsAlertsQuerySchema, request.query), await allowedMetrics(request, reply))));
  app.get("/alerts/:id", { preHandler: guard(P.alertsRead) }, async (request, reply) => unwrap(await alerts.getAlert(deps, ctxOf(request), idParam(request, "alert"), await allowedMetrics(request, reply))));
  app.post("/alerts/:id/acknowledge", { preHandler: guard(P.alertsAcknowledge) }, async (request, reply) =>
    unwrap(await alerts.acknowledgeAlert(deps, ctxOf(request), idParam(request, "alert"), parse(analyticsAlertAcknowledgeBodySchema, request.body ?? {}), await allowedMetrics(request, reply))),
  );

  // --- Réglages et reconstruction ---------------------------------------------------------------------------------
  app.get("/settings", { preHandler: guard(P.read) }, async (request) => unwrap(await admin.getSettings(deps, ctxOf(request))));
  app.put("/settings", { preHandler: guard(P.settings) }, async (request) => unwrap(await admin.updateSettings(deps, ctxOf(request), parse(analyticsSettingsUpdateSchema, request.body))));
  app.post("/rebuild", { preHandler: guard(P.rebuild) }, async (request, reply) => {
    const body = parse(analyticsRebuildBodySchema, request.body ?? {});
    return reply.status(202).send(unwrap(await admin.requestRebuild(deps, ctxOf(request), { reason: body.reason })));
  });

  // --- Export CSV : une route par jeu de données (permission du jeu + `analytics.export`) ----------------------------
  for (const dataset of analyticsExportDatasetSchema.options) {
    const permission = EXPORT_PERMISSIONS[dataset];
    const preHandler = dataset === "payroll-mass" ? [runtime.requirePermission(P.export), runtime.requirePermission(permission), runtime.entitlements.requireFeature(ANALYTICS_FEATURES.payroll)] : [runtime.requirePermission(P.export), runtime.requirePermission(permission), feature];
    app.get(`/export/${dataset}.csv`, { preHandler }, async (request, reply) => {
      const query = parse(analyticsScopeQuerySchema.extend({ granularity: analyticsCollectionsQuerySchema.shape.granularity }), request.query);
      const alertMetrics = dataset === "alerts-history" ? await allowedMetrics(request, reply) : undefined;
      const out = unwrap(await exportDataset(deps, ctxOf(request), dataset, { ...query, alertMetrics }));
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${out.filename}"`)
        .header("cache-control", "no-store");
      if (out.asOf) reply.header("x-analytics-as-of", out.asOf);
      return reply.send(out.csv);
    });
  }
}
