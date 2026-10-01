/**
 * Plugin Fastify du module payroll — préfixe `/api/v1/payroll` (appliqué par le registre).
 *
 *   export default async function (app, runtime)   // contrat d'assemblage `(app, runtime)`
 *   export function setup(app, runtime)             // pose le registre de ports sur l'instance RACINE
 *   export async function payrollPlugin(app, { deps, requirePermission, … })   // tests et câblages dédiés
 *   export function registerPayrollPorts(app, ports) // appelé par les modules voisins (scheduling, attendance, people, academic)
 *
 * - Authentification : `request.ctx` posé EN AMONT (iam / authentification historique).
 * - Autorisation : `requirePermission('payroll.…')` du module rbac — jamais un rôle codé en dur. Les routes de lecture
 *   d'un bulletin essaient `payroll.payslip.read` (gestion) puis `payroll.payslip.read_own` (titulaire) ; la PROPRIÉTÉ
 *   est vérifiée par la couche d'accès du cas d'usage, pas ici.
 * - Entitlements : `payroll.core` (tout), `payroll.owner-validation` (masse salariale, validation propriétaire) ;
 *   `payroll.session-source` / `payroll.attendance-source` décident des origines d'heures lues par le calcul.
 * - Chemins STATIQUES déclarés avant les chemins paramétrés. Aucune route de purge (R-PAY-17), aucun `PATCH /status`
 *   libre, aucune création manuelle de bulletin sans calcul.
 * - Erreurs : `AppError` / Zod -> `toErrorBody` ; jamais de message interne exposé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  payrollAdjustBodySchema,
  payrollApproveBodySchema,
  payrollCalculateBodySchema,
  payrollConfigBodySchema,
  payrollConfigUpdateBodySchema,
  payrollCreatePeriodBodySchema,
  payrollCurrentConfigQuerySchema,
  payrollExportQuerySchema,
  payrollHistoryQuerySchema,
  payrollIdParamsSchema,
  payrollListConfigsQuerySchema,
  payrollListPayslipsQuerySchema,
  payrollListPeriodsQuerySchema,
  payrollListRatesQuerySchema,
  payrollMassQuerySchema,
  payrollMyPayslipsQuerySchema,
  payrollPayBodySchema,
  payrollRateBodySchema,
  payrollRateUpdateBodySchema,
  payrollReasonBodySchema,
  payrollReportQuerySchema,
  payrollResolveRateQuerySchema,
  payrollSettingsBodySchema,
  payrollUpdatePeriodBodySchema,
} from "@ecoledigitale/contracts/src/v2/payroll";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createPayrollDeps, type PayrollDeps } from "../application/deps";
import { createPortRegistry, type PayrollPortRegistry, type PayrollPortsInput } from "../application/ports";
import * as calc from "../application/calculate";
import * as cfg from "../application/configs";
import * as periods from "../application/periods";
import * as q from "../application/queries";
import * as settings from "../application/settings";
import * as wf from "../application/workflow";
import { fallbackStaffName, staffInfoMap } from "../application/support";
import { HOUR_SOURCE_KINDS, type HourSourceKind } from "../domain/types";
import { payrollAuditAdapter } from "../infrastructure/audit-adapter";
import * as present from "./presenters";

export const PAYROLL_ROUTES_PREFIX = "/api/v1/payroll";
const CORE_FEATURE = "payroll.core";
const OWNER_FEATURE = "payroll.owner-validation";
const SOURCE_FEATURES: Readonly<Record<HourSourceKind, string>> = { SESSION: "payroll.session-source", ATTENDANCE: "payroll.attendance-source" };

export interface PluginRateLimiter {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

export interface PayrollPluginOptions {
  deps: PayrollDeps;
  /** Réservé à Fastify (`register(plugin, { prefix })`) : le préfixe est appliqué par Fastify lui-même. */
  prefix?: string;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde de route `requireFeature(key)` du module entitlements. */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  /** Variante programmatique : quelles origines d'heures le plan du tenant autorise-t-il ? (défaut : toutes) */
  isFeatureEnabled?: (ctx: RequestContext, featureKey: string) => Promise<boolean>;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  /** Limiteur de débit des exports et des calculs (facultatif). */
  rateLimiter?: PluginRateLimiter;
  heavyRateLimit?: { limit: number; windowMs: number };
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError(
    "Données invalides.",
    error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
  );
}

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function maybeFastifyValidation(error: unknown): unknown {
  const e = error as { validation?: unknown; statusCode?: number } | null;
  if (e && typeof e === "object" && e.validation) return new ValidationError("Requête invalide.");
  if (e && typeof e === "object" && typeof e.statusCode === "number" && e.statusCode === 400) return new ValidationError("Requête invalide.");
  return error;
}

const stripUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const GRANT = Symbol("payrollGrant");

export async function payrollPlugin(app: FastifyInstance, options: PayrollPluginOptions): Promise<void> {
  const { deps } = options;
  const perm = options.requirePermission;
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  /** Teste une permission sans faire échouer la requête (le garde rbac LÈVE `ForbiddenError`). */
  const has = async (request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean> => {
    try {
      await perm(permission).call(request.server, request, reply);
      return true;
    } catch (e) {
      if (e instanceof ForbiddenError) return false;
      throw e;
    }
  };

  const anyOf = (...permissions: string[]): preHandlerAsyncHookHandler =>
    async function anyOfGuard(request, reply) {
      for (const p of permissions) {
        if (await has(request, reply, p)) {
          (request as unknown as Record<symbol, { permission: string }>)[GRANT] = { permission: p };
          return;
        }
      }
      throw new ForbiddenError("Action non autorisée.", { details: { permission: permissions.join(" | ") } });
    };
  const grantOf = (request: FastifyRequest): string => (request as unknown as Record<symbol, { permission: string } | undefined>)[GRANT]?.permission ?? "";

  /** Permission(s) PUIS fonctionnalité(s) du plan (403 `entitlements.feature_not_available` avant lecture du corps). */
  const guard = (permissions: string | string[], ...features: string[]): preHandlerAsyncHookHandler[] => {
    const list = Array.isArray(permissions) ? permissions : [permissions];
    const guards: preHandlerAsyncHookHandler[] = [list.length === 1 ? perm(list[0] as string) : anyOf(...list)];
    if (options.requireFeature) {
      for (const feature of [CORE_FEATURE, ...features]) {
        const featureGuard = options.requireFeature(feature);
        guards.push(async function featureGate(request, reply) {
          return featureGuard.call(request.server, request, reply);
        });
      }
    }
    return guards;
  };

  const readCaps = (request: FastifyRequest): q.ReadCaps => ({ readAll: grantOf(request) === "payroll.payslip.read", readOwn: grantOf(request) === "payroll.payslip.read_own" });

  /** Origines d'heures autorisées par le plan du tenant ; sans vérificateur : toutes. */
  const enabledSources = async (ctx: RequestContext): Promise<HourSourceKind[]> => {
    if (!options.isFeatureEnabled) return [...HOUR_SOURCE_KINDS];
    const out: HourSourceKind[] = [];
    for (const kind of HOUR_SOURCE_KINDS) if (await options.isFeatureEnabled(ctx, SOURCE_FEATURES[kind])) out.push(kind);
    return out;
  };

  const throttle = async (request: FastifyRequest, reply: FastifyReply, bucket: string): Promise<void> => {
    if (!options.rateLimiter) return;
    const ctx = ctxOf(request);
    const rule = options.heavyRateLimit ?? { limit: 30, windowMs: 60_000 };
    const hit = await options.rateLimiter.hit(`payroll:${bucket}:${ctx.tenantId}:${ctx.userId ?? "system"}`, rule);
    if (!hit.allowed) {
      void reply.status(429).header("retry-after", String(Math.ceil(hit.retryAfterMs / 1000))).send(toErrorBody(new ConflictError("Trop de requêtes.", { code: "payroll.rate_limited" }), String(request.id)));
    }
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "payroll : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  const withNames = (items: readonly { payslip: Parameters<typeof present.payslipDto>[0]; staffName: string }[]) => items.map((i) => present.payslipDto(i.payslip, i.staffName));
  const named = async (ctx: RequestContext, p: Parameters<typeof present.payslipDto>[0]) => {
    const infos = await staffInfoMap(deps, ctx, [p.staffId]);
    return present.payslipDto(p, infos.get(p.staffId)?.displayName ?? fallbackStaffName(p.staffId));
  };

  await app.register(
    async (scope) => {
      scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));

      // ===== Réglages ======================================================================================
      scope.get("/settings", { preHandler: guard("payroll.settings.manage") }, async (req) => present.settingsDto(unwrapOrThrow(await settings.getPayrollSettings(deps, ctxOf(req)))));
      scope.put("/settings", { preHandler: guard("payroll.settings.manage") }, async (req) =>
        present.settingsDto(unwrapOrThrow(await settings.updatePayrollSettings(deps, ctxOf(req), stripUndefined(parse(payrollSettingsBodySchema, req.body))))),
      );

      // ===== Configurations de paie ===========================================================================
      scope.get("/configs", { preHandler: guard("payroll.config.read") }, async (req) => {
        const page = unwrapOrThrow(await cfg.listPayConfigs(deps, ctxOf(req), stripUndefined(parse(payrollListConfigsQuerySchema, req.query))));
        return { items: page.items.map(present.configDto), total: page.total };
      });
      scope.post("/configs", { preHandler: guard("payroll.config.manage") }, async (req, reply) => {
        const config = unwrapOrThrow(await cfg.createPayConfig(deps, ctxOf(req), stripUndefined(parse(payrollConfigBodySchema, req.body))));
        return reply.status(201).send(present.configDto(config));
      });
      scope.get("/configs/:id", { preHandler: guard("payroll.config.read") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        return present.configDto(unwrapOrThrow(await cfg.getPayConfig(deps, ctxOf(req), id)));
      });
      scope.put("/configs/:id", { preHandler: guard("payroll.config.manage") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        return present.configDto(unwrapOrThrow(await cfg.updatePayConfig(deps, ctxOf(req), { configId: id, ...stripUndefined(parse(payrollConfigUpdateBodySchema, req.body)) })));
      });
      scope.get("/staff/:id/config/current", { preHandler: guard("payroll.config.read") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const { onDate } = parse(payrollCurrentConfigQuerySchema, req.query);
        const today = deps.clock.now().toISOString().slice(0, 10);
        const r = unwrapOrThrow(await cfg.getCurrentConfig(deps, ctxOf(req), { staffId: id, onDate: onDate ?? today }));
        return { state: r.state, config: r.config ? present.configDto(r.config) : null };
      });

      // ===== Tarifs horaires (statique `resolve` AVANT `:id`) ============================================================
      scope.get("/rates/resolve", { preHandler: guard("payroll.rate.read") }, async (req) => {
        const qy = parse(payrollResolveRateQuerySchema, req.query);
        return unwrapOrThrow(await cfg.simulateRate(deps, ctxOf(req), { nodeId: qy.nodeId ?? null, staffId: qy.staffId, date: qy.date }));
      });
      scope.get("/rates", { preHandler: guard("payroll.rate.read") }, async (req) => {
        const page = unwrapOrThrow(await cfg.listHourlyRates(deps, ctxOf(req), stripUndefined(parse(payrollListRatesQuerySchema, req.query))));
        return { items: page.items.map(present.rateDto), total: page.total };
      });
      scope.post("/rates", { preHandler: guard("payroll.rate.manage") }, async (req, reply) => {
        const rate = unwrapOrThrow(await cfg.createHourlyRate(deps, ctxOf(req), stripUndefined(parse(payrollRateBodySchema, req.body))));
        return reply.status(201).send(present.rateDto(rate));
      });
      scope.put("/rates/:id", { preHandler: guard("payroll.rate.manage") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        return present.rateDto(unwrapOrThrow(await cfg.updateHourlyRate(deps, ctxOf(req), { rateId: id, ...stripUndefined(parse(payrollRateUpdateBodySchema, req.body)) })));
      });
      scope.delete("/rates/:id", { preHandler: guard("payroll.rate.manage") }, async (req, reply) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        unwrapOrThrow(await cfg.deleteHourlyRate(deps, ctxOf(req), id));
        return reply.status(204).send();
      });

      // ===== Périodes (statique `pending` AVANT `:id`) ====================================================================
      scope.get("/periods/pending", { preHandler: guard("payroll.period.manage") }, async (req) => {
        const p = unwrapOrThrow(await periods.getPendingPeriod(deps, ctxOf(req)));
        return { pending: p ? present.periodDto(p) : null };
      });
      scope.get("/periods", { preHandler: guard("payroll.period.manage") }, async (req) => {
        const page = unwrapOrThrow(await periods.listPeriods(deps, ctxOf(req), stripUndefined(parse(payrollListPeriodsQuerySchema, req.query))));
        return { items: page.items.map(present.periodDto), total: page.total };
      });
      scope.post("/periods", { preHandler: guard("payroll.period.manage") }, async (req, reply) => {
        const p = unwrapOrThrow(await periods.createPeriod(deps, ctxOf(req), stripUndefined(parse(payrollCreatePeriodBodySchema, req.body))));
        return reply.status(201).send(present.periodDto(p));
      });
      scope.get("/periods/:id", { preHandler: guard("payroll.period.manage") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        return present.periodDto(unwrapOrThrow(await periods.getPeriod(deps, ctxOf(req), id)));
      });
      scope.patch("/periods/:id", { preHandler: guard("payroll.period.manage") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const { status, ...patch } = stripUndefined(parse(payrollUpdatePeriodBodySchema, req.body));
        const ctx = ctxOf(req);
        let result = Object.keys(patch).length > 0 ? unwrapOrThrow(await periods.updatePeriod(deps, ctx, { periodId: id, ...patch })) : null;
        if (status) result = unwrapOrThrow(await periods.setPeriodStatus(deps, ctx, { periodId: id, status }));
        return present.periodDto(result ?? unwrapOrThrow(await periods.getPeriod(deps, ctx, id)));
      });
      scope.post("/periods/:id/calculate", { preHandler: guard("payroll.run.calculate") }, async (req, reply) => {
        await throttle(req, reply, "calculate");
        if (reply.sent) return reply;
        const { id } = parse(payrollIdParamsSchema, req.params);
        const body = stripUndefined(parse(payrollCalculateBodySchema, req.body));
        const ctx = ctxOf(req);
        const report = unwrapOrThrow(await calc.calculatePeriod(deps, ctx, { periodId: id, ...body, enabledSources: await enabledSources(ctx) }));
        return present.reportDto(report);
      });
      scope.get("/periods/:id/runs", { preHandler: guard("payroll.run.calculate") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const runs = unwrapOrThrow(await q.listRuns(deps, ctxOf(req), { periodId: id }));
        return { items: runs.map((r) => present.runDto(r, [])) };
      });
      scope.get("/runs/:id", { preHandler: guard("payroll.run.calculate") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const r = unwrapOrThrow(await q.getRun(deps, ctxOf(req), id));
        return present.runDto(r.run, r.items);
      });

      // ===== Bulletins (statiques `approve`, `pay` AVANT `:id`) =================================================================
      scope.get("/payslips", { preHandler: guard("payroll.payslip.read") }, async (req) => {
        const f = parse(payrollListPayslipsQuerySchema, req.query);
        const { status, ...rest } = f;
        const page = unwrapOrThrow(await q.listPayslips(deps, ctxOf(req), stripUndefined({ ...rest, statuses: status ? [status] : undefined })));
        return { items: withNames(page.items), total: page.total };
      });
      scope.post("/payslips/approve", { preHandler: guard("payroll.payslip.approve") }, async (req, reply) => {
        const body = parse(payrollApproveBodySchema, req.body);
        const ownerApproval = await has(req, reply, "payroll.payslip.approve_owner");
        return unwrapOrThrow(await wf.approvePayslips(deps, ctxOf(req), { selection: body, caps: { ownerApproval } }));
      });
      scope.post("/payslips/pay", { preHandler: guard("payroll.payslip.pay") }, async (req) => {
        const body = parse(payrollPayBodySchema, req.body);
        const selection: wf.Selection = "all" in body ? { all: true, periodId: body.periodId } : { payslipIds: body.payslipIds };
        return unwrapOrThrow(await wf.payPayslips(deps, ctxOf(req), { selection, method: body.method, ...(body.reference ? { reference: body.reference } : {}) }));
      });
      scope.get("/payslips/:id", { preHandler: guard(["payroll.payslip.read", "payroll.payslip.read_own"]) }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const d = unwrapOrThrow(await q.getPayslipDetail(deps, ctxOf(req), { payslipId: id, caps: readCaps(req) }));
        return detailDto(d);
      });
      scope.get("/payslips/:id/data", { preHandler: guard(["payroll.payslip.read", "payroll.payslip.read_own"]) }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        return present.dataDto(unwrapOrThrow(await q.getPayslipData(deps, ctxOf(req), { payslipId: id, caps: readCaps(req) })));
      });
      scope.post("/payslips/:id/cancel", { preHandler: guard("payroll.payslip.cancel") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const { reason } = parse(payrollReasonBodySchema, req.body);
        const p = unwrapOrThrow(await wf.cancelPayslip(deps, ctxOf(req), { payslipId: id, reason }));
        return named(ctxOf(req), p);
      });
      scope.post("/payslips/:id/dispute", { preHandler: guard("payroll.payslip.approve") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const { reason } = parse(payrollReasonBodySchema, req.body);
        return named(ctxOf(req), unwrapOrThrow(await wf.disputePayslip(deps, ctxOf(req), { payslipId: id, reason })));
      });
      scope.patch("/payslips/:id/adjustments", { preHandler: guard("payroll.payslip.adjust") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const body = parse(payrollAdjustBodySchema, req.body);
        const p = unwrapOrThrow(await wf.adjustPayslip(deps, ctxOf(req), { payslipId: id, ...(body.add ? { add: body.add } : {}), ...(body.remove ? { removeIds: body.remove } : {}) }));
        return named(ctxOf(req), p);
      });
      scope.post("/payslips/:id/notify", { preHandler: guard("payroll.payslip.notify") }, async (req, reply) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        unwrapOrThrow(await wf.notifyPayslip(deps, ctxOf(req), id));
        return reply.status(202).send({ requested: true });
      });

      // ===== Historique et rapports =====================================================================================
      scope.get("/history/export", { preHandler: guard("payroll.payslip.read") }, async (req, reply) => {
        await throttle(req, reply, "export");
        if (reply.sent) return reply;
        const f = stripUndefined(parse(payrollExportQuerySchema, req.query));
        const out = unwrapOrThrow(await q.exportPayslipsCsv(deps, ctxOf(req), { ...f, stopped: true }));
        return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${out.filename}"`).header("cache-control", "no-store").send(out.csv);
      });
      scope.get("/history", { preHandler: guard("payroll.payslip.read") }, async (req) => {
        const page = unwrapOrThrow(await q.listHistory(deps, ctxOf(req), stripUndefined(parse(payrollHistoryQuerySchema, req.query))));
        return { items: withNames(page.items), total: page.total };
      });
      scope.get("/reports/summary", { preHandler: guard("payroll.report.read") }, async (req) => {
        const f = stripUndefined(parse(payrollReportQuerySchema, req.query));
        const r = unwrapOrThrow(await q.reportSummary(deps, ctxOf(req), f));
        return present.summaryDto(r.rows, r.sources, r.filteredTotal.amount);
      });
      scope.get("/reports/export", { preHandler: guard("payroll.report.read") }, async (req, reply) => {
        await throttle(req, reply, "export");
        if (reply.sent) return reply;
        const f = stripUndefined(parse(payrollReportQuerySchema, req.query));
        const out = unwrapOrThrow(await q.exportPayslipsCsv(deps, ctxOf(req), f));
        return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${out.filename}"`).header("cache-control", "no-store").send(out.csv);
      });

      // ===== Espace enseignant : l'identité vient du COMPTE, jamais d'un paramètre ====================================================
      scope.get("/my/payslips", { preHandler: guard("payroll.payslip.read_own") }, async (req) => {
        const page = unwrapOrThrow(await q.listMyPayslips(deps, ctxOf(req), stripUndefined(parse(payrollMyPayslipsQuerySchema, req.query))));
        return { items: withNames(page.items), total: page.total };
      });
      scope.get("/my/payslips/:id", { preHandler: guard("payroll.payslip.read_own") }, async (req) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        // même cas d'usage que la gestion, mais SEULEMENT en tant que titulaire : un compte de gestion passe par /payslips/:id
        return present.dataDto(unwrapOrThrow(await q.getPayslipData(deps, ctxOf(req), { payslipId: id, caps: { readAll: false, readOwn: true } })));
      });

      // ===== Propriétaire =====================================================================================================
      scope.get("/owner/mass", { preHandler: guard("payroll.report.read", OWNER_FEATURE) }, async (req) => {
        const f = stripUndefined(parse(payrollMassQuerySchema, req.query));
        const r = unwrapOrThrow(await q.ownerMass(deps, ctxOf(req), f));
        return present.massDto(r.periods, r.counted);
      });
      scope.post("/owner/payslips/:id/validate", { preHandler: guard("payroll.payslip.approve", OWNER_FEATURE) }, async (req, reply) => {
        const { id } = parse(payrollIdParamsSchema, req.params);
        const ownerApproval = await has(req, reply, "payroll.payslip.approve_owner");
        // la MÊME action métier que l'écran du gestionnaire (AC7.1) : une seule implémentation
        return unwrapOrThrow(await wf.approvePayslips(deps, ctxOf(req), { selection: { payslipIds: [id] }, caps: { ownerApproval } }));
      });
    },
  );

  function detailDto(d: q.PayslipDetail) {
    return {
      payslip: present.payslipDto(d.payslip, d.staffName),
      lines: d.lines.map(present.lineDto),
      adjustments: d.adjustments.map(present.adjustmentDto),
      events: d.events.map(present.eventDto),
      calcDetails: d.payslip.calcDetails,
    };
  }
}

// ---------------------------------------------------------------------------
// Registre de ports et contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module payroll (posé par `setup`). */
    payrollPorts: PayrollPortRegistry;
  }
}

/** À appeler par les modules voisins (`scheduling`, `attendance`, `people`, `academic`) dans leur `setup(app, runtime)`. */
export function registerPayrollPorts(app: FastifyInstance, ports: PayrollPortsInput): void {
  if (!app.hasDecorator("payrollPorts")) app.decorate("payrollPorts", createPortRegistry());
  app.payrollPorts.register(ports);
}

/** Instance RACINE : pose le registre de ports que les modules voisins renseignent (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("payrollPorts")) app.decorate("payrollPorts", createPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/payroll`). */
export default async function payrollModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("payrollPorts")) app.decorate("payrollPorts", createPortRegistry());
  const deps = createPayrollDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: payrollAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    ports: app.payrollPorts.current,
  });
  await app.register(payrollPlugin, {
    deps,
    prefix: "",
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    isFeatureEnabled: (ctx, featureKey) => runtime.entitlements.isFeatureEnabled(ctx, featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: {
      hit: async (key, rule) => {
        const d = await runtime.rateLimiter.hit(key, rule);
        return { allowed: d.allowed, retryAfterMs: d.retryAfterMs };
      },
    },
  });
}
