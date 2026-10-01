/**
 * Login, multi-tenant (une identité, deux accès), sessions, refresh à rotation,
 * révocation — contre un Postgres réel (RLS active, rôle applicatif non propriétaire).
 */
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { createRequestContext } from "@ecoledigitale/kernel";
import { buildRequestContextFromToken } from "../index";
import { createHarness, describeIntegration, meta, TEST_PASSWORD, type Harness } from "./helpers";

describeIntegration("iam — login, multi-tenant, sessions, refresh (Postgres réel)", () => {
  let h: Harness;
  let A: string;
  let B: string;

  beforeAll(async () => {
    h = await createHarness();
    A = await h.createTenant("lycee-a", "Lycée A");
    B = await h.createTenant("college-b", "Collège B");
  });
  afterAll(async () => h.stop());

  const authOk = async (token: string, requestId?: string) => {
    const r = await h.iam.authenticate(token, requestId ? { requestId } : {});
    return r;
  };

  describe("login", () => {
    it("réussit, émet un jeton d'accès de 15 min aux revendications compatibles et un refresh token", async () => {
      const m = await h.member(A, "enseignant@exemple.ci", ["teacher"]);
      const out = await h.loginOk("enseignant@exemple.ci");
      expect(out.user).toMatchObject({ id: m.identityId, tenantId: A, tenantSlug: "lycee-a", activeRole: "teacher", availableRoles: ["teacher"] });
      expect(out.session.claims).toMatchObject({ userId: m.identityId, tenantId: A, tenantSlug: "lycee-a", roles: ["teacher"], activeRole: "teacher", mfa: false });
      expect(out.session.claims.exp - out.session.claims.iat).toBe(900);
      expect(out.session.refreshToken).toMatch(/^rt1\.[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
      const ctx = await buildRequestContextFromToken(out.session.accessToken, h.iam);
      expect(ctx.ok).toBe(true);
      if (ctx.ok) expect(ctx.value.ctx).toMatchObject({ tenantId: A, userId: m.identityId, roles: ["teacher"], actor: "user" });
    });

    it("publie iam.user.logged_in dans l'outbox du tenant (même transaction que la session)", async () => {
      await h.member(A, "evt@exemple.ci", ["teacher"]);
      const out = await h.loginOk("evt@exemple.ci");
      const evts = await h.events(A, "iam.user.logged_in");
      const e = evts.find((x) => x.payload.sessionId === out.session.sessionId);
      expect(e?.payload).toMatchObject({ v: 1, identityId: out.user.id, mfa: false, method: "password", ip: "203.0.113.7" });
      expect(e?.actor_id).toBe(out.user.id);
    });

    it("échec : e-mail inconnu, mot de passe faux, compte désactivé → MÊME erreur (code, message, statut)", async () => {
      await h.member(A, "ok@exemple.ci", ["teacher"]);
      const dis = await h.member(A, "desactive@exemple.ci", ["teacher"]);
      await h.admin.query(`UPDATE iam.identities SET status = 'disabled' WHERE id = $1`, [dis.identityId]);
      const results = await Promise.all([
        h.iam.login({ email: "inconnu@exemple.ci", password: TEST_PASSWORD, meta: meta({ ip: "198.51.100.1" }) }),
        h.iam.login({ email: "ok@exemple.ci", password: "mauvais-mot-de-passe-1", meta: meta({ ip: "198.51.100.2" }) }),
        h.iam.login({ email: "desactive@exemple.ci", password: TEST_PASSWORD, meta: meta({ ip: "198.51.100.3" }) }),
      ]);
      const shapes = results.map((r) => (r.ok ? null : { code: r.error.code, message: r.error.message, status: r.error.httpStatus }));
      expect(shapes[0]).toEqual({ code: AuthErrorCodes.invalidCredentials, message: "Identifiants invalides.", status: 401 });
      expect(shapes[1]).toEqual(shapes[0]);
      expect(shapes[2]).toEqual(shapes[0]);
    });

    it("un compte invité sans mot de passe ne peut pas se connecter (même erreur générique)", async () => {
      const p = await h.iam.provisionMember(h.ctx(A), { email: "invite@exemple.ci", roles: ["parent"], meta: meta() });
      expect(p.ok).toBe(true);
      const r = await h.iam.login({ email: "invite@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      expect(!r.ok && r.error.code).toBe(AuthErrorCodes.invalidCredentials);
    });

    it("normalise l'e-mail (casse, espaces, Unicode) pour trouver l'identité", async () => {
      await h.member(A, "Casse.Mixte@Exemple.CI", ["teacher"]);
      const r = await h.iam.login({ email: "casse.mixte@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      expect(r.ok).toBe(true);
    });

    it("rôle actif demandé pris en compte seulement s'il appartient à l'utilisateur", async () => {
      await h.member(A, "multi-role@exemple.ci", ["teacher", "parent"]);
      expect((await h.loginOk("multi-role@exemple.ci", { activeRole: "parent" })).user.activeRole).toBe("parent");
      expect((await h.loginOk("multi-role@exemple.ci", { activeRole: "owner" })).user.activeRole).toBe("teacher");
      const o = await h.loginOk("multi-role@exemple.ci");
      expect(o.user.requiresRoleSelection).toBe(true);
      expect(o.session.claims.roles).toEqual(["teacher", "parent"]);
    });

    it("hash bcrypt LEGACY accepté puis re-haché en scrypt de façon transparente", async () => {
      const legacy = await bcrypt.hash("Ancien-Mot-De-Passe-1", 4);
      const p = await h.iam.provisionMember(h.ctx(A), { email: "legacy@exemple.ci", roles: ["teacher"], passwordHash: legacy, meta: meta() });
      expect(p.ok).toBe(true);
      const before = await h.admin.query(`SELECT password_hash FROM iam.identities WHERE email = 'legacy@exemple.ci'`);
      expect(before.rows[0].password_hash).toBe(legacy);

      await h.loginOk("legacy@exemple.ci", { password: "Ancien-Mot-De-Passe-1" });
      const after = await h.admin.query(`SELECT password_hash FROM iam.identities WHERE email = 'legacy@exemple.ci'`);
      expect(after.rows[0].password_hash).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$/);
      // et le même mot de passe fonctionne encore avec le nouveau hash
      await h.loginOk("legacy@exemple.ci", { password: "Ancien-Mot-De-Passe-1" });
      const bad = await h.iam.login({ email: "legacy@exemple.ci", password: "faux", meta: meta() });
      expect(bad.ok).toBe(false);
    });
  });

  describe("une identité, deux accès (parent dans deux établissements)", () => {
    it("un seul e-mail global, deux memberships, choix du tenant actif et switch-tenant", async () => {
      const a = await h.member(A, "parent.multi@exemple.ci", ["parent"]);
      const b = await h.member(B, "parent.multi@exemple.ci", ["parent", "teacher"]);
      expect(b.identityId).toBe(a.identityId); // identité GLOBALE réutilisée
      const identities = await h.admin.query(`SELECT count(*)::int AS n FROM iam.identities WHERE email = 'parent.multi@exemple.ci'`);
      expect(identities.rows[0].n).toBe(1);

      const first = await h.loginOk("parent.multi@exemple.ci");
      expect(first.user.tenantSlug).toBe("lycee-a"); // plus ancien accès
      expect(first.tenants.map((t) => t.slug).sort()).toEqual(["college-b", "lycee-a"]);

      const second = await h.loginOk("parent.multi@exemple.ci", { tenantSlug: "college-b" });
      expect(second.user).toMatchObject({ tenantId: B, tenantSlug: "college-b" });
      expect(second.session.claims.roles).toEqual(["parent", "teacher"]);

      // Le dernier tenant utilisé devient le défaut.
      const third = await h.loginOk("parent.multi@exemple.ci");
      expect(third.user.tenantSlug).toBe("college-b");

      // switch-tenant depuis la session du tenant A
      const pA = await h.iam.authenticate(first.session.accessToken);
      if (!pA.ok) throw pA.error;
      const sw = await h.iam.switchTenant(pA.value.principal, { tenantId: B, meta: meta() });
      expect(sw.ok).toBe(true);
      if (!sw.ok || sw.value.status !== "authenticated") throw new Error("switch attendu");
      expect(sw.value.user).toMatchObject({ tenantId: B, tenantSlug: "college-b" });

      // L'ancienne session (tenant A) est révoquée ; la nouvelle fonctionne.
      expect((await authOk(first.session.accessToken)).ok).toBe(false);
      const ctxB = await authOk(sw.value.session.accessToken);
      expect(ctxB.ok && ctxB.value.principal.ctx.tenantId).toBe(B);
      const ev = await h.events(A, "iam.session.revoked");
      expect(ev.some((e) => e.payload.sessionId === first.session.sessionId && e.payload.reason === "switched_tenant")).toBe(true);
      expect((await h.events(B, "iam.user.logged_in")).some((e) => e.payload.method === "switch_tenant")).toBe(true);
    });

    it("switch-tenant vers un établissement sans accès (ou même tenant) est refusé", async () => {
      await h.member(A, "mono@exemple.ci", ["parent"]);
      const out = await h.loginOk("mono@exemple.ci");
      const p = (await authOk(out.session.accessToken));
      if (!p.ok) throw p.error;
      const toB = await h.iam.switchTenant(p.value.principal, { tenantId: B, meta: meta() });
      expect(!toB.ok && toB.error.code).toBe(AuthErrorCodes.noActiveAccess);
      const same = await h.iam.switchTenant(p.value.principal, { tenantId: A, meta: meta() });
      expect(same.ok).toBe(false);
      // L'échec n'a pas révoqué la session d'origine.
      expect((await authOk(out.session.accessToken)).ok).toBe(true);
    });

    it("tenant demandé sans accès → iam.no_active_access (sans révéler d'autre tenant)", async () => {
      await h.member(A, "seul-a@exemple.ci", ["parent"]);
      const r = await h.iam.login({ email: "seul-a@exemple.ci", password: TEST_PASSWORD, tenantSlug: "college-b", meta: meta() });
      expect(!r.ok && r.error.code).toBe(AuthErrorCodes.noActiveAccess);
      const unknownSlug = await h.iam.login({ email: "seul-a@exemple.ci", password: TEST_PASSWORD, tenantSlug: "n-existe-pas", meta: meta() });
      expect(!unknownSlug.ok && unknownSlug.error.code).toBe(AuthErrorCodes.noActiveAccess);
    });

    it("un accès suspendu empêche le login et invalide immédiatement les sessions existantes (même en GET)", async () => {
      const m = await h.member(A, "suspendu@exemple.ci", ["teacher"]);
      const admin = await h.member(A, "admin-a@exemple.ci", ["secretary"]);
      const out = await h.loginOk("suspendu@exemple.ci");
      expect((await authOk(out.session.accessToken)).ok).toBe(true);

      const adminAuth = await h.iam.authenticate((await h.loginOk("admin-a@exemple.ci")).session.accessToken);
      if (!adminAuth.ok) throw adminAuth.error;
      const upd = await h.iam.updateMember(adminAuth.value.principal, m.membershipId, { status: "suspended" }, meta());
      expect(upd.ok).toBe(true);

      expect((await authOk(out.session.accessToken)).ok).toBe(false);
      const r = await h.iam.login({ email: "suspendu@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      expect(!r.ok && r.error.code).toBe(AuthErrorCodes.noActiveAccess);
      expect(admin.membershipId).not.toBe(m.membershipId);
      // pas d'auto-modification
      const self = await h.iam.updateMember(adminAuth.value.principal, admin.membershipId, { status: "suspended" }, meta());
      expect(self.ok).toBe(false);
    });

    it("un tenant suspendu invalide ses sessions", async () => {
      const C = await h.createTenant("tenant-c", "Tenant C");
      await h.member(C, "c-user@exemple.ci", ["teacher"]);
      const out = await h.loginOk("c-user@exemple.ci");
      expect((await authOk(out.session.accessToken)).ok).toBe(true);
      await h.admin.query(`UPDATE kernel.tenants SET status = 'suspended' WHERE id = $1`, [C]);
      expect((await authOk(out.session.accessToken)).ok).toBe(false);
      const again = await h.iam.login({ email: "c-user@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      expect(again.ok).toBe(false);
    });
  });

  describe("isolation entre tenants au niveau des use cases", () => {
    it("l'administrateur du tenant A ne voit, ne modifie ni ne déconnecte aucun membre du tenant B", async () => {
      await h.member(A, "boss-a@exemple.ci", ["secretary"]);
      const bUser = await h.member(B, "victime-b@exemple.ci", ["teacher"]);
      const bSession = await h.loginOk("victime-b@exemple.ci");
      const adminA = await h.iam.authenticate((await h.loginOk("boss-a@exemple.ci")).session.accessToken);
      if (!adminA.ok) throw adminA.error;
      const p = adminA.value.principal;

      const list = await h.iam.listMembers(p);
      expect(list.every((m) => m.tenant_id === A)).toBe(true);
      expect(list.some((m) => m.email === "victime-b@exemple.ci")).toBe(false);

      // Même en connaissant l'identifiant du membership de B : refus indiscernable d'un identifiant inexistant.
      const revoke = await h.iam.adminRevokeMemberSessions(p, bUser.membershipId, meta());
      expect(!revoke.ok && revoke.error.code).toBe(AuthErrorCodes.forbidden);
      const upd = await h.iam.updateMember(p, bUser.membershipId, { status: "revoked" }, meta());
      expect(upd.ok).toBe(false);
      const reset = await h.iam.adminResetMfa({ ...p, mfa: true }, bUser.membershipId, meta());
      expect(reset.ok).toBe(false);
      expect((await authOk(bSession.session.accessToken)).ok).toBe(true);
    });

    it("jeton signé correctement mais dont tenantId ne correspond pas à la session (bug interne simulé) → refusé par la base", async () => {
      const a = await h.member(A, "forge-a@exemple.ci", ["teacher"]);
      const out = await h.loginOk("forge-a@exemple.ci");
      const { issueBearerToken } = await import("../domain/access-token");
      const forged = issueBearerToken(h.config, h.clock, {
        userId: a.identityId,
        tenantId: B, // tenant forgé
        tenantSlug: "college-b",
        roles: ["teacher"],
        activeRole: "teacher",
        sessionId: out.session.sessionId, // session réelle, mais du tenant A
        membershipId: a.membershipId,
        mfa: false,
        amr: ["pwd"],
      });
      expect((await authOk(forged.token)).ok).toBe(false);
    });

    it("liste et révocation de SES sessions ; impossible de révoquer la session d'autrui", async () => {
      await h.member(A, "mes-sessions@exemple.ci", ["teacher"]);
      await h.member(A, "autre@exemple.ci", ["teacher"]);
      const s1 = await h.iam.login({ email: "mes-sessions@exemple.ci", password: TEST_PASSWORD, deviceName: "Téléphone de Awa", meta: meta({ ip: "192.0.2.10", userAgent: "Mozilla/5.0 (Android)" }) });
      const s2 = await h.loginOk("mes-sessions@exemple.ci");
      const other = await h.loginOk("autre@exemple.ci");
      if (!s1.ok || s1.value.status !== "authenticated") throw new Error("login attendu");
      const p1 = await h.iam.authenticate(s1.value.session.accessToken);
      if (!p1.ok) throw p1.error;

      const list = await h.iam.listSessions(p1.value.principal);
      expect(list).toHaveLength(2);
      const mine = list.find((s) => s.current);
      expect(mine).toMatchObject({ id: s1.value.session.sessionId, ip: "192.0.2.10", user_agent: "Mozilla/5.0 (Android)", device_name: "Téléphone de Awa", kind: "user" });

      const foreign = await h.iam.revokeSession(p1.value.principal, other.session.sessionId, meta());
      expect(foreign.ok).toBe(false);
      expect((await authOk(other.session.accessToken)).ok).toBe(true);

      expect((await h.iam.revokeSession(p1.value.principal, s2.session.sessionId, meta())).ok).toBe(true);
      expect((await authOk(s2.session.accessToken)).ok).toBe(false);
      expect(await h.iam.listSessions(p1.value.principal)).toHaveLength(1);
    });
  });

  describe("refresh à rotation + détection de réutilisation", () => {
    it("chaque usage échange le jeton ; l'ancien est mort ; la session reste", async () => {
      await h.member(A, "rotation@exemple.ci", ["teacher"]);
      const out = await h.loginOk("rotation@exemple.ci");
      const rt0 = out.session.refreshToken as string;
      h.clock.advance(60_000);
      const r1 = await h.iam.refresh({ refreshToken: rt0, meta: meta() });
      if (!r1.ok) throw r1.error;
      const rt1 = r1.value.session.refreshToken as string;
      expect(rt1).not.toBe(rt0);
      expect(r1.value.session.sessionId).toBe(out.session.sessionId);
      expect((await authOk(r1.value.session.accessToken)).ok).toBe(true);
      // le jeton d'accès précédent reste valable jusqu'à son expiration (15 min) : la session est la même
      expect((await authOk(out.session.accessToken)).ok).toBe(true);
      const r2 = await h.iam.refresh({ refreshToken: rt1, meta: meta() });
      expect(r2.ok).toBe(true);
    });

    it("RÉUTILISATION d'un ancien refresh token → toute la session est révoquée (y compris le jeton légitime suivant)", async () => {
      await h.member(A, "reuse@exemple.ci", ["teacher"]);
      const out = await h.loginOk("reuse@exemple.ci");
      const stolen = out.session.refreshToken as string;
      const legit = await h.iam.refresh({ refreshToken: stolen, meta: meta() });
      if (!legit.ok) throw legit.error;

      // L'attaquant rejoue l'ancien jeton.
      const replay = await h.iam.refresh({ refreshToken: stolen, meta: meta({ ip: "198.51.100.99" }) });
      expect(!replay.ok && replay.error.code).toBe(AuthErrorCodes.refreshInvalid);

      // Le jeton LÉGITIME le plus récent est mort aussi, ainsi que l'accès en cours.
      const next = await h.iam.refresh({ refreshToken: legit.value.session.refreshToken as string, meta: meta() });
      expect(next.ok).toBe(false);
      expect((await authOk(legit.value.session.accessToken)).ok).toBe(false);

      const ev = (await h.events(A, "iam.session.revoked")).find((e) => e.payload.reason === "refresh_reuse");
      expect(ev?.payload).toMatchObject({ sessionId: out.session.sessionId, scope: "family", ip: "198.51.100.99" });
      const row = await h.admin.query(`SELECT revoked_reason FROM iam.sessions WHERE id = $1`, [out.session.sessionId]);
      expect(row.rows[0].revoked_reason).toBe("refresh_reuse");
    });

    it("deux rafraîchissements simultanés avec le même jeton : un seul réussit, la session est ensuite révoquée", async () => {
      await h.member(A, "course@exemple.ci", ["teacher"]);
      const out = await h.loginOk("course@exemple.ci");
      const rt = out.session.refreshToken as string;
      const [x, y] = await Promise.all([h.iam.refresh({ refreshToken: rt, meta: meta() }), h.iam.refresh({ refreshToken: rt, meta: meta() })]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      const winner = x.ok ? x : y;
      if (!winner.ok) throw new Error("gagnant attendu");
      expect((await authOk(winner.value.session.accessToken)).ok).toBe(false);
    });

    it("fenêtre de grâce configurable : une double soumission rapprochée est refusée SANS révoquer la session", async () => {
      const g = await createHarness({ overrides: { refreshReuseGraceMs: 5000 } });
      try {
        const t = await g.createTenant("grace", "Grâce");
        await g.member(t, "grace@exemple.ci", ["teacher"]);
        const out = await g.loginOk("grace@exemple.ci");
        const rt = out.session.refreshToken as string;
        const first = await g.iam.refresh({ refreshToken: rt, meta: meta() });
        if (!first.ok) throw first.error;
        g.clock.advance(1000);
        expect((await g.iam.refresh({ refreshToken: rt, meta: meta() })).ok).toBe(false);
        // la session survit : le jeton le plus récent fonctionne
        expect((await g.iam.refresh({ refreshToken: first.value.session.refreshToken as string, meta: meta() })).ok).toBe(true);
        // hors fenêtre : c'est une réutilisation
        g.clock.advance(10_000);
        const late = await g.iam.refresh({ refreshToken: rt, meta: meta() });
        expect(late.ok).toBe(false);
        const row = await g.admin.query(`SELECT revoked_reason FROM iam.sessions WHERE id = $1`, [out.session.sessionId]);
        expect(row.rows[0].revoked_reason).toBe("refresh_reuse");
      } finally {
        await g.stop();
      }
    });

    it("jeton expiré (inactivité), session trop ancienne, tenant falsifié dans le préfixe, jeton inventé → refusés", async () => {
      await h.member(A, "expire@exemple.ci", ["teacher"]);
      const out = await h.loginOk("expire@exemple.ci");
      const rt = out.session.refreshToken as string;

      // tenant falsifié dans le préfixe : aucune ligne trouvée sous la RLS de B
      const forgedTenant = rt.replace(/^rt1\.[0-9a-f]{32}/, `rt1.${B.replace(/-/g, "")}`);
      expect((await h.iam.refresh({ refreshToken: forgedTenant, meta: meta() })).ok).toBe(false);
      expect((await h.iam.refresh({ refreshToken: "rt1." + "0".repeat(32) + "." + "A".repeat(43), meta: meta() })).ok).toBe(false);
      expect((await h.iam.refresh({ refreshToken: "n'importe quoi", meta: meta() })).ok).toBe(false);

      // le jeton légitime est intact après ces tentatives
      const fresh = await h.iam.refresh({ refreshToken: rt, meta: meta() });
      expect(fresh.ok).toBe(true);
      if (!fresh.ok) return;

      h.clock.advance((h.config.refreshIdleTtlSec + 1) * 1000);
      expect((await h.iam.refresh({ refreshToken: fresh.value.session.refreshToken as string, meta: meta() })).ok).toBe(false);
    });

    it("durée de vie absolue de la session : plus de refresh au-delà de sessionMaxAge", async () => {
      const g = await createHarness({ overrides: { sessionMaxAgeSec: 3600, refreshIdleTtlSec: 1800 } });
      try {
        const t = await g.createTenant("absolu", "Absolu");
        await g.member(t, "absolu@exemple.ci", ["teacher"]);
        let rt = (await g.loginOk("absolu@exemple.ci")).session.refreshToken as string;
        for (let i = 0; i < 2; i += 1) {
          g.clock.advance(1500 * 1000); // sous l'inactivité max, mais on cumule
          const r = await g.iam.refresh({ refreshToken: rt, meta: meta() });
          if (!r.ok) throw r.error;
          rt = r.value.session.refreshToken as string;
        }
        g.clock.advance(1500 * 1000); // 4500 s > 3600 s
        expect((await g.iam.refresh({ refreshToken: rt, meta: meta() })).ok).toBe(false);
      } finally {
        await g.stop();
      }
    });

    it("le refresh token d'un utilisateur dont l'accès est révoqué, ou après logout-all, est inutilisable", async () => {
      await h.member(A, "logout-all@exemple.ci", ["teacher"]);
      const s1 = await h.loginOk("logout-all@exemple.ci");
      const s2 = await h.loginOk("logout-all@exemple.ci");
      const p = await h.iam.authenticate(s1.session.accessToken);
      if (!p.ok) throw p.error;
      const res = await h.iam.logoutAll(p.value.principal, meta());
      expect(res.revoked).toBe(2);
      expect((await h.iam.refresh({ refreshToken: s1.session.refreshToken as string, meta: meta() })).ok).toBe(false);
      expect((await h.iam.refresh({ refreshToken: s2.session.refreshToken as string, meta: meta() })).ok).toBe(false);
      expect((await authOk(s2.session.accessToken)).ok).toBe(false);
    });
  });

  describe("révocation", () => {
    it("logout révoque la session : jeton d'accès refusé immédiatement (la vérification ne dépend pas de la méthode HTTP)", async () => {
      await h.member(A, "logout@exemple.ci", ["teacher"]);
      const out = await h.loginOk("logout@exemple.ci");
      const p = await h.iam.authenticate(out.session.accessToken);
      if (!p.ok) throw p.error;
      await h.iam.logout(p.value.principal, meta());
      const after = await authOk(out.session.accessToken);
      expect(!after.ok && after.error.code).toBe(AuthErrorCodes.sessionRevoked);
      // idempotent
      await h.iam.logout(p.value.principal, meta());
      expect((await h.events(A, "iam.session.revoked")).filter((e) => e.payload.sessionId === out.session.sessionId)).toHaveLength(1);
    });

    it("logout par refresh token (jeton d'accès expiré)", async () => {
      await h.member(A, "logout-rt@exemple.ci", ["teacher"]);
      const out = await h.loginOk("logout-rt@exemple.ci");
      h.clock.advance(3600_000);
      expect((await authOk(out.session.accessToken)).ok).toBe(false);
      await h.iam.logoutByRefreshToken(out.session.refreshToken as string, meta());
      const row = await h.admin.query(`SELECT revoked_reason FROM iam.sessions WHERE id = $1`, [out.session.sessionId]);
      expect(row.rows[0].revoked_reason).toBe("logout");
    });

    it("logout-all coupe aussi les sessions des AUTRES tenants de l'identité (auth_epoch)", async () => {
      await h.member(A, "epoch@exemple.ci", ["parent"]);
      await h.member(B, "epoch@exemple.ci", ["parent"]);
      const inA = await h.loginOk("epoch@exemple.ci", { tenantSlug: "lycee-a" });
      const inB = await h.loginOk("epoch@exemple.ci", { tenantSlug: "college-b" });
      const p = await h.iam.authenticate(inA.session.accessToken);
      if (!p.ok) throw p.error;
      await h.iam.logoutAll(p.value.principal, meta());
      expect((await authOk(inA.session.accessToken)).ok).toBe(false);
      expect((await authOk(inB.session.accessToken)).ok).toBe(false);
      // une nouvelle connexion repart sur la nouvelle époque
      const again = await h.loginOk("epoch@exemple.ci", { tenantSlug: "college-b" });
      expect((await authOk(again.session.accessToken)).ok).toBe(true);
    });

    it("révocation par l'administrateur : toutes les sessions d'un membre du tenant", async () => {
      const victim = await h.member(A, "a-deconnecter@exemple.ci", ["teacher"]);
      await h.member(A, "rev-admin@exemple.ci", ["secretary"]);
      const s1 = await h.loginOk("a-deconnecter@exemple.ci");
      const s2 = await h.loginOk("a-deconnecter@exemple.ci");
      const adminP = await h.iam.authenticate((await h.loginOk("rev-admin@exemple.ci")).session.accessToken);
      if (!adminP.ok) throw adminP.error;
      const out = await h.iam.adminRevokeMemberSessions(adminP.value.principal, victim.membershipId, meta());
      expect(out.ok && out.value.revoked).toBe(2);
      expect((await authOk(s1.session.accessToken)).ok).toBe(false);
      expect((await authOk(s2.session.accessToken)).ok).toBe(false);
      const ev = (await h.events(A, "iam.session.revoked")).find((e) => e.payload.reason === "revoked_by_admin");
      expect(ev?.payload.revokedBy).toBe(adminP.value.principal.identityId);
    });

    it("jeton d'accès expiré refusé avec le code « expiré » (le client peut rafraîchir)", async () => {
      await h.member(A, "expiration@exemple.ci", ["teacher"]);
      const out = await h.loginOk("expiration@exemple.ci");
      h.clock.advance(16 * 60_000);
      const r = await authOk(out.session.accessToken);
      expect(!r.ok && r.error.code).toBe(AuthErrorCodes.tokenExpired);
    });

    it("rôle retiré après émission du jeton : le jeton dont le rôle actif n'existe plus est refusé", async () => {
      const m = await h.member(A, "role-change@exemple.ci", ["teacher", "parent"]);
      await h.member(A, "role-admin@exemple.ci", ["secretary"]);
      const out = await h.loginOk("role-change@exemple.ci", { activeRole: "parent" });
      const adminP = await h.iam.authenticate((await h.loginOk("role-admin@exemple.ci")).session.accessToken);
      if (!adminP.ok) throw adminP.error;
      const upd = await h.iam.updateMember(adminP.value.principal, m.membershipId, { roles: ["teacher"] }, meta());
      expect(upd.ok).toBe(true);
      expect((await authOk(out.session.accessToken)).ok).toBe(false);
    });

    it("purge des sessions expirées", async () => {
      const g = await createHarness();
      try {
        const t = await g.createTenant("purge", "Purge");
        await g.member(t, "purge@exemple.ci", ["teacher"]);
        const out = await g.loginOk("purge@exemple.ci");
        await g.iam.logoutByRefreshToken(out.session.refreshToken as string, meta());
        g.clock.advance(40 * 86_400_000);
        const report = await g.iam.purgeExpiredData(30);
        expect(report.sessions).toBeGreaterThanOrEqual(1);
        const left = await g.admin.query(`SELECT count(*)::int AS n FROM iam.sessions`);
        expect(left.rows[0].n).toBe(0);
      } finally {
        await g.stop();
      }
    });
  });

  it("le contexte construit est gelé et porte le rôle actif, pas la liste complète", async () => {
    await h.member(A, "ctx@exemple.ci", ["teacher", "parent"]);
    const out = await h.loginOk("ctx@exemple.ci", { activeRole: "parent" });
    const r = await buildRequestContextFromToken(out.session.accessToken, h.iam, { requestId: "req-123" });
    if (!r.ok) throw r.error;
    expect(r.value.ctx.roles).toEqual(["parent"]);
    expect(r.value.ctx.requestId).toBe("req-123");
    expect(Object.isFrozen(r.value.ctx)).toBe(true);
    expect(createRequestContext).toBeTypeOf("function");
  });

  it("tenant attendu (sous-domaine/en-tête) différent de celui du jeton → refus", async () => {
    await h.member(A, "attendu@exemple.ci", ["teacher"]);
    const out = await h.loginOk("attendu@exemple.ci");
    const r = await h.iam.authenticate(out.session.accessToken, { expectedTenantSlug: "college-b" });
    expect(r.ok).toBe(false);
    expect((await h.iam.authenticate(out.session.accessToken, { expectedTenantSlug: "lycee-a" })).ok).toBe(true);
  });
});
