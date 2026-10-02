/**
 * Plugin Fastify du module stateassign — routes SANS préfixe (le registre applique `/api/v1/stateassign`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la RACINE
 * avec le registre de ports (`app.stateassignPorts`) que les adaptateurs de plateforme renseignent.
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). Aucune identité lue d'un en-tête client.
 *  - Autorisation : `requirePermission('stateassign.…')` du module rbac, jamais un rôle codé en dur ; les permissions sensibles
 *    (vérifier, gérer, amender, réglages) exigent la MFA (garde rbac). Les ACTES HUMAINS sont de plus refusés à un acteur
 *    non humain par le cas d'usage ET par la base. Périmètre : un contexte lié à un établissement ne voit que celui-ci.
 *  - Feature : `stateassign.core` exigée sur toutes les routes (entitlements) ; la passerelle future exige `stateassign.gateway`.
 *  - Famille : `GET /children/:studentId/assignment` (parent lié, relu à chaque requête) : le STATUT seulement, jamais les montants
 *    de l'État, les échéances, les écarts, les contrôles.
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `stateassign.*` ; aucun 500 pour un refus prévisible de la base.
 *  - Réponses `Cache-Control: no-store` (données de mineurs et montants).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, z, type ZodTypeAny } from "zod";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  activateAssignmentBodySchema,
  addAssignmentDocumentBodySchema,
  amendAssignmentBodySchema,
  assignmentListQuerySchema,
  cancelReceivableBodySchema,
  completeControlBodySchema,
  controlsDueQuerySchema,
  createExportFormatBodySchema,
  endAssignmentBodySchema,
  exportFormatListQuerySchema,
  exportQuerySchema,
  planControlBodySchema,
  receivableListQuerySchema,
  receivablesAgingQuerySchema,
  reconciliationReportQuerySchema,
  recordAssignmentBodySchema,
  rejectAssignmentBodySchema,
  resolveControlBodySchema,
  resumeAssignmentBodySchema,
  scheduleReceivableBodySchema,
  stateassignSettingsQuerySchema,
  stateassignSummaryQuerySchema,
  stateassignUpdateSettingsBodySchema,
  stateassignUuidSchema,
  suspendAssignmentBodySchema,
  transferOutAssignmentBodySchema,
  updateAssignmentBodySchema,
  updateExportFormatBodySchema,
  updateReceivableBodySchema,
  verifyAssignmentBodySchema,
  waiveControlBodySchema,
  withdrawAssignmentDocumentBodySchema,
  exportDatasetSchema,
} from "@ecoledigitale/contracts/src/v2/stateassign";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { actOnAssignment, amendAssignment, getAssignmentDetail, getChildAssignment, listAssignmentPage, recordAssignment, updateAssignment } from "../application/assignments";
import { completeControl, getAttendanceFacts, listControlsReport, planControl, resolveControlAnomaly, waiveControl } from "../application/controls";
import { createStateassignDeps, type StateassignDeps } from "../application/deps";
import { addAssignmentDocument, withdrawAssignmentDocument } from "../application/documents";
import { createStateassignPortRegistry, type StateassignPortRegistry } from "../application/port-registry";
import type { DocumentReadCaps, StateassignPorts } from "../application/ports";
import { cancelReceivable, getReceivableHistory, getReceivablesAging, listReceivablePage, scheduleReceivable, updateReceivable } from "../application/receivables";
import { reconcileAssignment } from "../application/reconciliation";
import { createFormat, exportCsv, fetchFromGateway, getExportCatalog, getGatewayStatus, getReconciliationReport, getSummary, listFormats, pushCertificateToGateway, updateFormat } from "../application/reports";
import { getInstitutionSettings, updateInstitutionSettings } from "../application/settings";
import { HTTP_STATUS_BY_STATEASSIGN_CODE, StateassignCode, forbidden, validation } from "../domain/errors";
import { stateassignAuditAdapter } from "../infrastructure/audit-adapter";
import { FEATURES, PERMISSIONS as P, createPermissionKit, type PermissionKit } from "./guards";

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module stateassign (posé par `setup`). */
    stateassignPorts: StateassignPortRegistry;
  }
}

/** À appeler par `platform/adapters` (`wireApiPorts`) : enregistre (ou remplace) des ports ; relus à chaque appel. */
export function registerStateassignPorts(app: FastifyInstance, ports: Partial<StateassignPorts>): void {
  if (!app.hasDecorator("stateassignPorts")) app.decorate("stateassignPorts", createStateassignPortRegistry());
  app.stateassignPorts.register(ports);
}

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError("Données invalides.", error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })), { code: StateassignCode.INVALID_INPUT });
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

const idOf = (params: unknown, key = "id"): string => parse(stateassignUuidSchema, (params as Record<string, unknown> | undefined)?.[key]);

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

const noStore = (reply: FastifyReply): void => {
  void reply.header("Cache-Control", "no-store");
};

export interface StateassignPluginOptions {
  deps: StateassignDeps;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  /** Garde de feature (entitlements) ; absente = toutes actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
}

export async function stateassignPlugin(app: FastifyInstance, options: StateassignPluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(error);
    if (appError.httpStatus >= 500 && !(appError.code in HTTP_STATUS_BY_STATEASSIGN_CODE)) request.log.error({ err: error }, "stateassign : erreur inattendue");
    noStore(reply);
    const status = HTTP_STATUS_BY_STATEASSIGN_CODE[appError.code] ?? appError.httpStatus;
    void reply.status(status).send({ ...toErrorBody(appError, String(request.id)), status });
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    scope.addHook("onSend", async (_request, reply, payload) => {
      if (!reply.hasHeader("Cache-Control")) noStore(reply);
      return payload;
    });

    const core = options.requireFeature ? options.requireFeature(FEATURES.core) : undefined;
    const gateway = options.requireFeature ? options.requireFeature(FEATURES.gateway) : undefined;
    /** Permission(s) puis feature `core`. */
    const guard = (...permissions: string[]): preHandlerAsyncHookHandler[] => [kit.anyOf(...permissions), ...(core ? [core] : [])];

    /** Droits de lecture sur la GED (sondés, jamais présumés) : transmis au port `documents` pour vérifier la pièce. */
    const documentCaps = async (req: FastifyRequest, reply: FastifyReply): Promise<DocumentReadCaps> => ({
      read: await kit.has(scope, req, reply, "documents.read"),
      readRestricted: await kit.has(scope, req, reply, "documents.read.restricted"),
      manage: await kit.has(scope, req, reply, "documents.manage"),
    });

    // ===== Contexte ===========================================================================================
    scope.get("/me/context", { preHandler: [kit.anyOf(...Object.values(P)), ...(core ? [core] : [])] }, async (req) => {
      const ctx = ctxOf(req);
      return { features: { core: true, gateway: gateway ? false : false }, institutionId: ctx.institutionId ?? null };
    });

    // ===== Réglages ===========================================================================================
    scope.get("/settings", { preHandler: guard(P.read, P.settingsManage) }, async (req) => unwrapOrThrow(await getInstitutionSettings(deps, ctxOf(req), parse(stateassignSettingsQuerySchema, req.query).institutionId)));
    scope.put("/settings", { preHandler: guard(P.settingsManage) }, async (req) =>
      unwrapOrThrow(await updateInstitutionSettings(deps, ctxOf(req), parse(stateassignSettingsQuerySchema, req.query).institutionId, parse(stateassignUpdateSettingsBodySchema, req.body))),
    );

    // ===== Dossiers ===========================================================================================
    scope.get("/assignments", { preHandler: guard(P.read) }, async (req) => unwrapOrThrow(await listAssignmentPage(deps, ctxOf(req), parse(assignmentListQuerySchema, req.query))));
    scope.post("/assignments", { preHandler: guard(P.record) }, async (req, reply) => reply.status(201).send(unwrapOrThrow(await recordAssignment(deps, ctxOf(req), parse(recordAssignmentBodySchema, req.body)))));
    scope.get("/assignments/:id", { preHandler: guard(P.read) }, async (req) => unwrapOrThrow(await getAssignmentDetail(deps, ctxOf(req), idOf(req.params))));
    scope.patch("/assignments/:id", { preHandler: guard(P.record) }, async (req) => unwrapOrThrow(await updateAssignment(deps, ctxOf(req), idOf(req.params), parse(updateAssignmentBodySchema, req.body))));

    scope.post("/assignments/:id/verify", { preHandler: guard(P.verify) }, async (req) => {
      const b = parse(verifyAssignmentBodySchema, req.body);
      return unwrapOrThrow(await actOnAssignment(deps, ctxOf(req), idOf(req.params), "verify", { note: b.note, rowVersion: b.rowVersion }));
    });
    scope.post("/assignments/:id/reject", { preHandler: guard(P.verify) }, async (req) => {
      const b = parse(rejectAssignmentBodySchema, req.body);
      return unwrapOrThrow(await actOnAssignment(deps, ctxOf(req), idOf(req.params), "reject", { reason: b.reason, rowVersion: b.rowVersion }));
    });
    scope.post("/assignments/:id/activate", { preHandler: guard(P.manage) }, async (req) =>
      unwrapOrThrow(await actOnAssignment(deps, ctxOf(req), idOf(req.params), "activate", { rowVersion: parse(activateAssignmentBodySchema, req.body).rowVersion })),
    );
    scope.post("/assignments/:id/suspend", { preHandler: guard(P.manage) }, async (req) => {
      const b = parse(suspendAssignmentBodySchema, req.body);
      return unwrapOrThrow(await actOnAssignment(deps, ctxOf(req), idOf(req.params), "suspend", { reason: b.reason, rowVersion: b.rowVersion }));
    });
    scope.post("/assignments/:id/resume", { preHandler: guard(P.manage) }, async (req) =>
      unwrapOrThrow(await actOnAssignment(deps, ctxOf(req), idOf(req.params), "resume", { rowVersion: parse(resumeAssignmentBodySchema, req.body).rowVersion })),
    );
    scope.post("/assignments/:id/end", { preHandler: guard(P.manage) }, async (req) => {
      const b = parse(endAssignmentBodySchema, req.body);
      return unwrapOrThrow(await actOnAssignment(deps, ctxOf(req), idOf(req.params), "end", { endedOn: b.endedOn, reason: b.reason, rowVersion: b.rowVersion }));
    });
    scope.post("/assignments/:id/transfer-out", { preHandler: guard(P.manage) }, async (req) => {
      const b = parse(transferOutAssignmentBodySchema, req.body);
      return unwrapOrThrow(await actOnAssignment(deps, ctxOf(req), idOf(req.params), "transfer-out", { endedOn: b.endedOn, reason: b.reason, rowVersion: b.rowVersion }));
    });
    scope.post("/assignments/:id/amend", { preHandler: guard(P.amend) }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await amendAssignment(deps, ctxOf(req), idOf(req.params), parse(amendAssignmentBodySchema, req.body)))),
    );
    scope.post("/assignments/:id/reconcile", { preHandler: guard(P.reconcile) }, async (req) => unwrapOrThrow(await reconcileAssignment(deps, ctxOf(req), idOf(req.params), { force: true })));

    // ===== Contrôles ==========================================================================================
    scope.post("/assignments/:id/controls", { preHandler: guard(P.controlPerform) }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await planControl(deps, ctxOf(req), idOf(req.params), parse(planControlBodySchema, req.body)))),
    );
    scope.get("/assignments/:id/attendance-facts", { preHandler: guard(P.read, P.controlPerform) }, async (req) => {
      const q = parse(z.object({ periodId: stateassignUuidSchema.optional() }).strict(), req.query);
      return { facts: unwrapOrThrow(await getAttendanceFacts(deps, ctxOf(req), idOf(req.params), q.periodId ?? null)) };
    });
    scope.post("/controls/:id/complete", { preHandler: guard(P.controlPerform) }, async (req) => unwrapOrThrow(await completeControl(deps, ctxOf(req), idOf(req.params), parse(completeControlBodySchema, req.body))));
    scope.post("/controls/:id/waive", { preHandler: guard(P.controlPerform) }, async (req) => unwrapOrThrow(await waiveControl(deps, ctxOf(req), idOf(req.params), parse(waiveControlBodySchema, req.body))));
    scope.post("/controls/:id/resolve", { preHandler: guard(P.controlPerform) }, async (req) => unwrapOrThrow(await resolveControlAnomaly(deps, ctxOf(req), idOf(req.params), parse(resolveControlBodySchema, req.body))));

    // ===== Documents ==========================================================================================
    scope.post("/assignments/:id/documents", { preHandler: guard(P.documentManage) }, async (req, reply) => {
      const body = parse(addAssignmentDocumentBodySchema, req.body);
      return reply.status(201).send(unwrapOrThrow(await addAssignmentDocument(deps, ctxOf(req), idOf(req.params), body, await documentCaps(req, reply))));
    });
    scope.post("/documents/:id/withdraw", { preHandler: guard(P.documentManage) }, async (req) => unwrapOrThrow(await withdrawAssignmentDocument(deps, ctxOf(req), idOf(req.params), parse(withdrawAssignmentDocumentBodySchema, req.body))));

    // ===== Créances sur l'État ================================================================================
    scope.get("/receivables", { preHandler: guard(P.read) }, async (req) => unwrapOrThrow(await listReceivablePage(deps, ctxOf(req), parse(receivableListQuerySchema, req.query))));
    scope.get("/receivables/aging", { preHandler: guard(P.read) }, async (req) => unwrapOrThrow(await getReceivablesAging(deps, ctxOf(req), parse(receivablesAgingQuerySchema, req.query))));
    scope.post("/assignments/:id/receivables", { preHandler: guard(P.receivableManage) }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await scheduleReceivable(deps, ctxOf(req), idOf(req.params), parse(scheduleReceivableBodySchema, req.body)))),
    );
    scope.patch("/receivables/:id", { preHandler: guard(P.receivableManage) }, async (req) => unwrapOrThrow(await updateReceivable(deps, ctxOf(req), idOf(req.params), parse(updateReceivableBodySchema, req.body))));
    scope.post("/receivables/:id/cancel", { preHandler: guard(P.receivableManage) }, async (req) => unwrapOrThrow(await cancelReceivable(deps, ctxOf(req), idOf(req.params), parse(cancelReceivableBodySchema, req.body))));
    scope.get("/receivables/:id/history", { preHandler: guard(P.read) }, async (req) => unwrapOrThrow(await getReceivableHistory(deps, ctxOf(req), idOf(req.params))));

    // ===== États ==============================================================================================
    scope.get("/reports/summary", { preHandler: guard(P.read) }, async (req) => unwrapOrThrow(await getSummary(deps, ctxOf(req), parse(stateassignSummaryQuerySchema, req.query))));
    scope.get("/reports/reconciliation", { preHandler: guard(P.read, P.reconcile) }, async (req) => unwrapOrThrow(await getReconciliationReport(deps, ctxOf(req), parse(reconciliationReportQuerySchema, req.query))));
    scope.get("/reports/controls-due", { preHandler: guard(P.read, P.controlPerform) }, async (req) => unwrapOrThrow(await listControlsReport(deps, ctxOf(req), parse(controlsDueQuerySchema, req.query))));

    // ===== Exports (formats en données) =======================================================================
    scope.get("/exports/catalog", { preHandler: guard(P.export, P.settingsManage) }, async () => getExportCatalog());
    scope.get("/export-formats", { preHandler: guard(P.export, P.settingsManage) }, async (req) => unwrapOrThrow(await listFormats(deps, ctxOf(req), parse(exportFormatListQuerySchema, req.query))));
    scope.post("/export-formats", { preHandler: guard(P.settingsManage) }, async (req, reply) => reply.status(201).send(unwrapOrThrow(await createFormat(deps, ctxOf(req), parse(createExportFormatBodySchema, req.body)))));
    scope.patch("/export-formats/:id", { preHandler: guard(P.settingsManage) }, async (req) => unwrapOrThrow(await updateFormat(deps, ctxOf(req), idOf(req.params), parse(updateExportFormatBodySchema, req.body))));
    const exportOf = async (req: FastifyRequest): Promise<{ filename: string; body: string; meta: ReturnType<typeof unwrapOrThrow<Awaited<ReturnType<typeof exportCsv>> extends Result<infer T> ? T : never>>["meta"] }> => {
      const dataset = parse(exportDatasetSchema, String((req.params as { dataset?: string }).dataset ?? "").toUpperCase());
      const q = parse(exportQuerySchema, req.query);
      return unwrapOrThrow(await exportCsv(deps, ctxOf(req), { dataset, ...q }));
    };
    scope.get("/exports/:dataset", { preHandler: guard(P.export) }, async (req, reply) => {
      const out = await exportOf(req);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${out.filename}"`)
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Export-Truncated", String(out.meta.truncated))
        .header("X-Export-Row-Count", String(out.meta.rowCount))
        .header("X-Export-Total-Count", String(out.meta.totalCount))
        .header("X-Export-Max-Rows", String(out.meta.maxRows))
        .header("Access-Control-Expose-Headers", "X-Export-Truncated, X-Export-Row-Count, X-Export-Total-Count, X-Export-Max-Rows, Content-Disposition")
        .send(out.body);
    });
    scope.get("/exports/:dataset/meta", { preHandler: guard(P.export) }, async (req) => (await exportOf(req)).meta);

    // ===== Passerelle (future : NotConfigured en V1) ==========================================================
    scope.get("/gateway/status", { preHandler: guard(P.read) }, async () => getGatewayStatus(deps));
    scope.post("/gateway/fetch", { preHandler: [kit.anyOf(P.record), ...(core ? [core] : []), ...(gateway ? [gateway] : [])] }, async (req) => {
      const body = parse(z.object({ reference: z.string().trim().min(1).max(120) }).strict(), req.body);
      return unwrapOrThrow(await fetchFromGateway(deps, ctxOf(req), body.reference));
    });
    scope.post("/assignments/:id/gateway/push-certificate", { preHandler: [kit.anyOf(P.manage), ...(core ? [core] : []), ...(gateway ? [gateway] : [])] }, async (req) => {
      const body = parse(z.object({ documentRef: stateassignUuidSchema }).strict(), req.body);
      return unwrapOrThrow(await pushCertificateToGateway(deps, ctxOf(req), { assignmentId: idOf(req.params), documentRef: body.documentRef }));
    });

    // ===== Famille ============================================================================================
    scope.get("/children/:studentId/assignment", { preHandler: guard(P.childRead) }, async (req) => {
      const ctx = ctxOf(req);
      const studentId = idOf(req.params, "studentId");
      // Lien de tutelle relu à CHAQUE requête ; un enfant non lié répond comme un enfant inconnu (404, aucune fuite).
      const linked = ctx.userId ? await deps.ports.guardianship.isGuardianOf(ctx, ctx.userId, studentId) : false;
      if (!linked) throw NotFoundError.of("Élève", studentId, { code: StateassignCode.ASSIGNMENT_NOT_FOUND });
      return unwrapOrThrow(await getChildAssignment(deps, ctx, studentId));
    });
  });
}

// ---------------------------------------------------------------------------
// Assemblage par le registre
// ---------------------------------------------------------------------------

export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("stateassignPorts")) app.decorate("stateassignPorts", createStateassignPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/stateassign`). */
export default async function stateassignModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("stateassignPorts")) app.decorate("stateassignPorts", createStateassignPortRegistry());
  const num = (key: string): number | undefined => {
    const n = Number(runtime.env[key]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const exportMax = num("STATEASSIGN_EXPORT_MAX_ROWS");
  const deps = createStateassignDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: stateassignAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.stateassignPorts.current,
    config: { ...(exportMax ? { exportMaxRows: Math.min(exportMax, 500_000) } : {}) },
  });
  await app.register(stateassignPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    resolveContext: (request) => runtime.resolveContext(request),
    requireFeature: (key) => runtime.entitlements.requireFeature(key),
  });
}

export { forbidden, validation, ForbiddenError };
