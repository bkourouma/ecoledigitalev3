/**
 * Tests unitaires (sans base) des briques d'assemblage de `src/platform` : routes publiques dérivées,
 * autorisateur d'opérateur, aiguillage des jetons, diffusion d'événements, notifieur de compte.
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "@ecoledigitale/kernel";
import { createLoggingNotifier, createSmtpNotifier } from "../src/platform/account-notifier";
import { fanoutChannel, parseFanoutMessage } from "../src/platform/event-fanout";
import { isDeclaredPublicRoute, listPublicRoutes, resetPublicRoutesForTests, shouldBypassLegacyAuth, trackPublicRoutes } from "../src/platform/public-routes";
import { SuperAdminAuthCode, createSuperAdminAuthorizer, type SuperAdminAuthDeps, type SuperAdminTokenClaims } from "../src/platform/super-admin-authorizer";
import { moduleKeyOfRoute } from "../src/platform/v2-auth";
import { isIamBearerToken } from "../src/modules/iam";

const OPERATOR = "0192f0a4-7b1e-7c3a-8d2e-0000000000f1";
const TOKEN = "x".repeat(24);
const req = (authorization?: string) => ({ headers: authorization === undefined ? {} : { authorization } });

describe("routes publiques DÉRIVÉES de config.public (middleware legacy)", () => {
  it("relève les routes déclarées publiques, avec le préfixe complet, et rien d'autre", async () => {
    resetPublicRoutesForTests();
    const app = Fastify();
    trackPublicRoutes(app);
    await app.register(
      async (scope) => {
        scope.post("/open", { config: { public: true } }, async () => ({ ok: true }));
        scope.post("/webhooks/:provider/:tenantId", { config: { public: true } }, async () => ({ ok: true }));
        scope.get("/private", async () => ({ ok: true }));
        scope.get("/not-quite", { config: { public: "true" as unknown as boolean } }, async () => ({ ok: true }));
      },
      { prefix: "/api/v1/demo" },
    );
    await app.ready();
    expect(listPublicRoutes()).toEqual([
      { method: "POST", url: "/api/v1/demo/open" },
      { method: "POST", url: "/api/v1/demo/webhooks/:provider/:tenantId" },
    ]);
    await app.close();
  });

  it("isDeclaredPublicRoute / shouldBypassLegacyAuth : appariement par méthode + route, jamais par préfixe", async () => {
    resetPublicRoutesForTests();
    const app = Fastify();
    trackPublicRoutes(app);
    const seen: Record<string, boolean> = {};
    app.addHook("preHandler", async (request) => {
      seen[`${request.method} ${request.url}`] = shouldBypassLegacyAuth(request);
      seen[`public ${request.method} ${request.url}`] = isDeclaredPublicRoute(request);
    });
    app.post("/api/v1/x/login", { config: { public: true } }, async () => "ok");
    app.get("/api/v1/x/login", async () => "ok"); // même chemin, autre méthode : NON publique
    app.get("/api/v1/x/login/extra", async () => "ok"); // route voisine : NON publique
    await app.ready();
    await app.inject({ method: "POST", url: "/api/v1/x/login" });
    await app.inject({ method: "GET", url: "/api/v1/x/login" });
    await app.inject({ method: "GET", url: "/api/v1/x/login/extra" });
    expect(seen["POST /api/v1/x/login"]).toBe(true);
    expect(seen["GET /api/v1/x/login"]).toBe(false);
    expect(seen["GET /api/v1/x/login/extra"]).toBe(false);
    await app.close();
  });

  it("sans plateforme v2 (liste vide) le contournement du legacy est inopérant : comportement inchangé", () => {
    resetPublicRoutesForTests();
    expect(shouldBypassLegacyAuth({ method: "GET", routeOptions: { url: "/api/v1/auth/login" } } as never)).toBe(false);
    expect(shouldBypassLegacyAuth({ method: "GET", routeOptions: {} } as never)).toBe(false);
  });

  it("une requête déjà authentifiée par un jeton IAM v2 dispense le middleware legacy", () => {
    resetPublicRoutesForTests();
    expect(shouldBypassLegacyAuth({ method: "GET", v2Authenticated: true, routeOptions: { url: "/api/v1/rbac/roles" } } as never)).toBe(true);
  });
});

describe("SuperAdminAuthorizer (JWT super-admin legacy)", () => {
  const claims = (over: Partial<SuperAdminTokenClaims> = {}): SuperAdminTokenClaims => ({ superAdminId: OPERATOR, email: "ops@x.test", jti: "jti-1", scope: "super_admin", ...over });
  const authorizer = (over: Partial<SuperAdminAuthDeps> = {}) =>
    createSuperAdminAuthorizer({ verify: () => claims(), isRevoked: async () => false, isActive: async () => true, ...over });
  const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
      return undefined;
    } catch (e) {
      return (e as { code?: string }).code;
    }
  };

  it("accepte un jeton valide, non révoqué, d'un opérateur actif", async () => {
    await expect(authorizer().authorize(req(`Bearer ${TOKEN}`))).resolves.toEqual({ actorId: OPERATOR, email: "ops@x.test" });
  });
  it("refuse l'absence de jeton, un en-tête mal formé et un schéma autre que Bearer (401, message unique)", async () => {
    for (const header of [undefined, "", "Bearer", "Basic abcdefghijklmnopqrstuvwxyz", `bearer ${TOKEN}`, "Bearer court"]) {
      expect(await codeOf(authorizer().authorize(req(header))), String(header)).toBe(SuperAdminAuthCode.missing);
    }
  });
  it("refuse un jeton que le legacy ne vérifie pas (tenant, forgé, expiré) sans détail exploitable", async () => {
    const verify = vi.fn(() => {
      throw new Error("jwt expired");
    });
    expect(await codeOf(authorizer({ verify }).authorize(req(`Bearer ${TOKEN}`)))).toBe(SuperAdminAuthCode.invalid);
  });
  it("refuse un jeton vérifié mais dont le scope n'est pas super_admin, ou dont l'identifiant n'est pas un UUID", async () => {
    expect(await codeOf(authorizer({ verify: () => claims({ scope: "tenant_user" }) }).authorize(req(`Bearer ${TOKEN}`)))).toBe(SuperAdminAuthCode.invalid);
    expect(await codeOf(authorizer({ verify: () => claims({ superAdminId: "42" }) }).authorize(req(`Bearer ${TOKEN}`)))).toBe(SuperAdminAuthCode.invalid);
    expect(await codeOf(authorizer({ verify: () => claims({ jti: "" }) }).authorize(req(`Bearer ${TOKEN}`)))).toBe(SuperAdminAuthCode.invalid);
  });
  it("refuse un jeton révoqué (liste noire) et un compte désactivé (403)", async () => {
    expect(await codeOf(authorizer({ isRevoked: async () => true }).authorize(req(`Bearer ${TOKEN}`)))).toBe(SuperAdminAuthCode.revoked);
    const err = await authorizer({ isActive: async () => false }).authorize(req(`Bearer ${TOKEN}`)).catch((e: unknown) => e);
    expect((err as { code: string; httpStatus: number }).code).toBe(SuperAdminAuthCode.inactive);
    expect((err as { httpStatus: number }).httpStatus).toBe(403);
  });
  it("les erreurs sont des UnauthorizedError du kernel (statut 401)", async () => {
    const err = await authorizer().authorize(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
  });
});

describe("aiguillage des jetons", () => {
  const jwt = (header: object) => `${Buffer.from(JSON.stringify(header)).toString("base64url")}.e30.${"A".repeat(43)}`;
  it("reconnaît les jetons porteur IAM (at+jwt, imp+jwt) et laisse passer les JWT legacy, MFA, ou illisibles", () => {
    expect(isIamBearerToken(jwt({ alg: "HS256", typ: "at+jwt" }))).toBe(true);
    expect(isIamBearerToken(jwt({ alg: "HS256", typ: "imp+jwt" }))).toBe(true);
    expect(isIamBearerToken(jwt({ alg: "HS256", typ: "JWT" }))).toBe(false);
    expect(isIamBearerToken(jwt({ alg: "HS256", typ: "mfa+jwt" }))).toBe(false);
    expect(isIamBearerToken(jwt({ alg: "HS256", typ: "enr+jwt" }))).toBe(false);
    expect(isIamBearerToken("pas-un-jwt")).toBe(false);
    expect(isIamBearerToken("")).toBe(false);
  });
  it("moduleKeyOfRoute : seules les routes /api/v1/<module chargé>/… sont des routes de module", () => {
    const keys = new Set(["iam", "finance"]);
    expect(moduleKeyOfRoute("/api/v1/iam/me", keys)).toBe("iam");
    expect(moduleKeyOfRoute("/api/v1/finance/webhooks/:provider/:tenantId", keys)).toBe("finance");
    expect(moduleKeyOfRoute("/api/v1/users", keys)).toBeUndefined();
    expect(moduleKeyOfRoute("/api/v1/iamx/me", keys)).toBeUndefined();
    expect(moduleKeyOfRoute("/api/v1", keys)).toBeUndefined();
    expect(moduleKeyOfRoute(undefined, keys)).toBeUndefined();
  });
});

describe("diffusion d'événements du worker vers l'API (Redis)", () => {
  const event = {
    id: "0192f0a4-7b1e-7c3a-8d2e-000000000001",
    type: "rbac.assignment.changed",
    version: 1,
    tenantId: "0192f0a4-7b1e-7c3a-8d2e-0000000000aa",
    occurredAt: "2026-10-01T10:00:00.000Z",
    payload: { v: 1 },
  };
  it("le canal est préfixé par WORKER_QUEUE_PREFIX (environnements isolés sur un même Redis)", () => {
    expect(fanoutChannel({})).toBe("ed:event-fanout");
    expect(fanoutChannel({ WORKER_QUEUE_PREFIX: "staging" })).toBe("staging:event-fanout");
  });
  it("n'accepte que de vrais événements de domaine : JSON valide, type conforme, tenant UUID", () => {
    expect(parseFanoutMessage(JSON.stringify(event))).toMatchObject({ type: "rbac.assignment.changed" });
    for (const bad of ["pas du json", "null", "42", JSON.stringify({ ...event, type: "Mauvais Type" }), JSON.stringify({ ...event, tenantId: "t1" }), JSON.stringify({ ...event, id: 5 })]) {
      expect(parseFanoutMessage(bad), bad).toBeNull();
    }
  });
});

describe("notifications de compte (iam)", () => {
  const input = { email: "awa@x.test", token: "SECRET-TOKEN-0123456789", expiresAt: new Date("2026-10-02T10:00:00Z"), tenantName: "Lycée Alpha" };

  it("sans SMTP : aucun envoi, et le jeton n'est JAMAIS écrit dans les journaux", async () => {
    const warn = vi.fn();
    const notifier = createLoggingNotifier({ warn });
    await notifier.sendInvitation(input);
    await notifier.sendPasswordReset(input);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("awa@x.test");
  });

  it("avec SMTP : le lien construit sur V2_APP_BASE_URL porte le jeton ; le HTML est échappé", async () => {
    const sendMail = vi.fn(async () => undefined);
    const logger = { warn: vi.fn(), info: vi.fn() };
    const notifier = createSmtpNotifier({ sendMail }, { SMTP_USER: "noreply@x.test", V2_APP_BASE_URL: "https://app.example/" }, logger);
    await notifier.sendInvitation({ ...input, tenantName: 'Lycée "Alpha" <b>' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = (sendMail.mock.calls[0] as unknown as [{ to: string; text: string; html: string; subject: string }])[0];
    expect(message.to).toBe("awa@x.test");
    expect(message.text).toContain("https://app.example/auth/invitation?token=SECRET-TOKEN-0123456789");
    expect(message.html).not.toContain("<b>");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("SECRET-TOKEN");
  });

  it("sans V2_APP_BASE_URL : aucun e-mail (pas de lien relatif ambigu), avertissement sans jeton", async () => {
    const sendMail = vi.fn(async () => undefined);
    const logger = { warn: vi.fn(), info: vi.fn() };
    await createSmtpNotifier({ sendMail }, { SMTP_USER: "noreply@x.test" }, logger).sendPasswordReset(input);
    expect(sendMail).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SECRET-TOKEN");
  });
});
