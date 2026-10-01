/**
 * Défauts d'ASSEMBLAGE : un test de non-régression par défaut corrigé (numérotation = rapport d'intégration).
 * Même plateforme que le test de sortie de phase (vrais plugins legacy, vrai registre, vrai Postgres/Redis), mais
 * des scénarios courts et ciblés, avec un tenant legacy présent dès le démarrage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAuditHandler } from "../../src/modules/audit/domain/events";
import { listPublicRoutes } from "../../src/platform/public-routes";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, legacyModule, startPhase1Platform, waitFor, type Phase1Env } from "./support/harness";
import { loginWithMfaEnrollment, provisionByConsole, readAuditLog, redeemInvitation, type ProvisionedOwner, type Session } from "./support/scenario";

const LEGACY_TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const LEGACY_USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000a2";

describeIntegration.skipIf(!REDIS_URL)("assemblage : cohabitation legacy / v2 et contrat de plugin uniforme", () => {
  let p: Phase1Env;
  let T: ProvisionedOwner;
  let owner: Session;
  let legacyToken: string;

  beforeAll(async () => {
    p = await startPhase1Platform({ legacyTenants: [{ id: LEGACY_TENANT, slug: "ecole-legacy", name: "École Legacy", is_active: true }] });
    p.legacy.users.push({ id: LEGACY_USER, email: "admin@legacy.test", tenantId: LEGACY_TENANT, tenantSlug: "ecole-legacy", roles: ["admin"] });
    legacyToken = p.generateLegacyToken({ id: LEGACY_USER, tenantId: LEGACY_TENANT, tenantSlug: "ecole-legacy", role: "admin" });
    T = await provisionByConsole(p, { name: "Tenant Assembly", slug: "assembly", packs: ["HIGHER"], ownerEmail: "owner@assembly.test" });
    await redeemInvitation(p, T.ownerEmail);
    owner = await loginWithMfaEnrollment(p, T.ownerEmail, T.slug);
  }, 240_000);
  afterAll(async () => {
    await p?.stop();
  });

  it("[D1] contrat uniforme : chaque module est servi UNE fois sous /api/v1/<clé>, sans double préfixe", () => {
    for (const [method, url] of [
      ["GET", "/api/v1/tenancy/institutions"],
      ["GET", "/api/v1/entitlements/me"],
      ["GET", "/api/v1/rbac/roles"],
      ["GET", "/api/v1/audit/logs"],
      ["GET", "/api/v1/finance/fees"],
      ["POST", "/api/v1/iam/login"],
      ["GET", "/api/v1/platform/tenants"],
    ] as const) {
      expect(p.app.hasRoute({ method, url }), `${method} ${url}`).toBe(true);
    }
    // Avant la correction, tenancy/entitlements/rbac/finance posaient leur préfixe EN PLUS de celui du registre.
    expect(p.app.hasRoute({ method: "GET", url: "/api/v1/tenancy/api/v1/tenancy/institutions" })).toBe(false);
    expect(p.app.hasRoute({ method: "GET", url: "/api/v1/rbac/api/v1/rbac/roles" })).toBe(false);
    expect(p.app.hasRoute({ method: "GET", url: "/api/v1/finance/api/v1/finance/fees" })).toBe(false);
    expect(p.app.hasRoute({ method: "GET", url: "/api/v1/entitlements/api/v1/entitlements/me" })).toBe(false);
  });

  it("[D2] les décorateurs de la racine (rbac, entitlements, iam) sont visibles de TOUS les modules gardés", async () => {
    expect(p.app.hasDecorator("rbac")).toBe(true);
    expect(p.app.hasDecorator("entitlements")).toBe(true);
    expect(p.app.hasDecorator("iam")).toBe(true);
    // finance (garde rbac + requireFeature) et audit (garde rbac) s'exécutent avec les droits du propriétaire.
    expect((await p.http("GET", "/api/v1/finance/fees", { token: owner.accessToken })).status).toBe(200);
    expect((await p.http("GET", "/api/v1/audit/logs?limit=1", { token: owner.accessToken })).status).toBe(200);
  });

  it("[D3] routes publiques DÉRIVÉES de config.public : le middleware legacy ne les rejette plus (401 TOKEN_MISSING)", async () => {
    const login = await p.http("POST", "/api/v1/iam/login", { body: { email: "inconnu@nowhere.test", password: "Un-Mot-De-Passe-Long-1", client: "mobile" } });
    expect(login.status).toBe(401);
    expect(login.body.code).not.toBe("TOKEN_MISSING");
    expect(login.body.kind).toBeDefined(); // corps d'erreur du kernel, pas celui du legacy

    const refresh = await p.http("POST", "/api/v1/iam/refresh", { body: { refreshToken: "rt1.alpha.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", client: "mobile" } });
    expect(refresh.status).toBe(401);
    expect(refresh.body.code).not.toBe("TOKEN_MISSING");

    const hook = await p.http("POST", `/api/v1/finance/webhooks/sandbox/${T.tenantId}`, { rawBody: "{}", headers: { "x-sandbox-signature": "0".repeat(64) } });
    expect(hook.status).toBe(401);
    expect(hook.body.code).toMatch(/signature/i);
    expect(JSON.stringify(hook.body)).not.toContain("TOKEN_MISSING");

    // La liste n'est PAS un préfixe codé en dur : une route de tenant voisine reste protégée par le legacy.
    expect((await p.http("GET", "/api/v1/iam/me")).body.code).toBe("TOKEN_MISSING");
    const derived = listPublicRoutes().map((r) => r.url);
    expect(derived).toContain("/api/v1/iam/login");
    expect(derived).not.toContain("/api/v1/iam/me");
  });

  it("[D3b] garde-fou : AUCUNE route publique ne répond favorablement sans identifiants, hors celles ouvertes par conception", async () => {
    // `config.public` retire la garde « contexte présent » ET le middleware legacy : la route doit donc se défendre seule.
    const OPEN_BY_DESIGN = new Map([
      ["POST /api/v1/iam/logout", 204], // sans jeton ni cookie : simple effacement du cookie
      // reportcards : clés PUBLIQUES de signature (vérification hors ligne d'un bulletin, spec 013 AC4.3) — publiques par conception.
      ["GET /.well-known/ecoledigitale-keys.json", 200],
      ["GET /api/v1/public/keys", 200],
      ["GET /api/v1/reportcards/public/keys", 200],
    ]);
    const routes = listPublicRoutes().filter((r) => r.method !== "HEAD");
    expect(routes.length).toBeGreaterThanOrEqual(20);
    const fill: Record<string, string> = { provider: "sandbox", key: "STARTER", featureKey: "finance.online-payment", tenantId: T.tenantId };
    for (const r of routes) {
      const url = r.url.replace(/:([A-Za-z]+)/g, (_m, name: string) => fill[name] ?? "0192f0a4-7b1e-7c3a-8d2e-0000000000ee");
      const hasBody = ["POST", "PUT", "PATCH"].includes(r.method);
      const res = await p.http(r.method, url, hasBody ? { body: {} } : {});
      const label = `${r.method} ${r.url} -> ${res.status} ${res.raw.slice(0, 120)}`;
      const expected = OPEN_BY_DESIGN.get(`${r.method} ${r.url}`);
      if (expected) expect(res.status, label).toBe(expected);
      else {
        expect(res.status, label).toBeGreaterThanOrEqual(400);
        expect(res.status, label).toBeLessThan(500);
      }
    }
  });

  it("[D4] jeton legacy valide -> request.ctx (aucun droit RBAC) ; jeton IAM v2 valide -> request.ctx ; les deux cohabitent", async () => {
    const viaLegacy = await p.http("GET", "/api/v1/rbac/me/permissions", { token: legacyToken });
    expect(viaLegacy.status, JSON.stringify(viaLegacy.body)).toBe(200);
    expect(viaLegacy.body.tenantId).toBe(LEGACY_TENANT);
    expect(viaLegacy.body.userId).toBe(LEGACY_USER);
    expect(JSON.stringify(viaLegacy.body.permissions ?? [])).not.toContain("finance");

    const viaIam = await p.http("GET", "/api/v1/rbac/me/permissions", { token: owner.accessToken });
    expect(viaIam.status, JSON.stringify(viaIam.body)).toBe(200);
    expect(viaIam.body.tenantId).toBe(T.tenantId);
    expect(viaIam.body.userId).toBe(owner.identityId);

    // Refus par défaut : le contexte legacy existe mais n'a aucune assignation v2.
    expect((await p.http("GET", "/api/v1/finance/fees", { token: legacyToken })).status).toBe(403);
    // Révocation sur TOUTES les méthodes : une session IAM révoquée n'ouvre plus rien.
  });

  it("[D5] les routes legacy sont inchangées : jeton legacy accepté, jeton IAM inconnu du legacy, pas de jeton refusé", async () => {
    const ok = await p.http("GET", "/api/v1/legacy-probe", { token: legacyToken });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ userId: LEGACY_USER, role: "admin" });
    expect((await p.http("GET", "/api/v1/legacy-probe", { token: owner.accessToken })).status).toBe(401);
    const anonymous = await p.http("GET", "/api/v1/legacy-probe");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe("TOKEN_MISSING");
  });

  it("[D6] le jeton IAM révoqué (déconnexion) cesse d'ouvrir les routes v2 immédiatement", async () => {
    const second = await provisionByConsole(p, { name: "Tenant Révocation", slug: "revocation", packs: ["HIGHER"], ownerEmail: "owner@revocation.test" });
    await redeemInvitation(p, second.ownerEmail);
    const s = await loginWithMfaEnrollment(p, second.ownerEmail, second.slug);
    expect((await p.http("GET", "/api/v1/tenancy/institutions", { token: s.accessToken })).status).toBe(200);
    const out = await p.http("POST", "/api/v1/iam/logout", { token: s.accessToken, body: {} });
    expect(out.status).toBe(204);
    expect((await p.http("GET", "/api/v1/tenancy/institutions", { token: s.accessToken })).status).toBe(401);
  });

  it("[D7] console et impersonation : JWT super-admin legacy accepté, jeton de tenant ou IAM refusé", async () => {
    const catalog = await p.http("GET", "/api/v1/entitlements/admin/catalog", { token: p.operatorToken });
    expect(catalog.status, JSON.stringify(catalog.body)).toBe(200);
    expect(catalog.body.plans.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(["STARTER", "PROFESSIONAL", "ENTERPRISE"]));
    expect((await p.http("GET", "/api/v1/entitlements/admin/catalog", { token: owner.accessToken })).status).toBe(401);
    expect((await p.http("GET", "/api/v1/entitlements/admin/catalog", { token: legacyToken })).status).toBe(401);

    // Jeton super-admin révoqué (liste noire legacy) : refusé sur GET aussi (le legacy ne contrôle que les écritures).
    const { generateSuperAdminToken } = await legacyModule<{ generateSuperAdminToken(id: string, email: string): string }>("services/super-admin-jwt.service");
    const revoked = generateSuperAdminToken(p.operatorId, "ops@plateforme.test");
    const payload = JSON.parse(Buffer.from(revoked.split(".")[1]!, "base64url").toString());
    p.legacy.blacklisted.add(payload.jti);
    expect((await p.http("GET", "/api/v1/platform/tenants", { token: revoked })).status).toBe(401);
    // Opérateur désactivé : refusé.
    p.legacy.superAdmins.set(p.operatorId, { active: false });
    expect((await p.http("GET", "/api/v1/platform/tenants", { token: p.operatorToken })).status).toBe(403);
    p.legacy.superAdmins.set(p.operatorId, { active: true });
    expect((await p.http("GET", "/api/v1/platform/tenants", { token: p.operatorToken })).status).toBe(200);

    // Impersonation : jeton distinct, MFA fausse, tracée comme événement critique.
    const imp = await p.http("POST", "/api/v1/iam/impersonation", {
      token: p.operatorToken,
      body: { tenantId: T.tenantId, identityId: owner.identityId, reason: "Assistance : vérification du paramétrage" },
    });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    const me = await p.http("GET", "/api/v1/iam/me", { token: imp.body.accessToken });
    expect(me.body.impersonatedBy).toBe(p.operatorId);
    // MFA non satisfaite en impersonation : une permission sensible reste refusée.
    const sensitive = await p.http("POST", "/api/v1/rbac/roles", { token: imp.body.accessToken, body: { label: "Via impersonation", permissions: ["audit.read"] } });
    expect(sensitive.status).toBe(403);
    expect(sensitive.body.code).toBe("rbac.mfa_required");
    const entries = await waitFor(
      async () => {
        const all = await readAuditLog(p, owner.accessToken);
        return all.some((e) => e.action === "impersonation.started") ? all : false;
      },
      { label: "impersonation.started dans l'audit (relais worker)", timeoutMs: 45_000 },
    );
    const started = entries.find((e) => e.action === "impersonation.started");
    expect(started.severity).toBe("critical");
    expect(started.actorType).toBe("superAdmin");
  });

  it("[D8] l'audit journalise les événements de sécurité d'iam (MFA, mot de passe, accès) — abonnements ajoutés", () => {
    for (const type of ["iam.mfa.enabled", "iam.mfa.disabled", "iam.mfa.reset", "iam.password.changed", "iam.membership.created", "iam.membership.changed"]) {
      expect(resolveAuditHandler(type), type).toBeDefined();
    }
  });
});
