/**
 * Passerelle IAM v2 -> API legacy, avec les VRAIS plugins legacy, le VRAI registre de modules et un VRAI Postgres.
 *
 *   pnpm --filter @ecoledigitale/api test:auth-bridge        (Postgres éphémère dans Docker)
 *
 * Couvre : jeton IAM accepté sur les routes legacy (request.user construit), révocation sur TOUTES les méthodes,
 * tenant jamais lu d'un jeton non vérifié (y compris sur route publique), extinction des jetons legacy, mapping
 * des rôles, impersonation auditée, changement de rôle, rotation du refresh, anti-énumération, verrouillage,
 * Origin/CSRF et MFA obligatoire.
 */
import { createHmac, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeIntegration } from "../helpers/fixtures";
import { totpAt } from "../phase1/support/totp";
import { bootPlatform, type Platform } from "./support";

/** Secret de service de test, aléatoire à chaque exécution (jamais dans le dépôt). */
const SERVICE_SECRET = randomBytes(24).toString("base64url");

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const decodePayload = (token: string): Record<string, any> => JSON.parse(Buffer.from(token.split(".")[1] as string, "base64url").toString("utf8"));

describeIntegration("passerelle IAM -> legacy : authentification assemblée", () => {
  let p: Platform & { tenants: Array<{ id: string; slug: string }> };
  let A: { id: string; slug: string };
  let B: { id: string; slug: string };
  const users: Record<string, { identityId: string; legacyUserId: string | null; password: string | undefined; email: string }> = {};

  beforeAll(async () => {
    p = await bootPlatform({ tenants: [{ slug: "ecole-a" }, { slug: "ecole-b" }], extraEnv: { IAM_ALLOWED_ORIGINS: "https://app.example.test", IAM_SERVICE_SECRET: SERVICE_SECRET } });
    [A, B] = p.tenants as [typeof A, typeof B];
    const add = async (key: string, tenant: typeof A, email: string, roles: string[], legacyRoles?: string[] | null) => {
      const m = await p.member({ tenant, email, roles, ...(legacyRoles !== undefined ? { legacyRoles } : {}) });
      users[key] = { ...m, email };
    };
    await add("teacher", A, "prof@a.test", ["teacher"]);
    await add("admin", A, "admin@a.test", ["admin"]);
    await add("multi", A, "multi@a.test", ["teacher", "parent"]);
    await add("directeur", A, "dir@a.test", ["directeur"], ["admin"]); // rôle v2 partiel : aucun équivalent legacy complet
    await add("ghost", A, "fantome@a.test", ["teacher"], null); // accès IAM sans compte legacy
    await add("owner", A, "owner@a.test", ["owner"]);
    await add("sharedA", A, "partage@x.test", ["teacher"]);
    await add("sharedB", B, "partage@x.test", ["teacher"]); // même e-mail, autre établissement, autre compte legacy
  }, 240_000);

  afterAll(async () => {
    await p?.stop();
  });

  const probe = (token?: string, headers: Record<string, string> = {}) => p.http("GET", "/api/v1/students/probe", { ...(token ? { token } : {}), headers });

  // ---------------------------------------------------------------------------------------------------------------
  describe("jeton IAM sur une route legacy", () => {
    it("construit request.user avec l'identifiant du compte LEGACY, les rôles legacy et le tenant du jeton", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      const res = await probe(s.accessToken);
      expect(res.status, res.raw).toBe(200);
      expect(res.body.userId).toBe(users.teacher!.legacyUserId);
      expect(res.body.userId).not.toBe(users.teacher!.identityId);
      expect(res.body.tenantId).toBe(A.id);
      expect(res.body.tenantSlug).toBe("ecole-a");
      expect(res.body.user).toMatchObject({ id: users.teacher!.legacyUserId, email: "prof@a.test", activeRole: "teacher", role: "teacher", roles: ["teacher"], availableRoles: ["teacher"], authSource: "iam" });
      expect(res.body.user.iamIdentityId).toBe(users.teacher!.identityId);
      expect(res.body.user.jti).toBe(decodePayload(s.accessToken).jti);
      expect(res.body.user.iamSessionId).toBe(s.sessionId);
      // L'en-tête X-User-Id (lu par certaines routes legacy) ne peut pas être imposé par le client : c'est le compte du jeton.
      const spoofed = await probe(s.accessToken, { "x-user-id": users.admin!.legacyUserId! });
      expect(spoofed.body.xUserId).toBe(users.teacher!.legacyUserId);
      expect(spoofed.body.userId).toBe(users.teacher!.legacyUserId);
      // /auth/whoami : le web V2 y lit le compte LEGACY du jeton (session.user.id) ; identique pour un jeton legacy ; 401 sans jeton.
      const who = await p.http("GET", "/api/v1/auth/whoami", { token: s.accessToken });
      expect(who.status, who.raw).toBe(200);
      expect(who.body).toMatchObject({ id: users.teacher!.legacyUserId, email: "prof@a.test", activeRole: "teacher", authSource: "iam" });
      const whoLegacy = await p.http("GET", "/api/v1/auth/whoami", { token: p.legacyToken({ id: users.teacher!.legacyUserId!, tenantId: A.id, tenantSlug: A.slug, role: "teacher" }) });
      expect(whoLegacy.body).toMatchObject({ id: users.teacher!.legacyUserId, authSource: "legacy" });
      expect((await p.http("GET", "/api/v1/auth/whoami")).status).toBe(401);
      // Les écritures passent aussi (POST).
      const post = await p.http("POST", "/api/v1/students/probe", { token: s.accessToken, body: {} });
      expect(post.status).toBe(200);
      expect(post.body).toEqual({ userId: users.teacher!.legacyUserId, role: "teacher" });
    });

    it("le tenant du jeton l'emporte sur l'en-tête X-Tenant (aucun passage d'un établissement à l'autre)", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      for (const header of [B.id, B.slug]) {
        const res = await probe(s.accessToken, { "x-tenant": header });
        expect(res.status, res.raw).toBe(200);
        expect(res.body.tenantId).toBe(A.id);
        expect(res.body.userId).toBe(users.teacher!.legacyUserId);
      }
    });

    it("même e-mail dans deux établissements : chaque jeton ouvre SON compte legacy", async () => {
      const a = await p.session({ email: "partage@x.test", password: users.sharedA!.password!, tenantSlug: "ecole-a" });
      const b = await p.session({ email: "partage@x.test", password: users.sharedA!.password!, tenantSlug: "ecole-b" });
      const ra = await probe(a.accessToken);
      const rb = await probe(b.accessToken);
      expect(ra.body.userId).toBe(users.sharedA!.legacyUserId);
      expect(rb.body.userId).toBe(users.sharedB!.legacyUserId);
      expect(ra.body.userId).not.toBe(rb.body.userId);
      expect(ra.body.tenantId).toBe(A.id);
      expect(rb.body.tenantId).toBe(B.id);
    });

    it("rôle sans équivalent legacy complet -> 403 LEGACY_ROLE_UNMAPPED ; accès sans compte legacy -> 403 LEGACY_ACCOUNT_MISSING", async () => {
      const dir = await p.session({ email: "dir@a.test", password: users.directeur!.password!, tenantSlug: "ecole-a" });
      const r1 = await probe(dir.accessToken);
      expect(r1.status).toBe(403);
      expect(r1.body.code).toBe("LEGACY_ROLE_UNMAPPED");
      const ghost = await p.session({ email: "fantome@a.test", password: users.ghost!.password!, tenantSlug: "ecole-a" });
      const r2 = await probe(ghost.accessToken);
      expect(r2.status).toBe(403);
      expect(r2.body.code).toBe("LEGACY_ACCOUNT_MISSING");
    });

    it("compte legacy désactivé ou établissement legacy désactivé -> 403, même avec une session IAM valide", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      const legacyUser = p.legacy.users.find((u) => u.id === users.teacher!.legacyUserId)!;
      legacyUser.isActive = false;
      try {
        const res = await probe(s.accessToken);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("ACCOUNT_DISABLED");
      } finally {
        legacyUser.isActive = true;
      }
      expect((await probe(s.accessToken)).status).toBe(200);
    });

    it("sans plateforme de passerelle (V2_LEGACY_IAM_BRIDGE=0) : retour au comportement d'avant, 401", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      process.env.V2_LEGACY_IAM_BRIDGE = "0";
      try {
        const res = await probe(s.accessToken);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("AUTH_FAILED");
      } finally {
        delete process.env.V2_LEGACY_IAM_BRIDGE;
      }
      expect((await probe(s.accessToken)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("révocation : toutes les méthodes HTTP, côté IAM comme côté legacy", () => {
    it("déconnexion : le jeton ne passe plus sur un GET legacy (le legacy ne contrôlait la liste noire que sur POST/PUT/PATCH/DELETE)", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      expect((await probe(s.accessToken)).status).toBe(200);
      expect((await p.http("POST", "/api/v1/iam/logout", { token: s.accessToken, body: {} })).status).toBe(204);
      const after = await probe(s.accessToken);
      expect(after.status).toBe(401);
      expect(after.body.code).toBe("TOKEN_REVOKED");
      expect((await p.http("POST", "/api/v1/students/probe", { token: s.accessToken, body: {} })).status).toBe(401);
    });

    it("révocation d'une session depuis « mes sessions actives » et logout-all (tous appareils, tous établissements)", async () => {
      const first = await p.session({ email: "multi@a.test", password: users.multi!.password!, tenantSlug: "ecole-a" });
      const second = await p.session({ email: "multi@a.test", password: users.multi!.password!, tenantSlug: "ecole-a" });
      const list = await p.http("GET", "/api/v1/iam/sessions", { token: first.accessToken });
      expect(list.status).toBe(200);
      expect(list.body.sessions.length).toBeGreaterThanOrEqual(2);
      expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
      // Révoque la seconde depuis la première.
      expect((await p.http("DELETE", `/api/v1/iam/sessions/${second.sessionId}`, { token: first.accessToken })).status).toBe(204);
      expect((await probe(second.accessToken)).status).toBe(401);
      expect((await probe(first.accessToken)).status).toBe(200);
      // logout-all : la session courante tombe aussi.
      const all = await p.http("POST", "/api/v1/iam/logout-all", { token: first.accessToken, body: {} });
      expect(all.status).toBe(200);
      expect((await probe(first.accessToken)).status).toBe(401);
    });

    it("accès suspendu par un administrateur : la session cesse de passer immédiatement, sans attendre l'expiration du jeton", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      expect((await probe(s.accessToken)).status).toBe(200);
      await p.db.admin.query("UPDATE iam.memberships SET status = 'suspended' WHERE identity_id = $1 AND tenant_id = $2", [users.teacher!.identityId, A.id]);
      try {
        expect((await probe(s.accessToken)).status).toBe(401);
        expect((await p.http("GET", "/api/v1/iam/me", { token: s.accessToken })).status).toBe(401);
      } finally {
        await p.db.admin.query("UPDATE iam.memberships SET status = 'active' WHERE identity_id = $1 AND tenant_id = $2", [users.teacher!.identityId, A.id]);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("jetons forgés : le tenant et l'identité ne sont jamais pris d'un jeton non vérifié", () => {
    it("jeton IAM : alg:none, signature d'une autre clé, charge utile modifiée -> 401 et aucune donnée", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      const [h, pl, sig] = s.accessToken.split(".") as [string, string, string];
      const payload = decodePayload(s.accessToken);

      const none = `${b64({ alg: "none", typ: "at+jwt" })}.${pl}.`;
      expect((await probe(none)).status).toBe(401);
      const noneNoSig = `${b64({ alg: "none", typ: "at+jwt" })}.${pl}.${sig}`;
      expect((await probe(noneNoSig)).status).toBe(401);

      // Autre tenant dans la charge utile, signature d'origine.
      const swapped = `${h}.${b64({ ...payload, tenantId: B.id, tenantSlug: "ecole-b", aud: "ecole-b" })}.${sig}`;
      const r = await probe(swapped);
      expect(r.status).toBe(401);
      expect(r.body.userId).toBeUndefined();

      // Signé avec une autre clé (HS256 correct, secret inconnu du serveur).
      const signedBy = (secret: string): string => {
        const signingInput = `${h}.${b64({ ...payload, tenantId: B.id, tenantSlug: "ecole-b", aud: "ecole-b" })}`;
        return `${signingInput}.${createHmac("sha256", secret).update(signingInput).digest("base64url")}`;
      };
      expect((await probe(signedBy("x".repeat(40)))).status).toBe(401);
      // Signé avec le secret LEGACY : le secret legacy ne vaut pas pour un jeton IAM.
      expect((await probe(signedBy(process.env.JWT_SECRET!))).status).toBe(401);
    });

    it("route publique : un jeton legacy NON vérifié (alg:none, mauvaise clé, expiré) ne désigne aucun tenant", async () => {
      const claims = { iss: "ecoledigitale", aud: A.slug, sub: users.teacher!.legacyUserId, userId: users.teacher!.legacyUserId, scope: "tenant_user", tenantId: A.id, tenantSlug: A.slug, roles: ["admin"], activeRole: "admin", jti: "j", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
      const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
      const wrongKey = jwt.sign(claims, "k".repeat(48), { algorithm: "HS256" });
      const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET!, { algorithm: "HS256" });
      for (const token of [unsigned, wrongKey, expired]) {
        const bare = await p.http("GET", "/api/v1/health/tenant-probe", { token });
        expect(bare.status).toBe(200);
        expect(bare.body.tenantId).toBeNull();
        // Avec un en-tête de tenant, c'est l'en-tête (source « header »), jamais le jeton.
        const withHeader = await p.http("GET", "/api/v1/health/tenant-probe", { token, headers: { "x-tenant": B.id } });
        expect(withHeader.body).toEqual({ tenantId: B.id, source: "header" });
      }
      // Témoin : un jeton legacy VALIDE désigne bien son tenant.
      const valid = p.legacyToken({ id: users.teacher!.legacyUserId!, tenantId: A.id, tenantSlug: A.slug, role: "teacher" });
      expect((await p.http("GET", "/api/v1/health/tenant-probe", { token: valid })).body).toEqual({ tenantId: A.id, source: "token" });
    });

    it("route publique : un jeton IAM forgé ne désigne aucun tenant non plus ; un jeton IAM valide le désigne (la route publique ne l'authentifie pas)", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      const forged = `${b64({ alg: "none", typ: "at+jwt" })}.${s.accessToken.split(".")[1]}.`;
      const res = await p.http("GET", "/api/v1/health/tenant-probe", { token: forged, headers: { "x-tenant": B.id } });
      expect(res.body).toEqual({ tenantId: B.id, source: "header" });
    });

    it("jeton legacy forgé sur une route protégée -> 401 (rien n'est lu)", async () => {
      const claims = { iss: "ecoledigitale", aud: A.slug, sub: "u", userId: users.teacher!.legacyUserId, scope: "tenant_user", tenantId: A.id, tenantSlug: A.slug, roles: ["admin"], activeRole: "admin", jti: "j", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
      const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
      expect((await probe(unsigned)).status).toBe(401);
      expect((await probe(jwt.sign(claims, "k".repeat(48), { algorithm: "HS256" }))).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("extinction des jetons legacy (LEGACY_TOKEN_SUNSET)", () => {
    afterAll(() => {
      delete process.env.LEGACY_TOKEN_SUNSET;
    });

    it("avant la date : jeton legacy ET jeton IAM acceptés ; à partir de la date : le jeton legacy est refusé, l'IAM reste accepté", async () => {
      const legacy = p.legacyToken({ id: users.teacher!.legacyUserId!, tenantId: A.id, tenantSlug: A.slug, role: "teacher" });
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });

      process.env.LEGACY_TOKEN_SUNSET = new Date(Date.now() + 3_600_000).toISOString();
      expect((await probe(legacy)).status).toBe(200);
      expect((await probe(s.accessToken)).status).toBe(200);

      process.env.LEGACY_TOKEN_SUNSET = new Date(Date.now() - 1000).toISOString();
      const refused = await probe(legacy);
      expect(refused.status).toBe(401);
      expect(refused.body.code).toBe("LEGACY_TOKEN_SUNSET");
      expect((await p.http("POST", "/api/v1/students/probe", { token: legacy, body: {} })).status).toBe(401);
      expect((await probe(s.accessToken)).status).toBe(200);
      // Le tenant d'un jeton legacy éteint n'est plus lu non plus (même s'il est valide).
      expect((await p.http("GET", "/api/v1/health/tenant-probe", { token: legacy })).body.tenantId).toBeNull();

      delete process.env.LEGACY_TOKEN_SUNSET;
      expect((await probe(legacy)).status).toBe(200); // retour arrière : date retirée
    });

    it("après la date, le login et le rafraîchissement legacy sont fermés (410) : on ne fabrique plus de jetons condamnés", async () => {
      process.env.LEGACY_TOKEN_SUNSET = new Date(Date.now() - 1000).toISOString();
      for (const [method, url] of [["POST", "/api/v1/auth/login"], ["POST", "/api/v1/auth/refresh"], ["POST", "/api/v1/auth/switch-role"], ["POST", "/api/v1/auth/social-login"], ["POST", "/api/v1/auth/register"]] as const) {
        const res = await p.http(method, url, { body: {} });
        expect(res.status, `${method} ${url}`).toBe(410);
        expect(res.body.code).toBe("LEGACY_AUTH_RETIRED");
      }
      // /logout et /register-request ne délivrent aucun jeton : inchangés.
      expect((await p.http("POST", "/api/v1/auth/logout", { body: {} })).status).toBe(401);
      delete process.env.LEGACY_TOKEN_SUNSET;
    });

    it("/social-login n'est plus une porte ouverte : secret partagé obligatoire en production, comparaison en temps constant", async () => {
      const prev = { env: process.env.NODE_ENV, secret: process.env.AUTH_SOCIAL_SHARED_SECRET };
      try {
        process.env.NODE_ENV = "production";
        delete process.env.AUTH_SOCIAL_SHARED_SECRET;
        const closed = await p.http("POST", "/api/v1/auth/social-login", { body: { provider: "google", email: "prof@a.test" } });
        expect(closed.status).toBe(403);
        expect(closed.body.code).toBe("SOCIAL_LOGIN_FORBIDDEN");
        process.env.AUTH_SOCIAL_SHARED_SECRET = "s".repeat(40);
        const wrong = await p.http("POST", "/api/v1/auth/social-login", { body: { provider: "google", email: "prof@a.test" }, headers: { "x-social-login-secret": "t".repeat(40) } });
        expect(wrong.status).toBe(403);
        const missing = await p.http("POST", "/api/v1/auth/social-login", { body: { provider: "google", email: "prof@a.test" } });
        expect(missing.status).toBe(403);
      } finally {
        if (prev.env === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prev.env;
        if (prev.secret === undefined) delete process.env.AUTH_SOCIAL_SHARED_SECRET;
        else process.env.AUTH_SOCIAL_SHARED_SECRET = prev.secret;
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("rôle actif", () => {
    it("switch-role : nouvelle session, ancienne révoquée, le legacy voit le nouveau rôle ; rôle non attribué refusé", async () => {
      const s = await p.session({ email: "multi@a.test", password: users.multi!.password!, tenantSlug: "ecole-a", activeRole: "teacher" });
      expect(s.user.availableRoles.sort()).toEqual(["parent", "teacher"]);
      expect(s.user.requiresRoleSelection).toBe(true);
      expect((await probe(s.accessToken)).body.user.activeRole).toBe("teacher");

      const denied = await p.http("POST", "/api/v1/iam/switch-role", { token: s.accessToken, body: { activeRole: "admin", client: "mobile" } });
      expect(denied.status).toBe(403);
      expect((await probe(s.accessToken)).status).toBe(200); // un refus ne révoque rien

      const switched = await p.http("POST", "/api/v1/iam/switch-role", { token: s.accessToken, body: { activeRole: "parent", client: "mobile" } });
      expect(switched.status, switched.raw).toBe(200);
      expect(switched.body.user.activeRole).toBe("parent");
      expect(switched.body.sessionId).not.toBe(s.sessionId);
      expect((await probe(s.accessToken)).status).toBe(401); // ancienne session révoquée
      const after = await probe(switched.body.accessToken);
      expect(after.body.user).toMatchObject({ activeRole: "parent", roles: ["parent"], availableRoles: ["teacher", "parent"] });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("refresh à rotation", () => {
    it("réutilisation d'un refresh déjà échangé -> toute la session est révoquée (jeton d'accès compris)", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      const r1 = await p.http("POST", "/api/v1/iam/refresh", { body: { refreshToken: s.refreshToken, client: "mobile" } });
      expect(r1.status, r1.raw).toBe(200);
      expect(r1.body.refreshToken).toBeTruthy();
      expect(r1.body.refreshToken).not.toBe(s.refreshToken);
      expect((await probe(r1.body.accessToken)).status).toBe(200);

      // Le voleur (ou le client bogué) rejoue l'ancien jeton.
      const replay = await p.http("POST", "/api/v1/iam/refresh", { body: { refreshToken: s.refreshToken, client: "mobile" } });
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe("iam.refresh_invalid");
      // La famille est révoquée : ni le nouveau refresh, ni le nouvel accès ne fonctionnent.
      expect((await p.http("POST", "/api/v1/iam/refresh", { body: { refreshToken: r1.body.refreshToken, client: "mobile" } })).status).toBe(401);
      expect((await probe(r1.body.accessToken)).status).toBe(401);
      expect((await probe(s.accessToken)).status).toBe(401);
    });

    it("refresh forgé ou au tenant falsifié -> 401 sans effet", async () => {
      const s = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      const forgedTenant = s.refreshToken.replace(/^rt1\.[^.]+\./, "rt1.ecole-b.");
      expect((await p.http("POST", "/api/v1/iam/refresh", { body: { refreshToken: forgedTenant, client: "mobile" } })).status).toBe(401);
      expect((await p.http("POST", "/api/v1/iam/refresh", { body: { refreshToken: `rt1.${A.id}.${"A".repeat(43)}`, client: "mobile" } })).status).toBe(401);
      // La vraie session n'est pas touchée par ces tentatives.
      expect((await probe(s.accessToken)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("énumération de comptes et verrouillage", () => {
    it("e-mail inconnu, mot de passe faux, compte sans accès au tenant demandé : même statut, même code, même message", async () => {
      const wrong = await p.login({ email: "prof@a.test", password: "Un-Mauvais-Mot-De-Passe-9" });
      const unknown = await p.login({ email: "personne-ici@a.test", password: "Un-Mauvais-Mot-De-Passe-9" });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
      expect(strip(wrong.body)).toEqual(strip(unknown.body));
      expect(wrong.body.code).toBe("iam.invalid_credentials");
      // « Mot de passe oublié » : 202 constant, qu'il existe ou non.
      const f1 = await p.http("POST", "/api/v1/iam/password/forgot", { body: { email: "prof@a.test" } });
      const f2 = await p.http("POST", "/api/v1/iam/password/forgot", { body: { email: "personne-ici@a.test" } });
      expect([f1.status, f2.status]).toEqual([202, 202]);
      expect(f1.body).toEqual(f2.body);
    });

    it("verrouillage progressif : après 5 échecs, même le bon mot de passe est refusé (429), pour un compte réel comme pour un inconnu", async () => {
      const real = users.sharedB!;
      for (const email of ["partage@x.test", "jamais-vu@x.test"]) {
        for (let i = 0; i < 5; i += 1) {
          const bad = await p.login({ email, password: "Un-Mauvais-Mot-De-Passe-9", tenantSlug: "ecole-b" });
          expect(bad.status).toBe(401);
        }
        const locked = await p.login({ email, password: real.password!, tenantSlug: "ecole-b" });
        expect(locked.status, email).toBe(429);
        expect(locked.body.code).toBe("iam.too_many_attempts");
        expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
      }
    }, 60_000);
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("routes à cookie : Origin / CSRF", () => {
    const cookieOf = (res: { headers: Record<string, unknown> }): string => {
      const raw = res.headers["set-cookie"];
      const line = Array.isArray(raw) ? raw[0] : raw;
      return String(line).split(";")[0] as string;
    };

    it("le refresh web est un cookie HttpOnly SameSite=Lax limité à /api/v1/iam, absent du corps", async () => {
      const res = await p.http("POST", "/api/v1/iam/login", { body: { email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a", client: "web" } });
      expect(res.status, res.raw).toBe(200);
      expect(res.body.refreshToken).toBeUndefined();
      const header = String(([] as unknown[]).concat(res.headers["set-cookie"])[0]);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
      expect(header).toMatch(/Path=\/api\/v1\/iam/);
    });

    it("refresh/logout par cookie depuis une origine étrangère -> 403 sans consommer le jeton ; origine autorisée ou absente -> 200", async () => {
      const login = await p.http("POST", "/api/v1/iam/login", { body: { email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a", client: "web" } });
      const cookie = cookieOf(login);
      const evil = await p.http("POST", "/api/v1/iam/refresh", { body: {}, headers: { cookie, origin: "https://evil.example" } });
      expect(evil.status).toBe(403);
      const evilLogout = await p.http("POST", "/api/v1/iam/logout", { body: {}, headers: { cookie, origin: "https://evil.example" } });
      expect(evilLogout.status).toBe(403);
      // null (document sandboxé / redirection) n'est pas une origine de confiance.
      expect((await p.http("POST", "/api/v1/iam/refresh", { body: {}, headers: { cookie, origin: "null" } })).status).toBe(403);
      // Le jeton n'a pas été consommé par les tentatives refusées.
      const good = await p.http("POST", "/api/v1/iam/refresh", { body: {}, headers: { cookie, origin: "https://app.example.test" } });
      expect(good.status, good.raw).toBe(200);
      expect(good.body.refreshToken).toBeUndefined();
      expect(String(([] as unknown[]).concat(good.headers["set-cookie"])[0])).toMatch(/HttpOnly/i);
      // Corps non JSON (formulaire inter-sites) refusé.
      const form = await p.http("POST", "/api/v1/iam/refresh", { rawBody: "a=b", headers: { cookie: cookieOf(good), "content-type": "application/x-www-form-urlencoded" } });
      expect(form.status).toBeGreaterThanOrEqual(400);
      expect(form.status).toBeLessThan(500);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("MFA obligatoire pour les rôles sensibles", () => {
    it("owner : le login ne donne AUCUNE session tant que la MFA n'est pas enrôlée ; le jeton d'étape n'ouvre aucune route", async () => {
      const res = await p.login({ email: "owner@a.test", password: users.owner!.password!, tenantSlug: "ecole-a" });
      expect(res.status, res.raw).toBe(200);
      expect(res.body.status).toBe("mfa_enrollment_required");
      expect(res.body.accessToken).toBeUndefined();
      const stepToken = res.body.enrollmentToken as string;
      expect((await probe(stepToken)).status).toBe(401);
      expect((await p.http("GET", "/api/v1/iam/me", { token: stepToken })).status).toBe(401);
    });

    it("après enrôlement : session MFA -> routes legacy ; les logins suivants exigent un défi TOTP (mauvais code refusé, rejeu refusé)", async () => {
      const first = await p.login({ email: "owner@a.test", password: users.owner!.password!, tenantSlug: "ecole-a" });
      const enrolled = await p.enrollMfa(first.body.enrollmentToken);
      expect(enrolled.recoveryCodes.length).toBeGreaterThan(0);
      const legacy = await probe(enrolled.accessToken);
      expect(legacy.status, legacy.raw).toBe(200);
      expect(legacy.body.user.activeRole).toBe("owner");

      const again = await p.login({ email: "owner@a.test", password: users.owner!.password!, tenantSlug: "ecole-a" });
      expect(again.body.status).toBe("mfa_required");
      const bad = await p.http("POST", "/api/v1/iam/mfa/challenge", { body: { challengeToken: again.body.challengeToken, code: "000000", client: "mobile" } });
      expect(bad.status).toBe(401);
      const code = totpAt(enrolled.secret, Date.now() + 30_000);
      const ok = await p.http("POST", "/api/v1/iam/mfa/challenge", { body: { challengeToken: again.body.challengeToken, code, client: "mobile" } });
      expect(ok.status, ok.raw).toBe(200);
      expect((await probe(ok.body.accessToken)).status).toBe(200);
      // Le même code rejoué sur un nouveau défi est refusé (anti-rejeu).
      const third = await p.login({ email: "owner@a.test", password: users.owner!.password!, tenantSlug: "ecole-a" });
      const replay = await p.http("POST", "/api/v1/iam/mfa/challenge", { body: { challengeToken: third.body.challengeToken, code, client: "mobile" } });
      expect(replay.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("connexion fédérée (Google, vérifiée par le serveur web)", () => {
    const federated = (body: Record<string, unknown>, secret: string | null = SERVICE_SECRET) =>
      p.http("POST", "/api/v1/iam/federated-login", { body: { provider: "google", emailVerified: true, client: "mobile", ...body }, ...(secret !== null ? { headers: { "x-iam-service-secret": secret } } : {}) });

    it("sans secret de service ou avec un mauvais : 401 identique, aucune session", async () => {
      for (const secret of [null, "x".repeat(SERVICE_SECRET.length), "court"]) {
        const res = await federated({ email: "prof@a.test" }, secret);
        expect(res.status, String(secret)).toBe(401);
        expect(res.body.code).toBe("iam.token_invalid");
        expect(res.body.accessToken).toBeUndefined();
      }
    });

    it("identité connue : session ouverte (facteur « fed »), utilisable sur les routes legacy ; aucun compte n'est créé", async () => {
      const ok = await federated({ email: " Prof@A.test ", tenantSlug: "ecole-a" });
      expect(ok.status, ok.raw).toBe(200);
      expect(ok.body.status).toBe("authenticated");
      expect(decodePayload(ok.body.accessToken).amr).toEqual(["fed"]);
      expect((await probe(ok.body.accessToken)).body.userId).toBe(users.teacher!.legacyUserId);

      const before = (await p.db.admin.query("SELECT count(*)::int AS n FROM iam.identities")).rows[0].n;
      const unknown = await federated({ email: "inconnu@gmail.test" });
      expect(unknown.status).toBe(403);
      expect(unknown.body.code).toBe("iam.no_active_access");
      expect((await p.db.admin.query("SELECT count(*)::int AS n FROM iam.identities")).rows[0].n).toBe(before);
    });

    it("la politique MFA s'applique aussi : un rôle sensible n'obtient PAS de session sans second facteur", async () => {
      const res = await federated({ email: "owner@a.test", tenantSlug: "ecole-a" });
      expect(res.status, res.raw).toBe(200);
      expect(["mfa_required", "mfa_enrollment_required"]).toContain(res.body.status);
      expect(res.body.accessToken).toBeUndefined();
    });

    it("e-mail non vérifié par le fournisseur ou champ inconnu : refusé par le contrat", async () => {
      expect((await federated({ email: "prof@a.test", emailVerified: false })).status).toBe(400);
      expect((await federated({ email: "prof@a.test", isAdmin: true })).status).toBe(400);
    });

    it("établissement où la personne n'a aucun accès : pas de session", async () => {
      const denied = await federated({ email: "prof@a.test", tenantSlug: "ecole-b" });
      expect(denied.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("impersonation super-admin : auditée de bout en bout", () => {
    it("jeton distinct, motif obligatoire, session non renouvelable, interdictions, journal de chaque requête legacy", async () => {
      // Authentification de l'appelant : seul un JWT super-admin legacy ouvre /iam/impersonation.
      const teacherSession = await p.session({ email: "prof@a.test", password: users.teacher!.password!, tenantSlug: "ecole-a" });
      const body = { tenantId: A.id, identityId: users.teacher!.identityId, reason: "Assistance : vérification de l'emploi du temps" };
      expect((await p.http("POST", "/api/v1/iam/impersonation", { token: teacherSession.accessToken, body })).status).toBe(401);
      expect((await p.http("POST", "/api/v1/iam/impersonation", { token: p.legacyToken({ id: users.teacher!.legacyUserId!, tenantId: A.id, tenantSlug: A.slug, role: "admin" }), body })).status).toBe(401);
      expect((await p.http("POST", "/api/v1/iam/impersonation", { body })).status).toBe(401);
      // Motif trop court : refusé.
      expect((await p.http("POST", "/api/v1/iam/impersonation", { token: p.operatorToken, body: { ...body, reason: "court" } })).status).toBeGreaterThanOrEqual(400);

      const imp = await p.http("POST", "/api/v1/iam/impersonation", { token: p.operatorToken, body });
      expect(imp.status, imp.raw).toBe(200);
      const token = imp.body.accessToken as string;
      expect(decodePayload(token)).toMatchObject({ use: "impersonation", act: { sub: p.operatorId, typ: "super_admin" }, mfa: false });
      expect(imp.body.refreshToken).toBeUndefined();

      // Route legacy : le compte imité est celui du jeton, l'acteur réel est tracé.
      const before = p.legacy.superAdminAuditLogs.length;
      const res = await probe(token);
      expect(res.status, res.raw).toBe(200);
      expect(res.body.user).toMatchObject({ id: users.teacher!.legacyUserId, impersonatedBySuperAdminId: p.operatorId });
      await new Promise((r) => setTimeout(r, 200)); // le journal est écrit à `onResponse`
      expect(p.legacy.superAdminAuditLogs.length).toBeGreaterThan(before);
      const row = p.legacy.superAdminAuditLogs[p.legacy.superAdminAuditLogs.length - 1]!;
      expect(row[0]).toBe(p.operatorId); // super_admin_id : l'ACTEUR RÉEL
      expect(row[1]).toBe(A.id);
      expect(row[3]).toBe(users.teacher!.legacyUserId); // utilisateur imité
      expect(String(row[5])).toBe("GET");
      expect(String(row[6])).toContain("/api/v1/students/probe");

      // Route d'un module v2 : même journal (acteur réel), l'utilisateur imité n'y figure pas (la FK vise users.id, pas l'identité).
      const me = await p.http("GET", "/api/v1/iam/me", { token });
      expect(me.body.impersonatedBy).toBe(p.operatorId);
      await new Promise((r) => setTimeout(r, 200));
      const v2Row = p.legacy.superAdminAuditLogs[p.legacy.superAdminAuditLogs.length - 1]!;
      expect(v2Row[0]).toBe(p.operatorId);
      expect(String(v2Row[6])).toContain("/api/v1/iam/me");
      expect(v2Row[3]).toBeNull();

      // Une session d'impersonation ne donne pas accès aux routes /super-admin/* (request.superAdmin non posé).
      const superRoute = await p.http("GET", "/api/v1/super-admin/tenants", { token });
      expect([401, 403, 404]).toContain(superRoute.status);

      // Interdictions sous impersonation.
      expect((await p.http("POST", "/api/v1/iam/password/change", { token, body: { currentPassword: "x".repeat(12), newPassword: "y".repeat(14), client: "mobile" } })).status).toBe(403);
      expect((await p.http("POST", "/api/v1/iam/switch-tenant", { token, body: { tenantId: B.id, client: "mobile" } })).status).toBe(403);
      const sw = await p.http("POST", "/api/v1/iam/switch-role", { token, body: { activeRole: "teacher", client: "mobile" } });
      expect(sw.status).toBe(403);
      expect(sw.body.code).toBe("iam.impersonation_forbidden");
      expect((await p.http("POST", "/api/v1/iam/mfa/enroll", { token, body: {} })).status).toBeGreaterThanOrEqual(400);

      // L'événement d'audit est dans l'outbox, avec l'acteur réel et le motif (même transaction que la session).
      const events = await p.db.admin.query(
        `SELECT type, payload, actor_id FROM kernel.domain_events WHERE type = 'iam.impersonation.started' AND tenant_id = $1 ORDER BY id`,
        [A.id],
      );
      expect(events.rowCount).toBeGreaterThanOrEqual(1);
      const ev = events.rows[events.rows.length - 1];
      expect(ev.payload).toMatchObject({ superAdminId: p.operatorId, targetUserId: users.teacher!.identityId, reason: body.reason });
      expect(ev.actor_id).toBe(p.operatorId);
      // La session porte l'acteur et le motif.
      const sess = await p.db.admin.query(`SELECT kind, actor_id, reason, mfa_verified FROM iam.sessions WHERE id = $1`, [imp.body.sessionId]);
      expect(sess.rows[0]).toMatchObject({ kind: "impersonation", actor_id: p.operatorId, reason: body.reason, mfa_verified: false });

      // L'utilisateur peut révoquer cette session depuis sa liste ; le jeton tombe aussitôt.
      const list = await p.http("GET", "/api/v1/iam/sessions", { token: teacherSession.accessToken });
      expect(list.body.sessions.some((s: { id: string; kind: string }) => s.id === imp.body.sessionId && s.kind === "impersonation")).toBe(true);
      expect((await p.http("DELETE", `/api/v1/iam/sessions/${imp.body.sessionId}`, { token: teacherSession.accessToken })).status).toBe(204);
      expect((await probe(token)).status).toBe(401);
    });
  });
});
