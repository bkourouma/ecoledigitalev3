/**
 * Plugin Fastify du module imports — routes SANS préfixe (le registre applique `/api/v1/imports`). Contrat d'assemblage
 * `(app, runtime)` + `setup(app, runtime)` qui décore la RACINE avec le registre de ports (`app.importsPorts`) que les
 * adaptateurs de plateforme renseignent.
 *
 *  - Authentification : `request.ctx` posé en amont. Aucune identité lue d'un en-tête client.
 *  - Autorisation : `requirePermission('imports.…')` du module rbac ET les permissions du module CIBLE de l'importeur
 *    (un importeur d'élèves exige le droit de créer des élèves), vérifiées à l'upload, au mapping, à la validation et au
 *    lancement. Les soldes financiers sont sensibles : MFA exigée. Aucun rôle codé en dur.
 *  - Visibilité : un import n'est lisible que par son auteur ou par `imports.manage` (les autres reçoivent 404).
 *  - Le fichier est le CORPS BRUT de `POST /jobs` (nom en paramètre) ; son type réel est contrôlé sur les octets.
 *  - Limiteur de débit par utilisateur sur les écritures ; quotas par tenant dans les cas d'usage.
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `imports.*` ; jamais de message interne.
 *  - Réponses `Cache-Control: no-store` (données personnelles) ; téléchargements `attachment` + `nosniff`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, z, type ZodTypeAny } from "zod";
import { UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  importCancelBodySchema,
  importChoicesQuerySchema,
  importCreateTemplateBodySchema,
  importListJobsQuerySchema,
  importListRowsQuerySchema,
  importListTemplatesQuerySchema,
  importMappingBodySchema,
  importReportQuerySchema,
  importRunBodySchema,
  importTemplateFileQuerySchema,
  importUpdateSettingsBodySchema,
  importUpdateTemplateBodySchema,
  importUploadQuerySchema,
  importerKeySchema,
  importsUuidSchema,
  type ImporterDescriptor,
} from "@ecoledigitale/contracts/src/v2/imports";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { createImportsDeps, type ImportsDeps } from "../application/deps";
import { cancelImportJob, deleteImportJob, getImportJob, listImportJobs, listOptionChoices, loadImportJobRecord, setImportMapping, type Viewer } from "../application/jobs";
import { createImportsPortRegistry, type ImportsPortRegistry } from "../application/port-registry";
import type { ImportPorts } from "../application/ports";
import { buildImportReportFile, buildTemplateFile, listImportRows } from "../application/report";
import { getImportReport, requestImportRun } from "../application/run";
import { getImportSettings, updateImportSettings } from "../application/settings";
import { createMappingTemplate, listMappingTemplates, removeMappingTemplate, updateMappingTemplate } from "../application/templates";
import { uploadImportFile } from "../application/upload";
import { getImportPreview, requestImportValidation } from "../application/validate";
import { RateLimitedError, notFound } from "../domain/errors";
import type { ImporterDef } from "../domain/types";
import { IMPORTER_LIST, findImporter } from "../importers/registry";
import { importsAuditAdapter } from "../infrastructure/audit-adapter";
import { createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module imports (posé par `setup`). */
    importsPorts: ImportsPortRegistry;
  }
}

/** À appeler par `platform/adapters` (`wireApiPorts`) : enregistre (ou remplace) des ports ; relus à chaque appel. */
export function registerImportsPorts(app: FastifyInstance, ports: Partial<ImportPorts>): void {
  if (!app.hasDecorator("importsPorts")) app.decorate("importsPorts", createImportsPortRegistry());
  app.importsPorts.register(ports);
}

export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("importsPorts")) app.decorate("importsPorts", createImportsPortRegistry());
}

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError("Données invalides.", error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })));
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function maybeFastifyValidation(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const e = error as { statusCode?: number };
    if (e.statusCode === 413) return new ValidationError("Le fichier est trop volumineux.", [{ path: ["file"], message: "Le fichier est trop volumineux.", code: "imports.file_too_large" }], { code: "imports.file_too_large" });
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "imports.invalid_value" });
  }
  return error;
}

const idParams = (params: unknown): string => parse(importsUuidSchema, (params as { id?: unknown } | undefined)?.id);

const HTTP_RATE = Object.freeze({
  upload: { limit: 20, windowMs: 60_000 },
  write: { limit: 60, windowMs: 60_000 },
  download: { limit: 60, windowMs: 60_000 },
});

export interface RateLimiterLike {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; count: number; retryAfterMs: number }>;
}

export interface ImportsPluginOptions {
  deps: ImportsDeps;
  requirePermission: (permission: string) => import("fastify").preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  rateLimiter?: RateLimiterLike;
}

const noStore = (reply: FastifyReply): void => {
  void reply.header("Cache-Control", "no-store");
};

function descriptorOf(importer: ImporterDef, canUse: boolean, canRun: boolean): ImporterDescriptor {
  return {
    key: importer.key,
    label: importer.label,
    description: importer.description,
    sensitive: importer.sensitive,
    supportsUpdate: importer.supportsUpdate,
    columns: importer.columns.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type, description: c.description, example: c.example })),
    options: importer.options.map((o) => ({ ...o })),
    importPermission: importer.importPermission,
    targetPermissions: [...importer.targetPermissions],
    conditionalPermissions: importer.conditionalPermissions.map((c) => ({ ...c })),
    canUse,
    canRun,
  };
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function importsPlugin(app: FastifyInstance, options: ImportsPluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "imports : erreur inattendue");
    noStore(reply);
    if (appError instanceof RateLimitedError) {
      void reply.header("Retry-After", String(appError.retryAfterSec));
      void reply.status(429).send({ ...toErrorBody(appError, String(request.id)), status: 429 });
      return;
    }
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    scope.addHook("onSend", async (_request, reply, payload) => {
      if (!reply.hasHeader("Cache-Control")) noStore(reply);
      reply.header("X-Content-Type-Options", "nosniff");
      return payload;
    });
    // Le type annoncé ne fait pas foi : tout corps non JSON est lu brut (le type réel est contrôlé sur les octets).
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: deps.config.hardMaxFileBytes + 64 * 1024 }, (_req, body, done) => done(null, body));

    const throttle = async (request: FastifyRequest, kind: keyof typeof HTTP_RATE): Promise<void> => {
      if (!options.rateLimiter) return;
      const ctx = ctxOf(request);
      const d = await options.rateLimiter.hit(`imports:${kind}:${ctx.tenantId}:${ctx.userId ?? request.ip}`, HTTP_RATE[kind]);
      if (!d.allowed) {
        const retry = Math.max(1, Math.ceil(d.retryAfterMs / 1000));
        throw new RateLimitedError("Trop de requêtes : réessayez dans un instant.", retry, { window: "minute" });
      }
    };
    const viewerOf = async (req: FastifyRequest, reply: FastifyReply): Promise<Viewer> => ({ manage: await kit.has(scope, req, reply, P.manage) });
    const requireAll = (req: FastifyRequest, reply: FastifyReply, permissions: readonly string[]): Promise<void> => kit.requireAll(scope, req, reply, permissions);

    /** Permissions d'un importeur au niveau « créer / préparer » : celles d'imports ET du module cible. */
    const prepare = (importer: ImporterDef, extra: readonly string[] = []): string[] => [P.create, ...importer.targetPermissions, ...extra];

    const allowed = async (req: FastifyRequest, reply: FastifyReply, permissions: readonly string[]): Promise<boolean> => {
      for (const p of permissions) if (!(await kit.has(scope, req, reply, p))) return false;
      return true;
    };

    // ===== Importeurs et modèles de fichier ===================================================================
    scope.get("/importers", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const items: ImporterDescriptor[] = [];
      for (const importer of IMPORTER_LIST) {
        const canUse = await allowed(req, reply, prepare(importer));
        const canRun = canUse && (await allowed(req, reply, [importer.importPermission]));
        items.push(descriptorOf(importer, canUse, canRun));
      }
      return { items };
    });
    scope.get("/importers/:key/template", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const key = parse(importerKeySchema, (req.params as { key?: unknown }).key);
      const q = parse(importTemplateFileQuerySchema, req.query);
      const file = unwrapOrThrow(await buildTemplateFile(key, q.format));
      return reply
        .header("Content-Type", file.contentType)
        .header("Content-Disposition", contentDisposition(file.fileName))
        .send(Buffer.from(file.bytes));
    });

    scope.get("/importers/:key/options/:option/choices", { preHandler: kit.require(P.create) }, async (req, reply) => {
      const params = req.params as { key?: unknown; option?: unknown };
      const key = parse(importerKeySchema, params.key);
      const importer = findImporter(key);
      if (!importer) throw notFound("imports.importer_unknown", "Importeur", key);
      await requireAll(req, reply, prepare(importer));
      const q = parse(importChoicesQuerySchema, req.query);
      return { items: unwrapOrThrow(await listOptionChoices(deps, ctxOf(req), key, String(params.option ?? ""), q.q)) };
    });

    // ===== Imports ============================================================================================
    scope.post("/jobs", { bodyLimit: deps.config.hardMaxFileBytes + 64 * 1024, preHandler: kit.require(P.create) }, async (req, reply) => {
      const q = parse(importUploadQuerySchema, req.query);
      const importer = findImporter(q.importer);
      if (!importer) throw notFound("imports.importer_unknown", "Importeur", q.importer);
      await requireAll(req, reply, prepare(importer));
      await throttle(req, "upload");
      const body = req.body;
      const bytes = Buffer.isBuffer(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : new Uint8Array(0);
      const result = unwrapOrThrow(
        await uploadImportFile(deps, ctxOf(req), { importerKey: q.importer, fileName: q.fileName, contentType: typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined, sheet: q.sheet, bytes }),
      );
      return reply.status(201).send(result);
    });

    scope.get("/jobs", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const q = parse(importListJobsQuerySchema, req.query);
      return unwrapOrThrow(await listImportJobs(deps, ctxOf(req), await viewerOf(req, reply), q));
    });

    scope.get("/jobs/:id", { preHandler: kit.require(P.read) }, async (req, reply) => unwrapOrThrow(await getImportJob(deps, ctxOf(req), idParams(req.params), await viewerOf(req, reply))));

    /** Charge l'import (visible) puis exige les permissions de son importeur : `extra` selon mapping / politique. */
    const guardJob = async (req: FastifyRequest, reply: FastifyReply, id: string, build: (importer: ImporterDef, job: Awaited<ReturnType<typeof loadImportJobRecord>> extends Result<infer J> ? J : never) => readonly string[]) => {
      const viewer = await viewerOf(req, reply);
      const job = unwrapOrThrow(await loadImportJobRecord(deps, ctxOf(req), id, viewer));
      const importer = findImporter(job.importerKey);
      if (!importer) throw notFound("imports.importer_unknown", "Importeur", job.importerKey);
      await requireAll(req, reply, build(importer, job));
      return { viewer, job, importer };
    };

    const mappedColumnsOf = (mapping: Record<string, string | null> | null): Set<string> => new Set(Object.entries(mapping ?? {}).filter(([, v]) => v !== null).map(([k]) => k));

    scope.put("/jobs/:id/mapping", { preHandler: kit.require(P.create) }, async (req, reply) => {
      const id = idParams(req.params);
      const body = parse(importMappingBodySchema, req.body);
      const { viewer } = await guardJob(req, reply, id, (importer, job) =>
        prepare(importer, importer.extraPermissions({ mappedColumns: mappedColumnsOf(body.mapping), onExisting: body.onExisting ?? job.onExisting, options: { ...(body.options ?? job.options) } })),
      );
      await throttle(req, "write");
      return unwrapOrThrow(await setImportMapping(deps, ctxOf(req), id, body, viewer));
    });

    scope.post("/jobs/:id/validate", { preHandler: kit.require(P.create) }, async (req, reply) => {
      const id = idParams(req.params);
      const { viewer } = await guardJob(req, reply, id, (importer, job) => prepare(importer, importer.extraPermissions({ mappedColumns: mappedColumnsOf(job.mapping), onExisting: job.onExisting, options: job.options })));
      await throttle(req, "write");
      return reply.status(202).send(unwrapOrThrow(await requestImportValidation(deps, ctxOf(req), id, viewer)));
    });

    scope.get("/jobs/:id/preview", { preHandler: kit.require(P.read) }, async (req, reply) => unwrapOrThrow(await getImportPreview(deps, ctxOf(req), idParams(req.params), await viewerOf(req, reply))));

    scope.get("/jobs/:id/rows", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const q = parse(importListRowsQuerySchema, req.query);
      return unwrapOrThrow(await listImportRows(deps, ctxOf(req), idParams(req.params), q, await viewerOf(req, reply)));
    });

    scope.get("/jobs/:id/report", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const q = parse(importReportQuerySchema, req.query);
      await throttle(req, "download");
      const file = unwrapOrThrow(await buildImportReportFile(deps, ctxOf(req), idParams(req.params), q.format, q.kind, await viewerOf(req, reply)));
      return reply.header("Content-Type", file.contentType).header("Content-Disposition", contentDisposition(file.fileName)).send(Buffer.from(file.bytes));
    });

    scope.get("/jobs/:id/summary", { preHandler: kit.require(P.read) }, async (req, reply) => {
      const ctx = ctxOf(req);
      return unwrapOrThrow(
        await getImportReport(deps, ctx, idParams(req.params), await viewerOf(req, reply), async (userId) => (deps.ports.names ? deps.ports.names.displayName(ctx, userId) : null)),
      );
    });

    scope.post("/jobs/:id/run", { preHandler: kit.require(P.create) }, async (req, reply) => {
      const id = idParams(req.params);
      const body = parse(importRunBodySchema, req.body);
      const { viewer } = await guardJob(req, reply, id, (importer, job) =>
        prepare(importer, [importer.importPermission, ...importer.extraPermissions({ mappedColumns: mappedColumnsOf(job.mapping), onExisting: body.onExisting, options: job.options })]),
      );
      await throttle(req, "write");
      return reply.status(202).send(unwrapOrThrow(await requestImportRun(deps, ctxOf(req), id, body, viewer)));
    });

    scope.post("/jobs/:id/cancel", { preHandler: kit.require(P.cancel) }, async (req, reply) => {
      const body = parse(importCancelBodySchema, req.body);
      return unwrapOrThrow(await cancelImportJob(deps, ctxOf(req), idParams(req.params), body.reason, await viewerOf(req, reply)));
    });

    scope.delete("/jobs/:id", { preHandler: kit.require(P.create) }, async (req, reply) => {
      unwrapOrThrow(await deleteImportJob(deps, ctxOf(req), idParams(req.params), await viewerOf(req, reply)));
      return reply.status(204).send();
    });

    // ===== Modèles de mapping =================================================================================
    scope.get("/templates", { preHandler: kit.require(P.read) }, async (req) => {
      const q = parse(importListTemplatesQuerySchema, req.query);
      return { items: unwrapOrThrow(await listMappingTemplates(deps, ctxOf(req), q.importer)) };
    });
    scope.post("/templates", { preHandler: kit.require(P.templateManage) }, async (req, reply) => {
      const body = parse(importCreateTemplateBodySchema, req.body);
      return reply.status(201).send(unwrapOrThrow(await createMappingTemplate(deps, ctxOf(req), body)));
    });
    scope.put("/templates/:id", { preHandler: kit.require(P.templateManage) }, async (req) => {
      const body = parse(importUpdateTemplateBodySchema, req.body);
      return unwrapOrThrow(await updateMappingTemplate(deps, ctxOf(req), idParams(req.params), body));
    });
    scope.delete("/templates/:id", { preHandler: kit.require(P.templateManage) }, async (req, reply) => {
      unwrapOrThrow(await removeMappingTemplate(deps, ctxOf(req), idParams(req.params)));
      return reply.status(204).send();
    });

    // ===== Paramètres =========================================================================================
    scope.get("/settings", { preHandler: kit.require(P.read) }, async (req) => unwrapOrThrow(await getImportSettings(deps, ctxOf(req))));
    scope.put("/settings", { preHandler: kit.require(P.manage) }, async (req) => {
      const body = parse(importUpdateSettingsBodySchema, req.body);
      return unwrapOrThrow(await updateImportSettings(deps, ctxOf(req), body));
    });
  });
}

export default async function importsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("importsPorts")) app.decorate("importsPorts", createImportsPortRegistry());
  const deps = createImportsDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: importsAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.importsPorts.current,
  });
  await app.register(importsPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: runtime.rateLimiter as unknown as RateLimiterLike,
  });
}
