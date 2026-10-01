/**
 * Plugin Fastify du module iam : `/api/v1/iam/*`.
 *
 * À enregistrer avec `{ prefix: "/api/v1/iam" }` (ou via `registerIam`).
 * Plugin ENCAPSULÉ (pas de `fastify-plugin`) : son gestionnaire d'erreurs ne
 * déborde pas sur le reste de l'application.
 *
 * Chaque route : schéma Zod (contrats) → use case → réponse. Aucune requête SQL ici.
 *
 * Routes d'administration (`/admin/*`) : enregistrées SEULEMENT si une
 * `permissionGuard` (module rbac) est fournie. Impersonation : SEULEMENT si
 * `authenticateSuperAdmin` est fourni. Échec fermé : sans ces ports, ces routes n'existent pas.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { UnauthorizedError, isAppError, toErrorBody, unwrap } from "@ecoledigitale/kernel";
import {
  AuthErrorCodes,
  ImpersonationRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  MfaChallengeRequestSchema,
  MfaDisableRequestSchema,
  MfaEnrollRequestSchema,
  MfaVerifyRequestSchema,
  PasswordChangeRequestSchema,
  PasswordForgotRequestSchema,
  PasswordResetRequestSchema,
  ProvisionMemberRequestSchema,
  RefreshRequestSchema,
  SwitchTenantRequestSchema,
  UpdateMemberRequestSchema,
  type ImpersonationResponse,
  type MemberListResponse,
  type SessionListResponse,
} from "@ecoledigitale/contracts/src/v2/iam";
import { TooManyAttemptsError } from "../application/deps";
import type { MfaSubject } from "../application/mfa";
import type { AuthenticatedPrincipal, SuperAdminAuthenticator } from "../application/ports";
import type { IamService } from "../application/service";
import { peekJwtTyp } from "../domain/tokens";
import { loadIamConfig } from "../config";
import { createIamService } from "../application/service";
import type { ModuleRuntime } from "../../../platform/runtime";
import {
  assertAllowedOrigin,
  bearerToken,
  clearRefreshCookie,
  noStore,
  presentOutcome,
  presentVerify,
  readCookie,
  requestMeta,
  setRefreshCookie,
} from "./helpers";
import { uuidParam } from "./params";

export const IAM_PREFIX = "/api/v1/iam";

export interface IamPluginOptions {
  iam: IamService;
  /**
   * Fabrique de garde de permission : passer `requirePermission` du module rbac
   * (elle lit `request.ctx`, que l'authentification d'iam renseigne). Sans elle :
   * pas de routes `/admin/*` (échec fermé, aucun contrôle de rôle codé en dur).
   */
  requirePermission?: (permission: string) => preHandlerAsyncHookHandler;
  /** Authentification du super-admin appelant. Sans elle : pas de route `/impersonation`. */
  authenticateSuperAdmin?: SuperAdminAuthenticator;
  /** Tenant attendu d'après la requête (sous-domaine, en-tête de l'API gateway) : s'il diffère du jeton, refus. */
  expectedTenantSlug?: (request: FastifyRequest) => string | undefined;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Renseigné par `iamAuthHook` / les routes authentifiées d'iam. */
    iamAuth?: { principal: AuthenticatedPrincipal };
  }
}

/** `request.ctx` : contexte lu par le module rbac (`requirePermission`) et les autres modules. */
function setRequestCtx(request: FastifyRequest, ctx: AuthenticatedPrincipal["ctx"]): void {
  (request as unknown as { ctx?: AuthenticatedPrincipal["ctx"] }).ctx = ctx;
}

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  return schema.parse(value ?? {});
}

/**
 * Hook d'authentification réutilisable par d'AUTRES modules / l'API legacy :
 *   `fastify.get("/x", { preHandler: iamAuthHook(iam) }, handler)`
 * Vérifie le jeton ET la session (toutes méthodes HTTP), puis pose `request.iamAuth`.
 */
export function iamAuthHook(iam: IamService, options: Pick<IamPluginOptions, "expectedTenantSlug"> & { allowImpersonation?: boolean } = {}) {
  return async (request: FastifyRequest): Promise<void> => {
    // Déjà authentifiée par la plateforme (hook `onRequest` de `platform/v2-auth.ts`) : une seule vérification
    // de session par requête (chaque vérification coûte une requête SQL).
    if (request.iamAuth) return;
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedError("Authentification requise.", { code: AuthErrorCodes.tokenInvalid });
    const expected = options.expectedTenantSlug?.(request);
    const result = await iam.authenticate(token, {
      requestId: requestMeta(request).requestId,
      allowImpersonation: options.allowImpersonation ?? true,
      ...(expected !== undefined ? { expectedTenantSlug: expected } : {}),
    });
    const principal = unwrap(result).principal;
    request.iamAuth = { principal };
    setRequestCtx(request, principal.ctx);
  };
}

export const iamPlugin: FastifyPluginAsync<IamPluginOptions> = async (app, options) => {
  const { iam } = options;
  const config = iam.deps.config;
  const clock = iam.deps.clock;
  const authHook = iamAuthHook(iam, options);

  // ---------------------------------------------------------------------------
  // Erreurs : corps homogène, jamais de stack ni de détail interne.
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    noStore(reply);
    if (error instanceof ZodError) {
      return reply.status(400).send({
        status: 400,
        code: "VALIDATION_FAILED",
        kind: "validation",
        message: "Requête invalide.",
        issues: error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
        requestId: request.id,
      });
    }
    if (isAppError(error)) {
      if (error instanceof TooManyAttemptsError) void reply.header("Retry-After", String(error.retryAfterSec));
      const status = error instanceof TooManyAttemptsError ? 429 : error.httpStatus;
      return reply.status(status).send({ ...toErrorBody(error, request.id), status });
    }
    const fe = error as { statusCode?: number; code?: string };
    if (typeof fe.statusCode === "number" && fe.statusCode >= 400 && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ status: fe.statusCode, code: "BAD_REQUEST", kind: "validation", message: "Requête invalide.", requestId: request.id });
    }
    request.log.error({ err: error }, "iam: erreur interne");
    return reply.status(500).send({ status: 500, code: "INTERNAL", kind: "internal", message: "Erreur interne.", requestId: request.id });
  });

  const auth = { preHandler: authHook };
  // Routes qui s'authentifient elles-mêmes (mot de passe, jeton d'étape MFA, refresh token, jeton de reset,
  // JWT super-admin) ou qui doivent rester joignables sans session : `public` dispense de la garde « contexte
  // présent » du registre ET de l'authentification legacy (`platform/public-routes.ts`). Sans cette
  // déclaration, `POST /api/v1/iam/login` répondait 401 (TOKEN_MISSING) avant même d'atteindre le module.
  const open = { config: { public: true } };
  const principalOf = (request: FastifyRequest): AuthenticatedPrincipal => {
    if (!request.iamAuth) throw new UnauthorizedError("Authentification requise.", { code: AuthErrorCodes.tokenInvalid });
    return request.iamAuth.principal;
  };

  // ---------------------------------------------------------------------------
  // Authentification
  // ---------------------------------------------------------------------------
  app.post("/login", open, async (request, reply) => {
    const body = parse(LoginRequestSchema, request.body);
    const result = await iam.login({
      email: body.email,
      password: body.password,
      tenantSlug: body.tenantSlug,
      activeRole: body.activeRole,
      deviceName: body.deviceName,
      meta: requestMeta(request),
    });
    return presentOutcome(reply, config, clock.now(), unwrap(result), body.client);
  });

  app.post("/mfa/challenge", open, async (request, reply) => {
    const body = parse(MfaChallengeRequestSchema, request.body);
    const result = await iam.completeMfaChallenge({
      challengeToken: body.challengeToken,
      code: body.code,
      recoveryCode: body.recoveryCode,
      meta: requestMeta(request),
    });
    return presentOutcome(reply, config, clock.now(), unwrap(result), body.client);
  });

  app.post("/refresh", open, async (request, reply) => {
    const body = parse(RefreshRequestSchema, request.body);
    const fromCookie = body.refreshToken === undefined;
    if (fromCookie) {
      const origin = assertAllowedOrigin(request, config);
      if (origin) throw origin;
    }
    const token = body.refreshToken ?? readCookie(request, config.cookie.name);
    noStore(reply);
    if (!token) throw new UnauthorizedError("Session expirée. Reconnectez-vous.", { code: AuthErrorCodes.refreshInvalid });
    const result = await iam.refresh({ refreshToken: token, meta: requestMeta(request) });
    if (!result.ok) {
      // Un cookie devenu inutilisable est effacé pour ne pas être rejoué en boucle.
      if (fromCookie) clearRefreshCookie(reply, config);
      throw result.error;
    }
    const s = result.value.session;
    const client = body.client;
    const now = clock.now();
    // Le jeton d'accès est renvoyé tel quel ; le refresh suit le transport du client.
    if (client === "web" && s.refreshToken && s.refreshExpiresAt) {
      setRefreshCookie(reply, config, s.refreshToken, s.refreshExpiresAt, now);
    }
    return {
      status: "refreshed" as const,
      tokenType: "Bearer" as const,
      accessToken: s.accessToken,
      expiresIn: Math.max(1, s.claims.exp - s.claims.iat),
      sessionId: s.sessionId,
      ...(client === "mobile" && s.refreshToken && s.refreshExpiresAt
        ? { refreshToken: s.refreshToken, refreshExpiresIn: Math.max(1, Math.floor((s.refreshExpiresAt.getTime() - now.getTime()) / 1000)) }
        : {}),
    };
  });

  app.post("/logout", open, async (request, reply) => {
    const body = parse(LogoutRequestSchema, request.body);
    noStore(reply);
    const meta = requestMeta(request);
    const cookieToken = body.refreshToken === undefined ? readCookie(request, config.cookie.name) : null;
    if (cookieToken) {
      const origin = assertAllowedOrigin(request, config);
      if (origin) throw origin;
    }
    // 1. Jeton d'accès valide → on révoque sa session. 2. Sinon, le refresh token (accès expiré).
    const token = bearerToken(request);
    let done = false;
    if (token) {
      const auth_ = await iam.authenticate(token, { requestId: meta.requestId });
      if (auth_.ok) {
        await iam.logout(auth_.value.principal, meta);
        done = true;
      }
    }
    const refreshToken = body.refreshToken ?? cookieToken;
    if (!done && refreshToken) await iam.logoutByRefreshToken(refreshToken, meta);
    clearRefreshCookie(reply, config);
    return reply.status(204).send();
  });

  app.post("/logout-all", auth, async (request, reply) => {
    const result = await iam.logoutAll(principalOf(request), requestMeta(request));
    clearRefreshCookie(reply, config);
    noStore(reply);
    return { revoked: result.revoked };
  });

  app.get("/me", auth, async (request, reply) => {
    noStore(reply);
    const p = principalOf(request);
    return {
      userId: p.identityId,
      tenantId: p.ctx.tenantId,
      tenantSlug: p.tenantSlug,
      activeRole: p.activeRole,
      roles: [...p.availableRoles],
      sessionId: p.sessionId,
      mfa: p.mfa,
      impersonatedBy: p.impersonatedBy ?? null,
    };
  });

  app.post("/switch-tenant", auth, async (request, reply) => {
    const body = parse(SwitchTenantRequestSchema, request.body);
    const result = await iam.switchTenant(principalOf(request), { tenantId: body.tenantId, meta: requestMeta(request) });
    return presentOutcome(reply, config, clock.now(), unwrap(result), body.client);
  });

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------
  app.get("/sessions", auth, async (request, reply): Promise<SessionListResponse> => {
    noStore(reply);
    const rows = await iam.listSessions(principalOf(request));
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        current: r.current,
        kind: r.kind,
        activeRole: r.active_role,
        mfaVerified: r.mfa_verified,
        ip: r.ip,
        userAgent: r.user_agent,
        deviceName: r.device_name,
        createdAt: r.created_at.toISOString(),
        lastSeenAt: r.last_seen_at.toISOString(),
        expiresAt: r.expires_at.toISOString(),
      })),
    };
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", auth, async (request, reply) => {
    const id = uuidParam(request.params.id);
    const principal = principalOf(request);
    unwrap(await iam.revokeSession(principal, id, requestMeta(request)));
    if (id === principal.sessionId) clearRefreshCookie(reply, config);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Mots de passe
  // ---------------------------------------------------------------------------
  app.post("/password/change", auth, async (request, reply) => {
    const body = parse(PasswordChangeRequestSchema, request.body);
    const result = await iam.changePassword(principalOf(request), {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      meta: requestMeta(request),
    });
    return presentOutcome(reply, config, clock.now(), unwrap(result), body.client);
  });

  app.post("/password/forgot", open, async (request, reply) => {
    const body = parse(PasswordForgotRequestSchema, request.body);
    await iam.forgotPassword({ email: body.email, meta: requestMeta(request) });
    noStore(reply);
    // Réponse identique que le compte existe ou non.
    return reply.status(202).send({ message: "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé." });
  });

  app.post("/password/reset", open, async (request, reply) => {
    const body = parse(PasswordResetRequestSchema, request.body);
    unwrap(await iam.resetPassword({ token: body.token, newPassword: body.newPassword, meta: requestMeta(request) }));
    noStore(reply);
    clearRefreshCookie(reply, config);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // MFA
  // ---------------------------------------------------------------------------
  /** Jeton d'accès (session existante) OU jeton d'enrôlement (login en attente d'enrôlement). */
  async function mfaSubject(request: FastifyRequest): Promise<MfaSubject> {
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedError("Authentification requise.", { code: AuthErrorCodes.tokenInvalid });
    const meta = requestMeta(request);
    if (peekJwtTyp(token) === "enr+jwt") return unwrap(await iam.resolveEnrollmentToken(token, meta));
    await authHook(request);
    return { via: "session", principal: principalOf(request) };
  }

  app.post("/mfa/enroll", open, async (request, reply) => {
    const body = parse(MfaEnrollRequestSchema, request.body);
    const result = await iam.beginMfaEnrollment(await mfaSubject(request), { password: body.password, meta: requestMeta(request) });
    noStore(reply);
    const v = unwrap(result);
    return { otpauthUri: v.otpauthUri, secret: v.secret, issuer: v.issuer, accountName: v.accountName, digits: 6 as const, period: 30 as const, algorithm: "SHA1" as const };
  });

  app.post("/mfa/verify", open, async (request, reply) => {
    const body = parse(MfaVerifyRequestSchema, request.body);
    const result = await iam.confirmMfaEnrollment(await mfaSubject(request), { code: body.code, meta: requestMeta(request) });
    const v = unwrap(result);
    return presentVerify(reply, config, clock.now(), v.recoveryCodes, v.session, body.client);
  });

  app.post("/mfa/disable", auth, async (request, reply) => {
    const body = parse(MfaDisableRequestSchema, request.body);
    const result = await iam.disableMfa(principalOf(request), {
      password: body.password,
      code: body.code,
      recoveryCode: body.recoveryCode,
      meta: requestMeta(request),
    });
    return presentOutcome(reply, config, clock.now(), unwrap(result), body.client);
  });

  // ---------------------------------------------------------------------------
  // Administration du tenant (derrière la garde de permission du module rbac)
  // ---------------------------------------------------------------------------
  const permissionGuard = options.requirePermission;
  if (permissionGuard) {
    // Authentification d'iam (pose request.ctx), PUIS garde de permission du module rbac.
    const requirePermission = (permission: string): preHandlerAsyncHookHandler[] => [
      async (request) => authHook(request),
      permissionGuard(permission),
    ];

    app.get("/admin/members", { preHandler: requirePermission("iam.user.read") }, async (request, reply): Promise<MemberListResponse> => {
      noStore(reply);
      const q = request.query as { limit?: string; offset?: string };
      const rows = await iam.listMembers(principalOf(request), { limit: Number(q.limit) || 100, offset: Number(q.offset) || 0 });
      return {
        members: rows.map((m) => ({
          membershipId: m.id,
          identityId: m.identity_id,
          email: m.email,
          status: m.status,
          roles: m.roles,
          baseRole: m.base_role,
          mfaEnabled: m.mfa_enabled,
          createdAt: m.created_at.toISOString(),
        })),
      };
    });

    app.post("/admin/members", { preHandler: requirePermission("iam.user.invite") }, async (request, reply) => {
      const body = parse(ProvisionMemberRequestSchema, request.body);
      const p = principalOf(request);
      const out = unwrap(await iam.provisionMember(p.ctx, { email: body.email, roles: body.roles, sendInvitation: body.sendInvitation, invitedBy: p.identityId, meta: requestMeta(request) }));
      noStore(reply);
      return reply.status(201).send({ membershipId: out.membershipId });
    });

    app.patch<{ Params: { id: string } }>("/admin/members/:id", { preHandler: requirePermission("iam.user.manage") }, async (request, reply) => {
      const body = parse(UpdateMemberRequestSchema, request.body);
      const m = unwrap(await iam.updateMember(principalOf(request), uuidParam(request.params.id), { status: body.status, roles: body.roles }, requestMeta(request)));
      noStore(reply);
      return { membershipId: m.id, status: m.status, roles: m.roles };
    });

    app.post<{ Params: { id: string } }>("/admin/members/:id/sessions/revoke", { preHandler: requirePermission("iam.session.revoke") }, async (request, reply) => {
      const out = unwrap(await iam.adminRevokeMemberSessions(principalOf(request), uuidParam(request.params.id), requestMeta(request)));
      noStore(reply);
      return { revoked: out.revoked };
    });

    app.post<{ Params: { id: string } }>("/admin/members/:id/mfa/reset", { preHandler: requirePermission("iam.mfa.reset") }, async (request, reply) => {
      unwrap(await iam.adminResetMfa(principalOf(request), uuidParam(request.params.id), requestMeta(request)));
      return reply.status(204).send();
    });
  }

  // ---------------------------------------------------------------------------
  // Impersonation (console super-admin)
  // ---------------------------------------------------------------------------
  const authenticateSuperAdmin = options.authenticateSuperAdmin;
  if (authenticateSuperAdmin) {
    app.post("/impersonation", open, async (request, reply): Promise<ImpersonationResponse> => {
      const actor = await authenticateSuperAdmin({ headers: request.headers });
      if (!actor) throw new UnauthorizedError("Authentification requise.", { code: AuthErrorCodes.tokenInvalid });
      const body = parse(ImpersonationRequestSchema, request.body);
      const out = unwrap(await iam.startImpersonation(actor, { tenantId: body.tenantId, identityId: body.identityId, reason: body.reason, meta: requestMeta(request) }));
      noStore(reply);
      return {
        tokenType: "Bearer",
        accessToken: out.accessToken,
        expiresIn: Math.max(1, Math.floor((out.expiresAt.getTime() - clock.now().getTime()) / 1000)),
        sessionId: out.sessionId,
        user: out.user,
      };
    });
  }
};

/** Enregistre le plugin sous `/api/v1/iam`. */
export async function registerIam(app: FastifyInstance, options: IamPluginOptions): Promise<void> {
  await app.register(iamPlugin, { ...options, prefix: IAM_PREFIX } as IamPluginOptions & { prefix: string });
}

declare module "fastify" {
  interface FastifyInstance {
    /** Service d'identité (posé à la racine par `setup`) : lu par l'authentification de la plateforme. */
    iam: IamService;
  }
}

/**
 * Assemblage, étape 1 (instance RACINE) : construit le service d'identité à partir de l'environnement
 * (`IAM_JWT_SECRET`, `IAM_MFA_ENCRYPTION_KEY`… : le démarrage est REFUSÉ si un secret manque — ADR-008), du
 * limiteur de débit (Redis si `REDIS_URL`, sinon mémoire) et du notifieur de comptes du runtime, puis le décore
 * (`app.iam`) pour le hook d'authentification de la plateforme.
 */
export function setup(app: FastifyInstance, runtime: ModuleRuntime): void {
  const iam = createIamService({
    config: loadIamConfig(runtime.env),
    tenantDb: runtime.tenantDb,
    systemDb: runtime.systemDb,
    limiter: runtime.rateLimiter,
    notifier: runtime.accountNotifier,
    clock: runtime.clock,
    logger: runtime.logger,
  });
  app.decorate("iam", iam);
  app.addHook("onClose", async () => {
    await iam.drainBackground();
  });
}

/**
 * Assemblage, étape 2 : routes `/login`, `/refresh`, `/me`… (le registre applique `/api/v1/iam`).
 * L'administration des membres s'appuie sur `requirePermission` du rbac ; l'impersonation sur le
 * `SuperAdminAuthorizer` du runtime (JWT super-admin legacy, séparé du JWT tenant).
 */
export default async function iamModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.iam) throw new Error("iam : `setup` n'a pas été exécuté (app.iam absent).");
  await app.register(iamPlugin, {
    iam: app.iam,
    requirePermission: (permission) => runtime.requirePermission(permission),
    authenticateSuperAdmin: async (request) => {
      try {
        const identity = await runtime.superAdminAuthorizer.authorize(request);
        return { id: identity.actorId, email: identity.email ?? "" };
      } catch {
        return null;
      }
    },
  });
}
