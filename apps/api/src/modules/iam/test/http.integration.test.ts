/**
 * Routes /api/v1/iam/* : cookies, transport du refresh token, CSRF, révocation sur
 * TOUTES les méthodes HTTP, erreurs homogènes, routes d'administration derrière la garde.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@ecoledigitale/kernel";
import { base32Decode, totp } from "../domain/totp";
import { registerIam, type IamPluginOptions } from "../http/plugin";
import { createHarness, describeIntegration, TEST_PASSWORD, type Harness } from "./helpers";

const P = "/api/v1/iam";

describeIntegration("iam — routes HTTP (Postgres réel)", () => {
  let h: Harness;
  let A: string;
  let app: FastifyInstance;
  let appAdmin: FastifyInstance;
  const permsByRole: Record<string, string[]> = { secretary: ["iam.user.read", "iam.user.invite", "iam.user.manage", "iam.session.revoke"], director: ["iam.mfa.reset"] };

  /** Fabrique de garde de test, de même forme que `requirePermission` du module rbac (lit request.ctx). */
  const requirePermission: NonNullable<IamPluginOptions["requirePermission"]> = (permission) =>
    async function guard(request) {
      const ctx = (request as unknown as { ctx?: { roles: readonly string[]; mfa: boolean } }).ctx;
      if (!ctx) throw new ForbiddenError("pas de contexte");
      const allowed = ctx.roles.some((r) => permsByRole[r]?.includes(permission));
      if (!allowed) throw new ForbiddenError("Action non autorisée.");
      if (permission === "iam.mfa.reset" && !ctx.mfa) throw new ForbiddenError("MFA requise", { code: "rbac.mfa_required" });
    };

  beforeAll(async () => {
    h = await createHarness({ overrides: { allowedOrigins: ["https://app.exemple.ci"] } });
    A = await h.createTenant("lycee-a", "Lycée A");
    app = Fastify({ trustProxy: true });
    await registerIam(app, { iam: h.iam });
    appAdmin = Fastify();
    await registerIam(appAdmin, { iam: h.iam, requirePermission });
    await app.ready();
    await appAdmin.ready();
  });
  afterAll(async () => {
    await app.close();
    await appAdmin.close();
    await h.stop();
  });

  const post = (a: FastifyInstance, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    a.inject({ method: "POST", url: P + url, payload: body === undefined ? undefined : (body as object), headers: { "content-type": "application/json", ...headers } });
  const login = (email: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    post(app, "/login", { email, password: TEST_PASSWORD, ...extra }, headers);
  const cookieOf = (res: { headers: Record<string, unknown> }): string => String(res.headers["set-cookie"]);
  const rtFromCookie = (res: { headers: Record<string, unknown> }): string => cookieOf(res).split(";")[0]!.split("=")[1]!;

  it("login WEB : refresh token en cookie HttpOnly/Secure/SameSite=Lax limité à /api/v1/iam, ABSENT du corps ; no-store", async () => {
    await h.member(A, "web@exemple.ci", ["teacher"]);
    const res = await login("web@exemple.ci");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: "authenticated", tokenType: "Bearer", expiresIn: 900, user: { tenantSlug: "lycee-a", activeRole: "teacher" } });
    expect(body.refreshToken).toBeUndefined();
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^__Secure-ed_refresh=rt1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{43};/);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api/v1/iam", "Max-Age="]) expect(cookie).toContain(attr);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(body)).not.toContain(rtFromCookie(res));
  });

  it("login MOBILE : refresh token dans le corps, aucun cookie", async () => {
    await h.member(A, "mobile@exemple.ci", ["teacher"]);
    const res = await login("mobile@exemple.ci", { client: "mobile", deviceName: "Tecno Spark" });
    const body = res.json();
    expect(body.refreshToken).toMatch(/^rt1\./);
    expect(body.refreshExpiresIn).toBeGreaterThan(0);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const sessions = await app.inject({ method: "GET", url: P + "/sessions", headers: { authorization: `Bearer ${body.accessToken}` } });
    expect(sessions.json().sessions[0]).toMatchObject({ current: true, deviceName: "Tecno Spark" });
  });

  it("refresh par cookie : rotation du cookie ; Origin étranger refusé (CSRF) ; Origin autorisé accepté", async () => {
    await h.member(A, "rot@exemple.ci", ["teacher"]);
    const first = await login("rot@exemple.ci");
    const cookie1 = rtFromCookie(first);
    const foreign = await post(app, "/refresh", {}, { cookie: `__Secure-ed_refresh=${cookie1}`, origin: "https://evil.example" });
    expect(foreign.statusCode).toBe(403);
    // le refus CSRF ne consomme pas le jeton
    const ok = await post(app, "/refresh", {}, { cookie: `__Secure-ed_refresh=${cookie1}`, origin: "https://app.exemple.ci" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: "refreshed", tokenType: "Bearer", expiresIn: 900 });
    const cookie2 = rtFromCookie(ok);
    expect(cookie2).not.toBe(cookie1);
    // réutilisation de l'ancien cookie : 401, cookie effacé, session révoquée
    const replay = await post(app, "/refresh", {}, { cookie: `__Secure-ed_refresh=${cookie1}` });
    expect(replay.statusCode).toBe(401);
    expect(cookieOf(replay)).toContain("Max-Age=0");
    expect((await post(app, "/refresh", {}, { cookie: `__Secure-ed_refresh=${cookie2}` })).statusCode).toBe(401);
    // sans aucun jeton
    expect((await post(app, "/refresh", {})).statusCode).toBe(401);
  });

  it("refresh MOBILE par le corps", async () => {
    await h.member(A, "mrot@exemple.ci", ["teacher"]);
    const first = (await login("mrot@exemple.ci", { client: "mobile" })).json();
    const next = await post(app, "/refresh", { refreshToken: first.refreshToken, client: "mobile" });
    expect(next.statusCode).toBe(200);
    expect(next.json().refreshToken).toMatch(/^rt1\./);
    expect(next.json().refreshToken).not.toBe(first.refreshToken);
  });

  it("révocation effective sur TOUTES les méthodes HTTP (GET, POST, DELETE) dès le logout", async () => {
    await h.member(A, "revoque@exemple.ci", ["teacher"]);
    const res = await login("revoque@exemple.ci");
    const auth = { authorization: `Bearer ${res.json().accessToken}` };
    expect((await app.inject({ method: "GET", url: P + "/sessions", headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: P + "/me", headers: auth })).json()).toMatchObject({ activeRole: "teacher", tenantSlug: "lycee-a", impersonatedBy: null });
    const out = await post(app, "/logout", {}, auth);
    expect(out.statusCode).toBe(204);
    expect(cookieOf(out)).toContain("Max-Age=0");
    for (const [method, url] of [["GET", "/sessions"], ["GET", "/me"], ["POST", "/logout-all"], ["POST", "/switch-tenant"], ["DELETE", `/sessions/${res.json().sessionId}`], ["POST", "/password/change"]] as const) {
      const r = await app.inject({ method, url: P + url, headers: { ...auth, "content-type": "application/json" }, payload: method === "POST" ? {} : undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("jeton absent, mal formé, `alg:none` → 401 générique sans fuite", async () => {
    for (const headers of [{}, { authorization: "Bearer" }, { authorization: "Basic abc" }, { authorization: "Bearer a.b.c" }, { authorization: `Bearer ${Buffer.from('{"alg":"none"}').toString("base64url")}.e30.` }]) {
      const r = await app.inject({ method: "GET", url: P + "/me", headers });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({ kind: "unauthorized" });
      expect(JSON.stringify(r.json())).not.toMatch(/stack|node_modules|SELECT/i);
    }
  });

  it("validation stricte : champ inconnu, type invalide, corps non JSON → 400/415, jamais 500", async () => {
    expect((await post(app, "/login", { email: "a@b.ci", password: "x", isAdmin: true })).statusCode).toBe(400);
    expect((await post(app, "/login", { email: "pas-un-email", password: "x" })).statusCode).toBe(400);
    expect((await post(app, "/login", { email: "a@b.ci", password: 123 })).statusCode).toBe(400);
    expect((await post(app, "/login", { email: "a@b.ci", password: "x", tenantSlug: "../etc" })).statusCode).toBe(400);
    // Formulaire inter-site « simple » : type non géré (415) ; text/plain est lu comme chaîne puis refusé par le schéma (400).
    const form = await app.inject({ method: "POST", url: P + "/login", payload: "email=a@b.ci", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.statusCode).toBe(415);
    const text = await app.inject({ method: "POST", url: P + "/login", payload: "email=a@b.ci", headers: { "content-type": "text/plain" } });
    expect(text.statusCode).toBe(400);
    const broken = await app.inject({ method: "POST", url: P + "/login", payload: "{nope", headers: { "content-type": "application/json" } });
    expect(broken.statusCode).toBe(400);
    const invalid = await post(app, "/login", { email: "a@b.ci" });
    expect(invalid.json()).toMatchObject({ code: "VALIDATION_FAILED", kind: "validation" });
  });

  it("échec de login : 401 identique inconnu / mot de passe faux ; 429 + Retry-After au verrouillage", async () => {
    await h.member(A, "http-brute@exemple.ci", ["teacher"]);
    const wrong = await post(app, "/login", { email: "http-brute@exemple.ci", password: "Mauvais-Mot-De-Passe-1" }, { "x-forwarded-for": "198.51.100.200" });
    const unknown = await post(app, "/login", { email: "inconnu-http@exemple.ci", password: "Mauvais-Mot-De-Passe-1" }, { "x-forwarded-for": "198.51.100.201" });
    expect(wrong.statusCode).toBe(401);
    const strip = (r: { json(): Record<string, unknown> }) => ({ ...r.json(), requestId: undefined });
    expect(strip(wrong)).toEqual(strip(unknown));
    let last = wrong;
    for (let i = 0; i < 5; i += 1) last = await post(app, "/login", { email: "http-brute@exemple.ci", password: "Mauvais-Mot-De-Passe-1" }, { "x-forwarded-for": "198.51.100.200" });
    expect(last.statusCode).toBe(429);
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);
    expect(last.json().code).toBe("iam.too_many_attempts");
  });

  it("mot de passe oublié : 202 identique ; reset 204 ; jeton invalide 400 générique", async () => {
    await h.member(A, "http-oubli@exemple.ci", ["teacher"]);
    const a = await post(app, "/password/forgot", { email: "http-oubli@exemple.ci" }, { "x-forwarded-for": "198.51.100.210" });
    const b = await post(app, "/password/forgot", { email: "nexiste-pas@exemple.ci" }, { "x-forwarded-for": "198.51.100.211" });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(a.json()).toEqual(b.json());
    await h.iam.drainBackground();
    const token = h.notifier.resets[h.notifier.resets.length - 1]!.token;
    expect((await post(app, "/password/reset", { token, newPassword: "Phrase-Secrete-Bien-Longue-5" })).statusCode).toBe(204);
    const bad = await post(app, "/password/reset", { token, newPassword: "Phrase-Secrete-Bien-Longue-6" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("iam.reset_token_invalid");
  });

  it("MFA bout en bout : enroll → verify → login challenge → challenge", async () => {
    await h.member(A, "http-mfa@exemple.ci", ["teacher"]);
    const s = (await login("http-mfa@exemple.ci")).json();
    const auth = { authorization: `Bearer ${s.accessToken}` };
    const enroll = await post(app, "/mfa/enroll", { password: TEST_PASSWORD }, auth);
    expect(enroll.statusCode).toBe(200);
    const { secret, otpauthUri } = enroll.json();
    expect(otpauthUri).toContain("otpauth://totp/");
    const verify = await post(app, "/mfa/verify", { code: totp(base32Decode(secret), h.clock.now().getTime()) }, auth);
    expect(verify.statusCode).toBe(200);
    expect(verify.json().recoveryCodes).toHaveLength(10);

    h.clock.advance(60_000);
    const lg = await login("http-mfa@exemple.ci");
    expect(lg.json()).toMatchObject({ status: "mfa_required", methods: ["totp", "recovery_code"] });
    expect(lg.headers["set-cookie"]).toBeUndefined();
    const ch = await post(app, "/mfa/challenge", { challengeToken: lg.json().challengeToken, code: totp(base32Decode(secret), h.clock.now().getTime()) });
    expect(ch.statusCode).toBe(200);
    expect(ch.json()).toMatchObject({ status: "authenticated", user: { mfaEnabled: true } });
    expect(cookieOf(ch)).toContain("HttpOnly");
    expect((await post(app, "/mfa/challenge", { challengeToken: lg.json().challengeToken })).statusCode).toBe(400); // ni code ni code de secours
  });

  it("routes /admin/* et /impersonation ABSENTES sans garde / sans authentificateur (échec fermé)", async () => {
    await h.member(A, "ferme@exemple.ci", ["secretary"]);
    const s = (await login("ferme@exemple.ci")).json();
    const auth = { authorization: `Bearer ${s.accessToken}` };
    expect((await app.inject({ method: "GET", url: P + "/admin/members", headers: auth })).statusCode).toBe(404);
    expect((await post(app, "/impersonation", {}, auth)).statusCode).toBe(404);
    expect((await post(appAdmin, "/impersonation", {}, auth)).statusCode).toBe(404);
  });

  it("routes /admin/* : garde de permission (rbac) appliquée après l'authentification ; création, liste, suspension", async () => {
    await h.member(A, "sec@exemple.ci", ["secretary"]);
    await h.member(A, "simple@exemple.ci", ["teacher"]);
    const sec = { authorization: `Bearer ${(await login("sec@exemple.ci")).json().accessToken}` };
    const teacher = { authorization: `Bearer ${(await login("simple@exemple.ci")).json().accessToken}` };

    expect((await appAdmin.inject({ method: "GET", url: P + "/admin/members" })).statusCode).toBe(401);
    expect((await appAdmin.inject({ method: "GET", url: P + "/admin/members", headers: teacher })).statusCode).toBe(403);

    const list = await appAdmin.inject({ method: "GET", url: P + "/admin/members", headers: sec });
    expect(list.statusCode).toBe(200);
    expect(list.json().members.map((m: { email: string }) => m.email)).toContain("simple@exemple.ci");

    const created = await post(appAdmin, "/admin/members", { email: "Nouveau.Membre@Exemple.CI", roles: ["parent"] }, sec);
    expect(created.statusCode).toBe(201);
    const dup = await post(appAdmin, "/admin/members", { email: "nouveau.membre@exemple.ci", roles: ["parent"] }, sec);
    expect(dup.statusCode).toBe(409);
    expect((await post(appAdmin, "/admin/members", { email: "x@exemple.ci", roles: ["Parent; DROP"] }, sec)).statusCode).toBe(400);

    const members = list.json().members as Array<{ membershipId: string; email: string }>;
    const target = members.find((m) => m.email === "simple@exemple.ci")!;
    const patch = await appAdmin.inject({ method: "PATCH", url: `${P}/admin/members/${target.membershipId}`, headers: { ...sec, "content-type": "application/json" }, payload: { status: "suspended" } });
    expect(patch.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: P + "/me", headers: teacher })).statusCode).toBe(401);
    expect((await appAdmin.inject({ method: "PATCH", url: `${P}/admin/members/not-a-uuid`, headers: { ...sec, "content-type": "application/json" }, payload: { status: "active" } })).statusCode).toBe(400);
  });

  it("impersonation via HTTP : authentification super-admin injectée, jeton imp, `/me` révèle l'acteur", async () => {
    const target = await h.member(A, "imp-http@exemple.ci", ["teacher"]);
    const superAdmin = { id: "9f1b6d52-0c3e-4a3e-8f57-6b3a2f1d0c11", email: "support@plateforme.example" };
    const appImp = Fastify();
    await registerIam(appImp, { iam: h.iam, authenticateSuperAdmin: async (req) => (req.headers["x-test-super-admin"] === "ok" ? superAdmin : null) });
    await appImp.ready();
    const body = { tenantId: A, identityId: target.identityId, reason: "Ticket #77 : vérification d'affichage" };
    expect((await post(appImp, "/impersonation", body)).statusCode).toBe(401);
    const res = await post(appImp, "/impersonation", body, { "x-test-super-admin": "ok" });
    expect(res.statusCode).toBe(200);
    expect(res.json().expiresIn).toBeLessThanOrEqual(600);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const me = await appImp.inject({ method: "GET", url: P + "/me", headers: { authorization: `Bearer ${res.json().accessToken}` } });
    expect(me.json()).toMatchObject({ impersonatedBy: superAdmin.id, userId: target.identityId });
    const pw = await post(appImp, "/password/change", { currentPassword: TEST_PASSWORD, newPassword: "Nouvelle-Phrase-Longue-9" }, { authorization: `Bearer ${res.json().accessToken}` });
    expect(pw.statusCode).toBe(403);
    await appImp.close();
  });
});
