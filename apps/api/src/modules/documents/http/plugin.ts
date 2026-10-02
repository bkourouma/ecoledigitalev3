/**
 * Plugin Fastify du module documents — routes SANS préfixe (le registre applique `/api/v1/documents`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la RACINE
 * avec le registre de ports (`app.documentsPorts`) que les adaptateurs de plateforme renseignent.
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). Aucune identité lue d'un en-tête client.
 *  - Autorisation : `requirePermission('documents.…')` du module rbac, jamais un rôle codé en dur ; les permissions sensibles
 *    (confidentiel, gestion, quarantaine) exigent la MFA (garde rbac). Le DOCUMENT visé (niveau, propriétaire, tuteur lié,
 *    partage) est vérifié par les cas d'usage : un document invisible répond 404 comme un document inexistant.
 *  - Dépôt : `multipart/form-data` (champs + un champ `file`), lecture BORNÉE en flux (jamais plus que le plafond de plateforme + 1).
 *  - Limiteur de débit : `runtime.rateLimiter` par utilisateur sur les dépôts et les lectures : 429 + Retry-After.
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `documents.*` ; statuts précis (413, 415, 422, 410, 503).
 *  - Réponses `Cache-Control: no-store` (contenu privé).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import multipart from "@fastify/multipart";
import { ZodError, z, type ZodTypeAny } from "zod";
import { ForbiddenError, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  documentArchiveBodySchema,
  documentCategoryListQuerySchema,
  documentCreateCategoryBodySchema,
  documentCreateFieldsSchema,
  documentGrantBodySchema,
  documentHistoryQuerySchema,
  documentListQuerySchema,
  documentPersonQuerySchema,
  documentQuarantineDecisionBodySchema,
  documentQuarantineQuerySchema,
  documentShareBodySchema,
  documentUpdateBodySchema,
  documentUpdateCategoryBodySchema,
  documentUpdateSettingsBodySchema,
  documentVersionFieldsSchema,
  documentsUuidSchema,
} from "@ecoledigitale/contracts/src/v2/documents";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { createCategory, getMyContext, getSettings, getUsage, grantCategory, listCategories, listCategoryGrants, revokeCategoryGrant, setCategoryArchived, updateCategory, updateSettings } from "../application/categories";
import { createDocumentsDeps, type DocumentsDeps } from "../application/deps";
import { archiveDocument, expirationCounts, getDocument, getDownloadUrl, getHistory, getPreview, listDocuments, listGuardianUsers, restoreDocument, searchPeople, updateDocument } from "../application/documents";
import { createDocumentsPortRegistry, type DocumentsPortRegistry } from "../application/port-registry";
import type { DocumentsPorts } from "../application/ports";
import { deleteQuarantine, listQuarantine, releaseQuarantine } from "../application/quarantine";
import { listShares, shareDocument, unshareDocument } from "../application/shares";
import { addVersion, createDocument, type UploadedFile } from "../application/uploads";
import { DocumentsCode, HTTP_STATUS_BY_DOCUMENTS_CODE, forbidden, validation } from "../domain/errors";
import type { ActorCaps } from "../domain/types";
import { documentsAuditAdapter } from "../infrastructure/audit-adapter";
import { ALL_CAPS, ANY_DOCUMENTS_PERMISSION, createPermissionKit, PERMISSIONS as P, UPLOADERS, VIEWERS, type PermissionKit } from "./guards";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par les adaptateurs de plateforme)
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module documents (posé par `setup`). */
    documentsPorts: DocumentsPortRegistry;
  }
}

/** À appeler par `platform/adapters` (`wireApiPorts`) : enregistre (ou remplace) des ports ; relus à chaque appel. */
export function registerDocumentsPorts(app: FastifyInstance, ports: Partial<DocumentsPorts>): void {
  if (!app.hasDecorator("documentsPorts")) app.decorate("documentsPorts", createDocumentsPortRegistry());
  app.documentsPorts.register(ports);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError("Données invalides.", error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })), { code: DocumentsCode.INVALID_INPUT });
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

const idParams = (params: unknown): { id: string } => ({ id: parse(documentsUuidSchema, (params as { id?: unknown } | undefined)?.id) });

const versionParam = (params: unknown): number | undefined => {
  const raw = (params as { no?: unknown } | undefined)?.no;
  if (raw === undefined) return undefined;
  return parse(z.coerce.number().int().min(1).max(10_000), raw);
};

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** Erreurs du transport (multipart, corps trop gros) vers les codes stables du module. */
function normalizeTransportError(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: string; statusCode?: number };
    if (e.code === "FST_REQ_FILE_TOO_LARGE" || e.code === "FST_FILES_LIMIT" || e.code === "FST_PARTS_LIMIT" || e.code === "FST_ERR_CTP_BODY_TOO_LARGE" || e.statusCode === 413) {
      return validation(DocumentsCode.FILE_TOO_LARGE, "Le fichier dépasse la taille maximale autorisée.", "file");
    }
    if (typeof e.code === "string" && e.code.startsWith("FST_") && e.statusCode === 400) return validation(DocumentsCode.INVALID_INPUT, "Requête invalide.", "body");
    if (e.statusCode === 400) return validation(DocumentsCode.INVALID_INPUT, "Requête invalide.", "body");
  }
  return error;
}

/** Fenêtres du limiteur HTTP (par utilisateur) : protège le stockage et l'antivirus avant tout contrôle métier. */
const HTTP_RATE = Object.freeze({
  upload: { limit: 20, windowMs: 60_000 },
  read: { limit: 240, windowMs: 60_000 },
  share: { limit: 60, windowMs: 60_000 },
});

export interface RateLimiterLike {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; count: number; retryAfterMs: number }>;
}

export interface DocumentsPluginOptions {
  deps: DocumentsDeps;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  rateLimiter?: RateLimiterLike;
  /** Feature du tenant (entitlements) ; absent = toutes actives (tests autonomes). */
  isFeatureEnabled?: (ctx: RequestContext, featureKey: string) => Promise<boolean>;
}

const noStore = (reply: FastifyReply): void => {
  void reply.header("Cache-Control", "no-store");
};

const asciiName = (name: string): string => name.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_");

/** Champs texte d'un dépôt -> valeurs typées (listes / objets en JSON ou séparés par des virgules). */
export function normalizeUploadFields(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const text = (k: string): string | undefined => {
    const v = raw[k];
    return v === undefined || v.trim() === "" ? undefined : v.trim();
  };
  const list = (k: string): unknown[] | undefined => {
    const v = text(k);
    if (v === undefined) return undefined;
    if (v.startsWith("[")) return JSON.parse(v) as unknown[];
    return v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  };
  for (const key of ["categoryId", "title", "description", "ownerType", "ownerId", "visibility", "expiresOn", "note", "baseVersion"]) {
    const v = text(key);
    if (v !== undefined) out[key] = v;
  }
  try {
    const tags = list("tags");
    if (tags !== undefined) out.tags = tags;
    const alertDays = list("alertDays");
    if (alertDays !== undefined) out.alertDays = alertDays.map((n) => Number(n));
    const metadata = text("metadata");
    if (metadata !== undefined) out.metadata = JSON.parse(metadata) as unknown;
  } catch {
    throw validation(DocumentsCode.INVALID_INPUT, "Champ de liste ou de métadonnées illisible (JSON attendu).", "body");
  }
  return out;
}

interface ParsedUpload {
  fields: Record<string, string>;
  file: UploadedFile | null;
}

/** Lit un dépôt multipart : champs texte + au plus UN fichier, borné en flux. */
async function readUpload(request: FastifyRequest, maxFileBytes: number): Promise<ParsedUpload> {
  if (!request.isMultipart()) throw validation(DocumentsCode.INVALID_INPUT, "Le dépôt doit être envoyé en multipart/form-data.", "body");
  const fields: Record<string, string> = {};
  let file: UploadedFile | null = null;
  const parts = request.parts({ limits: { fileSize: maxFileBytes + 1, files: 1, fields: 20, parts: 25, fieldSize: 20_000, fieldNameSize: 50 } });
  for await (const part of parts) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        part.file.resume();
        continue;
      }
      const bytes = await part.toBuffer(); // lève FST_REQ_FILE_TOO_LARGE au-delà de la limite
      file = { fileName: part.filename ?? "", bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
    } else if (typeof part.value === "string") {
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, file };
}

export async function documentsPlugin(app: FastifyInstance, options: DocumentsPluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(normalizeTransportError(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "documents : erreur inattendue");
    noStore(reply);
    const status = HTTP_STATUS_BY_DOCUMENTS_CODE[appError.code] ?? appError.httpStatus;
    if (status === 429) {
      const retry = Number((appError.details as { retryAfterSec?: number } | undefined)?.retryAfterSec ?? 1);
      void reply.header("Retry-After", String(retry));
    }
    void reply.status(status).send({ ...toErrorBody(appError, String(request.id)), status });
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    scope.addHook("onSend", async (_request, reply, payload) => {
      if (!reply.hasHeader("Cache-Control")) noStore(reply);
      return payload;
    });
    // Le multipart du legacy (racine) est réutilisé en production ; un assemblage isolé (tests) le déclare ici.
    if (!scope.hasContentTypeParser("multipart/form-data")) {
      await scope.register(multipart, { limits: { fileSize: deps.config.hardMaxBytes + 1, files: 1, fields: 20 } });
    }

    const caps = (req: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof ActorCaps> = ALL_CAPS): Promise<ActorCaps> => kit.capsFor(scope, req, reply, keys);
    const feature = async (req: FastifyRequest, key: string): Promise<boolean> => (options.isFeatureEnabled ? options.isFeatureEnabled(ctxOf(req), key) : true);

    /** Limiteur de débit HTTP par utilisateur (Redis si configuré). */
    const throttle = (kind: keyof typeof HTTP_RATE): preHandlerAsyncHookHandler =>
      async function throttleGuard(this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
        if (!options.rateLimiter) return;
        const ctx = ctxOf(request);
        const d = await options.rateLimiter.hit(`documents:${kind}:${ctx.tenantId}:${ctx.userId ?? request.ip}`, HTTP_RATE[kind]);
        if (!d.allowed) {
          const retry = Math.max(1, Math.ceil(d.retryAfterMs / 1000));
          void reply.header("Retry-After", String(retry));
          throw forbiddenRate(retry);
        }
      };

    const viewers = kit.anyOf(...VIEWERS);
    const uploaders = kit.anyOf(...UPLOADERS);

    // ===== Moi ===============================================================================================
    scope.get("/me/context", { preHandler: kit.anyOf(...ANY_DOCUMENTS_PERMISSION) }, async (req, reply) =>
      unwrapOrThrow(await getMyContext(deps, ctxOf(req), { caps: await caps(req, reply), officePreview: await feature(req, "documents.office-preview") })),
    );

    // ===== Catégories ========================================================================================
    scope.get("/categories", { preHandler: kit.anyOf(...ANY_DOCUMENTS_PERMISSION) }, async (req, reply) => {
      const q = parse(documentCategoryListQuerySchema, req.query);
      return { items: unwrapOrThrow(await listCategories(deps, ctxOf(req), { caps: await caps(req, reply), kind: q.kind, includeArchived: q.includeArchived === "true" })) };
    });
    scope.post("/categories", { preHandler: kit.anyOf(P.categoryManage) }, async (req, reply) => {
      const created = unwrapOrThrow(await createCategory(deps, ctxOf(req), { caps: await caps(req, reply), body: parse(documentCreateCategoryBodySchema, req.body) }));
      return reply.status(201).send(created);
    });
    scope.patch("/categories/:id", { preHandler: kit.anyOf(P.categoryManage) }, async (req, reply) =>
      unwrapOrThrow(await updateCategory(deps, ctxOf(req), { caps: await caps(req, reply), id: idParams(req.params).id, body: parse(documentUpdateCategoryBodySchema, req.body) })),
    );
    scope.post("/categories/:id/archive", { preHandler: kit.anyOf(P.categoryManage) }, async (req, reply) =>
      unwrapOrThrow(await setCategoryArchived(deps, ctxOf(req), { caps: await caps(req, reply), id: idParams(req.params).id, archived: true })),
    );
    scope.post("/categories/:id/restore", { preHandler: kit.anyOf(P.categoryManage) }, async (req, reply) =>
      unwrapOrThrow(await setCategoryArchived(deps, ctxOf(req), { caps: await caps(req, reply), id: idParams(req.params).id, archived: false })),
    );
    scope.get("/categories/:id/grants", { preHandler: kit.anyOf(P.categoryManage) }, async (req) => ({
      items: unwrapOrThrow(await listCategoryGrants(deps, ctxOf(req), { categoryId: idParams(req.params).id })),
    }));
    scope.post("/categories/:id/grants", { preHandler: kit.anyOf(P.categoryManage) }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await grantCategory(deps, ctxOf(req), { categoryId: idParams(req.params).id, body: parse(documentGrantBodySchema, req.body) }))),
    );
    scope.delete("/categories/:id/grants/:grantId", { preHandler: kit.anyOf(P.categoryManage) }, async (req, reply) => {
      const { id } = idParams(req.params);
      const grantId = parse(documentsUuidSchema, (req.params as { grantId?: unknown }).grantId);
      unwrapOrThrow(await revokeCategoryGrant(deps, ctxOf(req), { categoryId: id, grantId }));
      return reply.status(204).send();
    });

    // ===== Paramètres et usage ===============================================================================
    scope.get("/settings", { preHandler: kit.anyOf(P.settingsManage, P.manage) }, async (req) => unwrapOrThrow(await getSettings(deps, ctxOf(req))));
    scope.put("/settings", { preHandler: kit.anyOf(P.settingsManage) }, async (req) => unwrapOrThrow(await updateSettings(deps, ctxOf(req), { body: parse(documentUpdateSettingsBodySchema, req.body) })));
    scope.get("/usage", { preHandler: kit.anyOf(P.settingsManage, P.manage) }, async (req) => unwrapOrThrow(await getUsage(deps, ctxOf(req))));

    // ===== Documents =========================================================================================
    scope.get("/summary", { preHandler: viewers }, async (req, reply) => {
      const within = parse(z.object({ withinDays: z.coerce.number().int().min(0).max(3650).optional() }), req.query).withinDays;
      return unwrapOrThrow(await expirationCounts(deps, ctxOf(req), { caps: await caps(req, reply), withinDays: within }));
    });

    scope.get("/documents", { preHandler: [viewers, throttle("read")] }, async (req, reply) =>
      unwrapOrThrow(await listDocuments(deps, ctxOf(req), { caps: await caps(req, reply), query: parse(documentListQuerySchema, req.query) })),
    );

    scope.post("/documents", { preHandler: [uploaders, throttle("upload")] }, async (req, reply) => {
      const upload = await readUpload(req, deps.config.hardMaxBytes);
      if (!upload.file) throw validation(DocumentsCode.FILE_MISSING, "Aucun fichier n'a été transmis (champ « file »).", "file");
      const fields = parse(documentCreateFieldsSchema, normalizeUploadFields(upload.fields));
      const created = unwrapOrThrow(await createDocument(deps, ctxOf(req), { caps: await caps(req, reply), fields, file: upload.file }));
      return reply.status(201).send(created);
    });

    scope.get("/documents/:id", { preHandler: [viewers, throttle("read")] }, async (req, reply) =>
      unwrapOrThrow(await getDocument(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id })),
    );

    scope.patch("/documents/:id", { preHandler: uploadersOrViewers(kit) }, async (req, reply) =>
      unwrapOrThrow(await updateDocument(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id, body: parse(documentUpdateBodySchema, req.body) })),
    );

    scope.post("/documents/:id/versions", { preHandler: [uploaders, throttle("upload")] }, async (req, reply) => {
      const upload = await readUpload(req, deps.config.hardMaxBytes);
      if (!upload.file) throw validation(DocumentsCode.FILE_MISSING, "Aucun fichier n'a été transmis (champ « file »).", "file");
      const fields = parse(documentVersionFieldsSchema, normalizeUploadFields(upload.fields));
      const created = unwrapOrThrow(await addVersion(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id, fields, file: upload.file }));
      return reply.status(201).send(created);
    });

    const downloadUrl = async (req: FastifyRequest, reply: FastifyReply) =>
      unwrapOrThrow(await getDownloadUrl(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id, versionNo: versionParam(req.params) }));
    scope.get("/documents/:id/download-url", { preHandler: [viewers, throttle("read")] }, downloadUrl);
    scope.get("/documents/:id/versions/:no/download-url", { preHandler: [viewers, throttle("read")] }, downloadUrl);

    const preview = async (req: FastifyRequest, reply: FastifyReply) => {
      const result = unwrapOrThrow(
        await getPreview(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id, versionNo: versionParam(req.params), officeEnabled: await feature(req, "documents.office-preview") }),
      );
      reply
        .header("Content-Type", result.contentType)
        .header("Content-Disposition", `inline; filename="${asciiName(result.fileName)}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`)
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("Cache-Control", "private, no-store");
      // Images et texte : aucune ressource, aucun script, bac à sable. PDF : le visionneur du navigateur (déjà isolé) ne tolère pas `sandbox`.
      if (result.kind !== "PDF") reply.header("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      if (result.truncated) reply.header("X-Preview-Truncated", "1");
      return reply.send(Buffer.from(result.bytes));
    };
    scope.get("/documents/:id/preview", { preHandler: [viewers, throttle("read")] }, preview);
    scope.get("/documents/:id/versions/:no/preview", { preHandler: [viewers, throttle("read")] }, preview);

    scope.get("/documents/:id/history", { preHandler: viewers }, async (req, reply) => {
      const q = parse(documentHistoryQuerySchema, req.query);
      return unwrapOrThrow(await getHistory(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id, cursor: q.cursor, limit: q.limit }));
    });

    scope.post("/documents/:id/archive", { preHandler: viewers }, async (req, reply) =>
      unwrapOrThrow(await archiveDocument(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id, reason: parse(documentArchiveBodySchema, req.body).reason })),
    );
    scope.post("/documents/:id/restore", { preHandler: kit.anyOf(P.manage) }, async (req, reply) =>
      unwrapOrThrow(await restoreDocument(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id })),
    );

    // ===== Partages ==========================================================================================
    const sharers = kit.anyOf(P.share, P.manage);
    scope.get("/documents/:id/shares", { preHandler: sharers }, async (req, reply) => ({
      items: unwrapOrThrow(await listShares(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id })),
    }));
    scope.post("/documents/:id/shares", { preHandler: [sharers, throttle("share")] }, async (req, reply) =>
      reply.status(201).send(unwrapOrThrow(await shareDocument(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id, body: parse(documentShareBodySchema, req.body) }))),
    );
    scope.delete("/documents/:id/shares/:shareId", { preHandler: sharers }, async (req, reply) => {
      const shareId = parse(documentsUuidSchema, (req.params as { shareId?: unknown }).shareId);
      unwrapOrThrow(await unshareDocument(deps, ctxOf(req), { caps: await caps(req, reply), documentId: idParams(req.params).id, shareId }));
      return reply.status(204).send();
    });

    // ===== Personnes (sélecteurs) ============================================================================
    scope.get("/people", { preHandler: kit.anyOf(P.share, P.upload, P.manage, P.categoryManage) }, async (req, reply) => {
      const q = parse(documentPersonQuerySchema, req.query);
      const c = await caps(req, reply, ["share", "upload", "manage", "categoryManage"]);
      // Chercher des COMPTES n'est utile (et permis) qu'à qui partage ou administre ; chercher des propriétaires, qu'à qui dépose.
      if (q.kind === "USER" && !(c.share || c.manage || c.categoryManage)) throw forbidden(DocumentsCode.FORBIDDEN, "Recherche de comptes réservée à qui partage des documents.");
      if (q.kind !== "USER" && !(c.upload || c.manage)) throw forbidden(DocumentsCode.FORBIDDEN, "Recherche de personnes réservée à qui dépose des documents.");
      return { items: unwrapOrThrow(await searchPeople(deps, ctxOf(req), { query: q })) };
    });
    scope.get("/students/:id/guardians", { preHandler: sharers }, async (req) => unwrapOrThrow(await listGuardianUsers(deps, ctxOf(req), { studentId: idParams(req.params).id })));

    // ===== Quarantaine =======================================================================================
    const quarantine = kit.anyOf(P.quarantineManage);
    scope.get("/quarantine", { preHandler: quarantine }, async (req) => {
      const q = parse(documentQuarantineQuerySchema, req.query);
      return unwrapOrThrow(await listQuarantine(deps, ctxOf(req), q));
    });
    scope.post("/quarantine/:id/release", { preHandler: quarantine }, async (req, reply) =>
      unwrapOrThrow(await releaseQuarantine(deps, ctxOf(req), { caps: await caps(req, reply), id: idParams(req.params).id, note: parse(documentQuarantineDecisionBodySchema, req.body).note })),
    );
    scope.delete("/quarantine/:id", { preHandler: quarantine }, async (req, reply) => {
      unwrapOrThrow(await deleteQuarantine(deps, ctxOf(req), { id: idParams(req.params).id, note: parse(documentQuarantineDecisionBodySchema, req.body).note }));
      return reply.status(204).send();
    });
  });
}

/** Modifier un document : toute personne pouvant lire ou déposer atteint la route ; le cas d'usage décide (droit d'écriture sur CE document). */
function uploadersOrViewers(kit: PermissionKit): preHandlerAsyncHookHandler {
  return kit.anyOf(...VIEWERS, ...UPLOADERS);
}

function forbiddenRate(retryAfterSec: number): ForbiddenError {
  return new ForbiddenError("Trop de requêtes : réessayez dans un instant.", { code: DocumentsCode.RATE_LIMITED, details: { retryAfterSec } });
}

// ---------------------------------------------------------------------------
// Assemblage par le registre
// ---------------------------------------------------------------------------

export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("documentsPorts")) app.decorate("documentsPorts", createDocumentsPortRegistry());
}

const GIB = 1024 * 1024 * 1024;

/** Quota du PLAN : palier selon les features `documents.storage.*` (valeurs d'environnement, défauts 2 / 20 / 100 Gio). */
function planQuotaFrom(runtime: ModuleRuntime): DocumentsPorts["planQuota"] {
  const num = (key: string, fallback: number): number => {
    const n = Number(runtime.env[key]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return async (ctx) => {
    if (await runtime.entitlements.isFeatureEnabled(ctx, "documents.storage.large")) return num("DOCUMENTS_QUOTA_LARGE_BYTES", 100 * GIB);
    if (await runtime.entitlements.isFeatureEnabled(ctx, "documents.storage.extended")) return num("DOCUMENTS_QUOTA_EXTENDED_BYTES", 20 * GIB);
    return num("DOCUMENTS_QUOTA_BASE_BYTES", 2 * GIB);
  };
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/documents`). */
export default async function documentsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("documentsPorts")) app.decorate("documentsPorts", createDocumentsPortRegistry());
  const planQuota = planQuotaFrom(runtime);
  const hard = Number(runtime.env.DOCUMENTS_HARD_MAX_BYTES);
  const ttl = Number(runtime.env.DOCUMENTS_SIGNED_URL_TTL_SECONDS);
  const deps = createDocumentsDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: documentsAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => ({ planQuota, ...app.documentsPorts.current }),
    config: {
      ...(Number.isFinite(hard) && hard > 0 ? { hardMaxBytes: Math.min(hard, 104_857_600) } : {}),
      ...(Number.isFinite(ttl) && ttl > 0 ? { signedUrlTtlSeconds: Math.min(ttl, 300) } : {}),
    },
  });
  await app.register(documentsPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: runtime.rateLimiter as unknown as RateLimiterLike,
    isFeatureEnabled: (ctx, key) => runtime.entitlements.isFeatureEnabled(ctx, key),
  });
}
