/**
 * Plugin Fastify du module notifications — routes SANS préfixe (le registre applique `/api/v1/notifications`).
 * Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la RACINE avec le registre de ports
 * (`app.notificationsPorts`) que les adaptateurs de plateforme renseignent.
 *
 *  - Authentification : `request.ctx` posé en amont. Aucune identité lue d'un en-tête client.
 *  - Autorisation : `requirePermission('notifications.…')` du module rbac ; les routes « moi » n'agissent que sur l'appelant.
 *  - Routes PUBLIQUES (`config.public`), chacune avec sa propre authentification : désinscription (jeton signé HMAC),
 *    accusés de fournisseurs (corps signé HMAC, établissement dans l'URL). Elles sont limitées en débit par IP.
 *  - Aucun `GET` n'écrit. Réponses `Cache-Control: no-store`. Erreurs `AppError` / Zod -> `toErrorBody`, codes `notifications.*`.
 *  - Adresses : jamais complètes dans une réponse (destinataire masqué du journal) ni dans les journaux d'exécution.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, z, type ZodTypeAny } from "zod";
import { createSystemContext, UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  notifActivateVersionBodySchema,
  notifChannelTestBodySchema,
  notifConsentLogQuerySchema,
  notifDeliveryListQuerySchema,
  notifDeliveryStatusWebhookBodySchema,
  notifEnableTemplateBodySchema,
  notifPreviewBodySchema,
  notifPushSubscribeBodySchema,
  notifPushUnsubscribeBodySchema,
  notifRuleKeyParamsSchema,
  notifSaveRuleBodySchema,
  notifSaveTemplateBodySchema,
  notifSendBodySchema,
  notifSubjectConsentBodySchema,
  notifTemplateKeyParamsSchema,
  notifTemplateKeyQuerySchema,
  notifUnsubscribeQuerySchema,
  notifUpdatePreferencesBodySchema,
  notifUpdateSettingsBodySchema,
  notifUuidSchema,
} from "@ecoledigitale/contracts/src/v2/notifications";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { getChannelsHealth, sendChannelTest } from "../application/health";
import { createNotificationsDeps, configFromEnv, type NotificationsDeps } from "../application/deps";
import { deliveryStats, listDeliveries } from "../application/journal";
import { applyUnsubscribe, getConsentLog, getMyNotificationPreferences, setSubjectConsent, updateMyNotificationPreferences } from "../application/preferences";
import { createNotificationsPortRegistry, type NotificationsPortRegistry } from "../application/port-registry";
import type { NotificationsPorts } from "../application/ports";
import { listMyPushDevices, removeMyPushDevice, subscribePush, unsubscribePush, vapidPublicKey } from "../application/push";
import { listRules, listSupportedTriggers, resetRule, saveRule } from "../application/rules";
import { sendManualNotification } from "../application/send";
import { getNotificationSettings, updateNotificationSettings } from "../application/settings";
import { activateTemplateVersion, listCatalog, listTemplates, listTemplateVersions, previewTemplate, publishTemplateVersion, setTemplateEnabled } from "../application/templates";
import { applyDeliveryStatusWebhook } from "../application/webhooks";
import { signUnsubscribeToken, verifyBodySignature, verifyUnsubscribeToken } from "../domain/tokens";
import { NotifCode, RateLimitedError, forbidden } from "../domain/errors";
import { createChannelRegistry } from "../infrastructure/channels/registry";
import { createPermissionKit, PERMISSIONS as P, SELF_SERVICE, type PermissionKit } from "./guards";

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module notifications (posé par `setup`). */
    notificationsPorts: NotificationsPortRegistry;
  }
}

/** À appeler par `platform/adapters` (`wireApiPorts`) : enregistre (ou remplace) des ports ; relus à chaque appel. */
export function registerNotificationsPorts(app: FastifyInstance, ports: Partial<NotificationsPorts>): void {
  if (!app.hasDecorator("notificationsPorts")) app.decorate("notificationsPorts", createNotificationsPortRegistry());
  app.notificationsPorts.register(ports);
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
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: NotifCode.INVALID_INPUT });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: NotifCode.INVALID_INPUT });
  }
  return error;
}

const idParams = (params: unknown): { id: string } => ({ id: parse(notifUuidSchema, (params as { id?: unknown } | undefined)?.id) });

export interface RateLimiterLike {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; count: number; retryAfterMs: number }>;
}

/** Limiteur des routes publiques (par IP) : désinscription et accusés de fournisseurs. */
const PUBLIC_RATE = Object.freeze({ unsubscribe: { limit: 30, windowMs: 60_000 }, webhook: { limit: 600, windowMs: 60_000 } });

export interface NotificationsPluginOptions {
  deps: NotificationsDeps;
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
  rateLimiter?: RateLimiterLike;
}

const noStore = (reply: FastifyReply): void => {
  void reply.header("Cache-Control", "no-store");
};

export async function notificationsPlugin(app: FastifyInstance, options: NotificationsPluginOptions): Promise<void> {
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
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "notifications : erreur inattendue");
    noStore(reply);
    if (appError instanceof RateLimitedError) {
      void reply.header("Retry-After", String(appError.retryAfterSec));
      void reply.status(429).send({ ...toErrorBody(appError, String(request.id)), status: 429 });
      return;
    }
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  const publicThrottle = async (request: FastifyRequest, reply: FastifyReply, kind: keyof typeof PUBLIC_RATE): Promise<void> => {
    if (!options.rateLimiter) return;
    const d = await options.rateLimiter.hit(`notifications:${kind}:${request.ip}`, PUBLIC_RATE[kind]);
    if (!d.allowed) {
      const retry = Math.max(1, Math.ceil(d.retryAfterMs / 1000));
      void reply.header("Retry-After", String(retry));
      throw new RateLimitedError("Trop de requêtes : réessayez dans un instant.", retry);
    }
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    scope.addHook("onSend", async (_request, reply, payload) => {
      if (!reply.hasHeader("Cache-Control")) noStore(reply);
      return payload;
    });

    // ===== Catalogue, déclencheurs ===========================================================================
    const viewers = [P.read, P.templatesManage, P.rulesManage, P.settingsManage] as const;
    scope.get("/catalog", { preHandler: kit.anyOf(...viewers) }, async () => listCatalog());
    scope.get("/triggers", { preHandler: kit.anyOf(...viewers) }, async () => listSupportedTriggers());

    // ===== Gabarits ==========================================================================================
    scope.get("/templates", { preHandler: kit.anyOf(...viewers) }, async (req) => {
      const q = parse(z.object({ locale: z.string().max(10).optional() }).strict(), req.query);
      return unwrapOrThrow(await listTemplates(deps, ctxOf(req), q));
    });
    scope.get("/templates/:code/versions", { preHandler: kit.anyOf(...viewers) }, async (req) => {
      const { code } = parse(notifTemplateKeyParamsSchema, req.params);
      const q = parse(notifTemplateKeyQuerySchema, req.query);
      return unwrapOrThrow(await listTemplateVersions(deps, ctxOf(req), { code, channel: q.channel, locale: q.locale }));
    });
    scope.post("/templates/:code", { preHandler: kit.require(P.templatesManage) }, async (req, reply) => {
      const { code } = parse(notifTemplateKeyParamsSchema, req.params);
      const b = parse(notifSaveTemplateBodySchema, req.body);
      const r = unwrapOrThrow(await publishTemplateVersion(deps, ctxOf(req), { code, channel: b.channel, locale: b.locale, subject: b.subject, body: b.body, note: b.note }));
      return reply.status(201).send(r);
    });
    scope.post("/templates/:code/activate", { preHandler: kit.require(P.templatesManage) }, async (req) => {
      const { code } = parse(notifTemplateKeyParamsSchema, req.params);
      const b = parse(notifActivateVersionBodySchema, req.body);
      return unwrapOrThrow(await activateTemplateVersion(deps, ctxOf(req), { code, channel: b.channel, locale: b.locale, version: b.version }));
    });
    scope.post("/templates/:code/enable", { preHandler: kit.require(P.templatesManage) }, async (req) => {
      const { code } = parse(notifTemplateKeyParamsSchema, req.params);
      const b = parse(notifEnableTemplateBodySchema, req.body);
      return unwrapOrThrow(await setTemplateEnabled(deps, ctxOf(req), { code, channel: b.channel, locale: b.locale, enabled: b.enabled }));
    });
    scope.post("/templates/:code/preview", { preHandler: kit.anyOf(...viewers) }, async (req) => {
      const { code } = parse(notifTemplateKeyParamsSchema, req.params);
      const b = parse(notifPreviewBodySchema, req.body);
      return unwrapOrThrow(await previewTemplate(deps, ctxOf(req), { code, channel: b.channel, locale: b.locale, subject: b.subject, body: b.body, variables: b.variables }));
    });

    // ===== Règles ============================================================================================
    scope.get("/rules", { preHandler: kit.anyOf(P.read, P.rulesManage) }, async (req) => unwrapOrThrow(await listRules(deps, ctxOf(req))));
    scope.put("/rules/:key", { preHandler: kit.require(P.rulesManage) }, async (req) => {
      const { key } = parse(notifRuleKeyParamsSchema, req.params);
      return unwrapOrThrow(await saveRule(deps, ctxOf(req), key, parse(notifSaveRuleBodySchema, req.body)));
    });
    scope.delete("/rules/:key", { preHandler: kit.require(P.rulesManage) }, async (req, reply) => {
      const { key } = parse(notifRuleKeyParamsSchema, req.params);
      unwrapOrThrow(await resetRule(deps, ctxOf(req), key));
      return reply.status(204).send();
    });

    // ===== Paramètres, canaux, santé =========================================================================
    scope.get("/settings", { preHandler: kit.anyOf(P.settingsManage, P.read) }, async (req) => unwrapOrThrow(await getNotificationSettings(deps, ctxOf(req))));
    scope.put("/settings", { preHandler: kit.require(P.settingsManage) }, async (req) => unwrapOrThrow(await updateNotificationSettings(deps, ctxOf(req), parse(notifUpdateSettingsBodySchema, req.body))));
    scope.get("/channels", { preHandler: kit.anyOf(P.read, P.settingsManage) }, async (req) => unwrapOrThrow(await getChannelsHealth(deps, ctxOf(req))));
    scope.post("/channels/test", { preHandler: kit.require(P.settingsManage) }, async (req, reply) => {
      const b = parse(notifChannelTestBodySchema, req.body);
      return reply.status(202).send(unwrapOrThrow(await sendChannelTest(deps, ctxOf(req), { channels: b.channels })));
    });

    // ===== Journal ===========================================================================================
    scope.get("/deliveries", { preHandler: kit.require(P.read) }, async (req) => unwrapOrThrow(await listDeliveries(deps, ctxOf(req), parse(notifDeliveryListQuerySchema, req.query))));
    scope.get("/deliveries/stats", { preHandler: kit.require(P.read) }, async (req) => {
      const q = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).strict(), req.query);
      return unwrapOrThrow(await deliveryStats(deps, ctxOf(req), q));
    });

    // ===== Envoi manuel ======================================================================================
    scope.post("/send", { preHandler: kit.anyOf(P.send, P.sendUrgent) }, async (req, reply) => {
      const b = parse(notifSendBodySchema, req.body);
      const urgentAllowed = await kit.has(scope, req, reply, P.sendUrgent);
      const r = unwrapOrThrow(await sendManualNotification(deps, ctxOf(req), b, { urgent: urgentAllowed }));
      return reply.status(r.reused ? 200 : 202).send(r);
    });

    // ===== Consentement (administration) =====================================================================
    scope.post("/consent", { preHandler: kit.require(P.consentManage) }, async (req) => unwrapOrThrow(await setSubjectConsent(deps, ctxOf(req), parse(notifSubjectConsentBodySchema, req.body))));
    scope.get("/consent/log", { preHandler: kit.require(P.consentManage) }, async (req) => unwrapOrThrow(await getConsentLog(deps, ctxOf(req), parse(notifConsentLogQuerySchema, req.query))));

    // ===== Moi : préférences et appareils =====================================================================
    const self = kit.anyOf(...SELF_SERVICE);
    scope.get("/me/preferences", { preHandler: self }, async (req) => unwrapOrThrow(await getMyNotificationPreferences(deps, ctxOf(req))));
    scope.put("/me/preferences", { preHandler: self }, async (req) => unwrapOrThrow(await updateMyNotificationPreferences(deps, ctxOf(req), parse(notifUpdatePreferencesBodySchema, req.body))));
    scope.get("/me/push/vapid-key", { preHandler: self }, async () => vapidPublicKey(deps));
    scope.get("/me/push/devices", { preHandler: self }, async (req) => unwrapOrThrow(await listMyPushDevices(deps, ctxOf(req))));
    scope.post("/me/push/subscriptions", { preHandler: self }, async (req, reply) => reply.status(201).send(unwrapOrThrow(await subscribePush(deps, ctxOf(req), parse(notifPushSubscribeBodySchema, req.body)))));
    scope.post("/me/push/unsubscribe", { preHandler: self }, async (req) => unwrapOrThrow(await unsubscribePush(deps, ctxOf(req), parse(notifPushUnsubscribeBodySchema, req.body).endpoint)));
    scope.delete("/me/push/devices/:id", { preHandler: self }, async (req, reply) => {
      const { id } = idParams(req.params);
      unwrapOrThrow(await removeMyPushDevice(deps, ctxOf(req), id));
      return reply.status(204).send();
    });

    // ===== Routes PUBLIQUES (authentification propre à chaque route) ==========================================
    /** Désinscription : `GET` lit le lien (aucune écriture), `POST` l'applique. Le jeton signé vaut preuve pour cette seule action. */
    const unsubscribeClaims = (req: FastifyRequest) => {
      const { t } = parse(notifUnsubscribeQuerySchema, req.query);
      const secret = deps.config.unsubscribeSecret;
      const claims = secret ? verifyUnsubscribeToken(t, secret) : null;
      if (!claims) throw forbidden(NotifCode.TOKEN_INVALID, "Lien de désinscription invalide ou expiré.");
      return { token: t, claims };
    };
    scope.get("/public/unsubscribe", { config: { public: true } }, async (req, reply) => {
      await publicThrottle(req, reply, "unsubscribe");
      const { claims } = unsubscribeClaims(req);
      const settingsCtx = createSystemContext(claims.tenantId);
      const settings = unwrapOrThrow(await getNotificationSettings(deps, settingsCtx));
      return { channel: claims.channel, applied: false, organization: settings.senderName };
    });
    scope.post("/public/unsubscribe", { config: { public: true } }, async (req, reply) => {
      await publicThrottle(req, reply, "unsubscribe");
      const { token, claims } = unsubscribeClaims(req);
      const ctx = createSystemContext(claims.tenantId);
      const r = unwrapOrThrow(await applyUnsubscribe(deps, ctx, token));
      const settings = unwrapOrThrow(await getNotificationSettings(deps, ctx));
      return { ...r, organization: settings.senderName };
    });

    /** Accusés des fournisseurs : corps SIGNÉ (HMAC-SHA256 du corps brut, en-tête `x-notifications-signature: sha256=<hex>`). */
    await scope.register(async (hook) => {
      hook.setErrorHandler((error, request, reply) => handleError(error, request, reply));
      hook.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
      hook.post("/webhooks/:tenantId/delivery-status", { config: { public: true }, bodyLimit: 64 * 1024 }, async (req, reply) => {
        await publicThrottle(req, reply, "webhook");
        const tenantId = parse(notifUuidSchema, (req.params as { tenantId?: unknown }).tenantId);
        const secret = deps.config.webhookSecret;
        const raw = typeof req.body === "string" ? req.body : "";
        if (!secret || !verifyBodySignature(raw, req.headers["x-notifications-signature"] as string | undefined, secret)) {
          throw forbidden(NotifCode.SIGNATURE_INVALID, "Signature invalide.");
        }
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          throw new ValidationError("Corps JSON invalide.", [], { code: NotifCode.INVALID_INPUT });
        }
        const r = unwrapOrThrow(await applyDeliveryStatusWebhook(deps, createSystemContext(tenantId), parse(notifDeliveryStatusWebhookBodySchema, json)));
        return reply.status(200).send({ matched: r.matched });
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que les adaptateurs de plateforme renseignent (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("notificationsPorts")) app.decorate("notificationsPorts", createNotificationsPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/notifications`). */
export default async function notificationsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("notificationsPorts")) app.decorate("notificationsPorts", createNotificationsPortRegistry());
  const deps = createNotificationsDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: runtime.auditPort,
    logger: runtime.logger,
    portsProvider: () => app.notificationsPorts.current,
    config: configFromEnv(runtime.env),
    channels: (d) => createChannelRegistry(d, { env: runtime.env }),
  });
  await app.register(notificationsPlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: runtime.rateLimiter as unknown as RateLimiterLike,
  });
}

export { signUnsubscribeToken };
