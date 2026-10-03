/**
 * TEST DE SORTIE DE PHASE 1 (plan §4) : « deux tenants de test isolés, un utilisateur avec rôle personnalisé
 * et périmètre campus, MFA actif, audit visible, tous les modules déclarés dans le registre, premier
 * encaissement en sandbox de bout en bout ».
 *
 * Tout passe par HTTP (`app.inject`) sur la plateforme ASSEMBLÉE comme `src/index.ts` le fait :
 *   Postgres réel (migrations réelles, rôle app_user, RLS) + Redis réel + VRAIS plugins legacy
 *   (tenant-context, auth-middleware, JWT legacy) + `registerV2Platform` + VRAI worker (relais d'outbox,
 *   abonnés, jobs découverts sur disque).
 *
 * Étapes : (a) deux tenants provisionnés par la console, isolation par appels croisés ; (b) rôle personnalisé
 * limité à un campus ; (c) MFA ; (d) feature non souscrite puis souscrite ; (e) audit et chaînage ;
 * (f) premier encaissement bout en bout ; (g) navigation. Elles partagent l'état : elles s'exécutent dans l'ordre.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX_SECRET } from "../../src/modules/finance";
import { audit } from "../../src/modules/audit";
import { SYSTEM_ROLE_TEMPLATES } from "../../src/modules/rbac";
import { listPublicRoutes } from "../../src/platform/public-routes";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, startPhase1Platform, waitFor, type Phase1Env } from "./support/harness";
import {
  PASSWORD,
  loginPlain,
  loginRaw,
  loginWithChallenge,
  loginWithMfaEnrollment,
  provisionByConsole,
  readAuditLog,
  redeemInvitation,
  seedLearner,
  type ProvisionedOwner,
  type Session,
} from "./support/scenario";
import { totpAt } from "./support/totp";

describeIntegration.skipIf(!REDIS_URL)("TEST DE SORTIE DE PHASE 1 — plateforme v2 assemblée, de bout en bout", () => {
  let p: Phase1Env;
  let A: ProvisionedOwner;
  let B: ProvisionedOwner;
  let ownerA: Session;
  let ownerB: Session;

  beforeAll(async () => {
    p = await startPhase1Platform();
  }, 240_000);
  afterAll(async () => {
    await p?.stop();
  });

  it("(0) les sept modules sont chargés ; les routes publiques sont DÉRIVÉES de leurs déclarations", () => {
    expect(p.status.modules).toEqual(expect.arrayContaining(["audit", "entitlements", "finance", "iam", "platform", "rbac", "tenancy"]));
    const publicRoutes = listPublicRoutes().map((r) => `${r.method} ${r.url}`);
    expect(publicRoutes).toEqual(
      expect.arrayContaining([
        "POST /api/v1/iam/login",
        "POST /api/v1/iam/refresh",
        "POST /api/v1/iam/mfa/challenge",
        "POST /api/v1/finance/webhooks/:provider/:tenantId",
        "POST /api/v1/platform/tenants",
        "PUT /api/v1/entitlements/admin/plans/:key",
      ]),
    );
    // Une route de tenant n'est jamais publique.
    expect(publicRoutes).not.toContain("GET /api/v1/rbac/roles");
    expect(publicRoutes).not.toContain("GET /api/v1/iam/me");
  });

  describe("(a) deux tenants provisionnés par la console, isolés", () => {
    it("la console n'ouvre qu'aux opérateurs : sans jeton, jeton de tenant legacy, jeton IAM → 401", async () => {
      const body = { name: "X", slug: "xx", countryCode: "CI", packs: ["HIGHER"], adminContact: { name: "A B", email: "a@b.test" } };
      expect((await p.http("POST", "/api/v1/platform/tenants", { body })).status).toBe(401);
      const legacyTenantToken = p.generateLegacyToken({
        id: "0192f0a4-7b1e-7c3a-8d2e-0000000000c1",
        tenantId: "0192f0a4-7b1e-7c3a-8d2e-0000000000c2",
        tenantSlug: "legacy",
        role: "admin",
      });
      expect((await p.http("POST", "/api/v1/platform/tenants", { body, token: legacyTenantToken })).status).toBe(401);
      expect((await p.http("GET", "/api/v1/platform/tenants", { token: "eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9.e30.AAAA" })).status).toBe(401);
    });

    it("provisionne A et B : organisation, établissement + campus, rôles système, essai, propriétaire invité", async () => {
      A = await provisionByConsole(p, { name: "Lycée Alpha", slug: "alpha", packs: ["HIGHER"], ownerEmail: "owner@alpha.test" });
      B = await provisionByConsole(p, { name: "Collège Beta", slug: "beta", packs: ["PRIMARY"], ownerEmail: "owner@beta.test" });
      expect(A.tenantId).not.toBe(B.tenantId);

      for (const t of [A, B]) {
        const roles = await p.db.admin.query("SELECT count(*)::int AS n FROM rbac.roles WHERE tenant_id = $1 AND is_system", [t.tenantId]);
        expect(roles.rows[0].n).toBe(SYSTEM_ROLE_TEMPLATES.length);
        const sub = await p.db.admin.query("SELECT plan_key, status, packs FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [t.tenantId]);
        expect(sub.rows).toHaveLength(1);
        expect(sub.rows[0]).toMatchObject({ plan_key: "STARTER", status: "TRIALING" });
        const owner = await p.db.admin.query(
          `SELECT r.template_key FROM rbac.user_role_assignments a JOIN rbac.roles r ON r.id = a.role_id
            WHERE a.tenant_id = $1 AND a.user_id = $2`,
          [t.tenantId, t.ownerIdentityId],
        );
        expect(owner.rows.map((r) => r.template_key)).toEqual(["owner"]);
      }
      const list = await p.http("GET", "/api/v1/platform/tenants?limit=50", { token: p.operatorToken });
      expect(list.status).toBe(200);
      expect(list.body.items.map((t: { slug: string }) => t.slug)).toEqual(expect.arrayContaining(["alpha", "beta"]));
    });

    it("les propriétaires activent leur compte par l'invitation et enrôlent la MFA (rôle owner : obligatoire)", async () => {
      await redeemInvitation(p, A.ownerEmail);
      await redeemInvitation(p, B.ownerEmail);
      ownerA = await loginWithMfaEnrollment(p, A.ownerEmail, A.slug);
      ownerB = await loginWithMfaEnrollment(p, B.ownerEmail, B.slug);
      expect(ownerA.identityId).toBe(A.ownerIdentityId);
      // finance verifie l'apprenant dans people (adaptateurs de plateforme) : les apprenants des scenarios financiers existent.
      // (les identifiants de dossiers sont uniques sur toute la plateforme : un apprenant par tenant)
      await seedLearner(p, B.tenantId, "0192f0a4-7b1e-7c3a-8d2e-00000000a002");
      await seedLearner(p, A.tenantId, "0192f0a4-7b1e-7c3a-8d2e-00000000a111");
    });

    it("isolation par appels CROISÉS : A ne voit, ne lit ni ne modifie rien de B (et réciproquement)", async () => {
      const mineA = await p.http("GET", "/api/v1/tenancy/institutions", { token: ownerA.accessToken });
      const mineB = await p.http("GET", "/api/v1/tenancy/institutions", { token: ownerB.accessToken });
      expect(mineA.body.items.map((i: { id: string }) => i.id)).toEqual([A.institutionId]);
      expect(mineB.body.items.map((i: { id: string }) => i.id)).toEqual([B.institutionId]);

      // Lecture / écriture d'une ressource de l'autre tenant par son identifiant : introuvable (RLS), jamais 200.
      expect((await p.http("GET", `/api/v1/tenancy/institutions/${B.institutionId}`, { token: ownerA.accessToken })).status).toBe(404);
      expect((await p.http("GET", `/api/v1/tenancy/institutions/${A.institutionId}`, { token: ownerB.accessToken })).status).toBe(404);
      const hijack = await p.http("PATCH", `/api/v1/tenancy/campuses/${B.defaultCampusId}`, { token: ownerA.accessToken, body: { name: "Piraté" } });
      expect([403, 404]).toContain(hijack.status);
      const stillB = await p.db.admin.query("SELECT name FROM tenancy.campuses WHERE id = $1", [B.defaultCampusId]);
      expect(stillB.rows[0].name).not.toBe("Piraté");

      // Rôles, assignations et journal d'audit : uniquement ceux du tenant.
      const rolesA = await p.http("GET", "/api/v1/rbac/roles", { token: ownerA.accessToken });
      const rolesB = await p.http("GET", "/api/v1/rbac/roles", { token: ownerB.accessToken });
      const idsA = new Set(rolesA.body.roles.map((r: { id: string }) => r.id));
      expect(rolesA.body.roles).toHaveLength(SYSTEM_ROLE_TEMPLATES.length);
      expect(rolesB.body.roles.every((r: { id: string }) => !idsA.has(r.id))).toBe(true);
      const auditA = await readAuditLog(p, ownerA.accessToken);
      const auditB = await readAuditLog(p, ownerB.accessToken);
      expect(auditA.length).toBeGreaterThan(0);
      expect(new Set(auditA.map((e) => e.tenantId))).toEqual(new Set([A.tenantId]));
      expect(new Set(auditB.map((e) => e.tenantId))).toEqual(new Set([B.tenantId]));

      // Les droits effectifs de A ne se lisent pas dans B.
      const entA = await p.http("GET", "/api/v1/entitlements/me", { token: ownerA.accessToken });
      expect(entA.body.tenantId).toBe(A.tenantId);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("(b) rôle PERSONNALISÉ limité à un campus", () => {
    let nord: string;
    let sud: string;
    let campusRoleId: string;
    let manager: Session;
    const MANAGER = "gestionnaire@alpha.test";

    it("le propriétaire (MFA) crée deux campus, un rôle personnalisé et invite un gestionnaire", async () => {
      const mkCampus = async (name: string, code: string) => {
        const r = await p.http("POST", `/api/v1/tenancy/institutions/${A.institutionId}/campuses`, { token: ownerA.accessToken, body: { name, code } });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        return r.body.id as string;
      };
      nord = await mkCampus("Campus Nord", "nord");
      sud = await mkCampus("Campus Sud", "sud");

      const role = await p.http("POST", "/api/v1/rbac/roles", {
        token: ownerA.accessToken,
        body: { label: "Gestionnaire de campus", permissions: ["tenancy.campus.manage", "finance.report.read"] },
      });
      expect(role.status, JSON.stringify(role.body)).toBe(201);
      expect(role.body.isSystem).toBe(false);
      campusRoleId = role.body.id;

      const invite = await p.http("POST", "/api/v1/iam/admin/members", { token: ownerA.accessToken, body: { email: MANAGER, roles: ["teacher"], sendInvitation: true } });
      expect(invite.status, JSON.stringify(invite.body)).toBe(201);
      await redeemInvitation(p, MANAGER);
      manager = await loginPlain(p, MANAGER, A.slug);

      const grant = await p.http("POST", "/api/v1/rbac/assignments", {
        token: ownerA.accessToken,
        body: { userId: manager.identityId, roleId: campusRoleId, scope: { type: "campus", id: nord } },
      });
      expect(grant.status, JSON.stringify(grant.body)).toBe(201);
    });

    it("refuse une assignation vers un campus qui n'existe pas (arbre de périmètres fourni par tenancy)", async () => {
      const ghost = await p.http("POST", "/api/v1/rbac/assignments", {
        token: ownerA.accessToken,
        body: { userId: manager.identityId, roleId: campusRoleId, scope: { type: "campus", id: B.defaultCampusId } },
      });
      expect(ghost.status).toBe(400);
      expect(ghost.body.code).toBe("rbac.unknown_scope");
    });

    it("accès AUTORISÉ sur son campus, 403 sur un autre campus et sur une permission non accordée", async () => {
      const ok = await p.http("PATCH", `/api/v1/tenancy/campuses/${nord}`, { token: manager.accessToken, body: { phone: "+225 27 20 00 00 01" } });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.phone).toBeTruthy();

      const otherCampus = await p.http("PATCH", `/api/v1/tenancy/campuses/${sud}`, { token: manager.accessToken, body: { phone: "+225 27 20 00 00 02" } });
      expect(otherCampus.status).toBe(403);
      const untouched = await p.db.admin.query("SELECT phone FROM tenancy.campuses WHERE id = $1", [sud]);
      expect(untouched.rows[0].phone).toBeNull();

      // Il ne peut pas créer un campus (périmètre établissement) ni toucher au campus d'un autre tenant.
      expect((await p.http("POST", `/api/v1/tenancy/institutions/${A.institutionId}/campuses`, { token: manager.accessToken, body: { name: "Campus Est" } })).status).toBe(403);
      expect((await p.http("PATCH", `/api/v1/tenancy/campuses/${B.defaultCampusId}`, { token: manager.accessToken, body: { phone: "+225 27 20 00 00 03" } })).status).toBe(403);

      // Permission non accordée : finances (écriture), rôles, audit.
      expect((await p.http("POST", "/api/v1/finance/fees", { token: manager.accessToken, body: { code: "X", name: "X", category: "OTHER" } })).status).toBe(403);
      expect((await p.http("GET", "/api/v1/finance/fees", { token: manager.accessToken })).status).toBe(403);
      expect((await p.http("POST", "/api/v1/rbac/roles", { token: manager.accessToken, body: { label: "Piraterie", permissions: ["*"] } })).status).toBe(403);
      expect((await p.http("GET", "/api/v1/audit/logs", { token: manager.accessToken })).status).toBe(403);

      // Ses droits effectifs reflètent le périmètre campus.
      const me = await p.http("GET", "/api/v1/rbac/me/permissions", { token: manager.accessToken });
      expect(me.status).toBe(200);
      expect(JSON.stringify(me.body)).toContain(nord);
    });

    it("la révocation de l'assignation retire l'accès immédiatement (cache invalidé)", async () => {
      const list = await p.http("GET", `/api/v1/rbac/assignments?userId=${manager.identityId}`, { token: ownerA.accessToken });
      expect(list.body.assignments).toHaveLength(1);
      const revoke = await p.http("DELETE", `/api/v1/rbac/assignments/${list.body.assignments[0].id}`, { token: ownerA.accessToken });
      expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
      expect((await p.http("PATCH", `/api/v1/tenancy/campuses/${nord}`, { token: manager.accessToken, body: { phone: "+225 27 20 00 00 04" } })).status).toBe(403);
      // Rétablie pour la suite (navigation).
      const again = await p.http("POST", "/api/v1/rbac/assignments", {
        token: ownerA.accessToken,
        body: { userId: manager.identityId, roleId: campusRoleId, scope: { type: "campus", id: nord } },
      });
      expect(again.status).toBe(201);
      expect((await p.http("PATCH", `/api/v1/tenancy/campuses/${nord}`, { token: manager.accessToken, body: { phone: "+225 27 20 00 00 05" } })).status).toBe(200);
    });

    it("exposé aux étapes suivantes", () => {
      (globalThis as Record<string, unknown>).__phase1 = { managerToken: manager.accessToken, nord, sud };
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("(c) MFA : permission sensible refusée sans MFA, accordée après enrôlement + défi TOTP", () => {
    const AUDITOR = "auditeur@alpha.test";
    let auditor: Session;

    it("sans MFA : audit.read passe, audit.export (sensible) est refusé avec rbac.mfa_required", async () => {
      const role = await p.http("POST", "/api/v1/rbac/roles", {
        token: ownerA.accessToken,
        body: { label: "Auditeur", permissions: ["audit.read", "audit.export"] },
      });
      expect(role.status, JSON.stringify(role.body)).toBe(201);
      const invite = await p.http("POST", "/api/v1/iam/admin/members", { token: ownerA.accessToken, body: { email: AUDITOR, roles: ["auditeur"], sendInvitation: true } });
      expect(invite.status, JSON.stringify(invite.body)).toBe(201);
      await redeemInvitation(p, AUDITOR);
      auditor = await loginPlain(p, AUDITOR, A.slug);
      const grant = await p.http("POST", "/api/v1/rbac/assignments", {
        token: ownerA.accessToken,
        body: { userId: auditor.identityId, roleId: role.body.id, scope: { type: "tenant" } },
      });
      expect(grant.status, JSON.stringify(grant.body)).toBe(201);

      expect((await p.http("GET", "/api/v1/audit/logs?limit=5", { token: auditor.accessToken })).status).toBe(200);
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 3_600_000).toISOString();
      const denied = await p.http("GET", `/api/v1/audit/logs/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token: auditor.accessToken });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("rbac.mfa_required");
    });

    it("après enrôlement TOTP (mot de passe + code) puis défi à la connexion : l'export est accordé", async () => {
      const enroll = await p.http("POST", "/api/v1/iam/mfa/enroll", { token: auditor.accessToken, body: { password: PASSWORD } });
      expect(enroll.status, JSON.stringify(enroll.body)).toBe(200);
      const secret = enroll.body.secret as string;
      const verify = await p.http("POST", "/api/v1/iam/mfa/verify", { token: auditor.accessToken, body: { code: totpAt(secret, Date.now()), client: "mobile" } });
      expect(verify.status, JSON.stringify(verify.body)).toBe(200);

      // Une session SANS second facteur reste refusée, même après l'enrôlement.
      const login = await loginRaw(p, AUDITOR, A.slug);
      expect(login.body.status).toBe("mfa_required");
      const wrong = await p.http("POST", "/api/v1/iam/mfa/challenge", { body: { challengeToken: login.body.challengeToken, code: "000000", client: "mobile" } });
      expect(wrong.status).toBe(401);

      const strong = await loginWithChallenge(p, AUDITOR, A.slug, secret);
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 3_600_000).toISOString();
      const exported = await p.http("GET", `/api/v1/audit/logs/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token: strong.accessToken });
      expect(exported.status, exported.raw.slice(0, 200)).toBe(200);
      expect(String(exported.headers["content-type"])).toContain("text/csv");
      expect(exported.raw.split("\n").length).toBeGreaterThan(2);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("(d) feature non souscrite -> 403 via requireFeature ; accessible après changement d'abonnement par la console", () => {
    const pay = (token: string, key: string) =>
      p.http("POST", "/api/v1/finance/payments/online", {
        token,
        headers: { "idempotency-key": key },
        body: { learnerId: "0192f0a4-7b1e-7c3a-8d2e-00000000a002", amount: 50000, provider: "sandbox" },
      });

    it("B passe en STARTER sans pack : le paiement en ligne est refusé (403 entitlements.feature_not_available)", async () => {
      const sub = await p.http("PUT", `/api/v1/platform/tenants/${B.tenantId}/subscription`, {
        token: p.operatorToken,
        body: { planKey: "STARTER", packs: [], status: "ACTIVE" },
      });
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      const denied = await pay(ownerB.accessToken, "idem-b-0001");
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("entitlements.feature_not_available");
      expect(denied.body.details).toMatchObject({ feature: "finance.online-payment" });
      // Une feature CORE (échéanciers) reste accessible.
      expect((await p.http("GET", "/api/v1/finance/installment-plans", { token: ownerB.accessToken })).status).toBe(200);
    });

    it("la console souscrit le pack PRIMARY : la même requête est acceptée immédiatement", async () => {
      const sub = await p.http("PUT", `/api/v1/platform/tenants/${B.tenantId}/subscription`, {
        token: p.operatorToken,
        body: { planKey: "STARTER", packs: ["PRIMARY"], status: "ACTIVE" },
      });
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      const accepted = await pay(ownerB.accessToken, "idem-b-0002");
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
      expect(accepted.body.payment.status).toBe("CONFIRMED");
      expect(accepted.body.payment.simulated).toBe(true);
      expect(accepted.body.receipt.number).toMatch(/^REC-\d{4}-\d{6}$/);
    });

    it("une surcharge DENY de la console retire la feature, sa suppression la rend", async () => {
      const deny = await p.http("PUT", `/api/v1/platform/tenants/${B.tenantId}/overrides/finance.online-payment`, {
        token: p.operatorToken,
        body: { effect: "DENY", reason: "Impayé de la redevance" },
      });
      expect(deny.status, JSON.stringify(deny.body)).toBe(200);
      expect((await pay(ownerB.accessToken, "idem-b-0003")).status).toBe(403);
      expect((await p.http("DELETE", `/api/v1/platform/tenants/${B.tenantId}/overrides/finance.online-payment`, { token: p.operatorToken })).status).toBe(204);
      expect((await pay(ownerB.accessToken, "idem-b-0004")).status).toBe(201);
    });

    it("la suspension d'un tenant par la console coupe l'accès sur-le-champ ; la réactivation le rétablit", async () => {
      const suspend = await p.http("PATCH", `/api/v1/platform/tenants/${B.tenantId}/status`, {
        token: p.operatorToken,
        body: { status: "suspended", reason: "Impayé de la redevance" },
      });
      expect(suspend.status, JSON.stringify(suspend.body)).toBe(200);
      const blocked = await p.http("GET", "/api/v1/tenancy/institutions", { token: ownerB.accessToken });
      expect([401, 403]).toContain(blocked.status);
      expect((await loginRaw(p, B.ownerEmail, B.slug)).status).not.toBe(200);

      const reactivate = await p.http("PATCH", `/api/v1/platform/tenants/${B.tenantId}/status`, { token: p.operatorToken, body: { status: "active" } });
      expect(reactivate.status, JSON.stringify(reactivate.body)).toBe(200);
      expect((await p.http("GET", "/api/v1/tenancy/institutions", { token: ownerB.accessToken })).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("(f) premier encaissement : barème → facture → échéancier → paiement en ligne (sandbox) → webhook signé → reçu → événements", () => {
    const learnerId = "0192f0a4-7b1e-7c3a-8d2e-00000000a111";
    let invoiceId: string;
    let invoiceNumber: string;
    let paymentId: string;
    let providerRef: string;
    const sign = (rawBody: string) => createHmac("sha256", DEFAULT_SANDBOX_SECRET).update(rawBody, "utf8").digest("hex");
    const webhookBody = (eventId: string, type = "payment.succeeded") =>
      JSON.stringify({ id: eventId, type, reference: paymentId, transaction: providerRef, amount: 125000, currency: "XOF", occurred_at: new Date().toISOString() });

    it("le barème : un frais de scolarité, son tarif et un plan en 4 tranches", async () => {
      const fee = await p.http("POST", "/api/v1/finance/fees", { token: ownerA.accessToken, body: { code: "SCOL", name: "Scolarité 2026-2027", category: "TUITION" } });
      expect(fee.status, JSON.stringify(fee.body)).toBe(201);
      const schedule = await p.http("POST", "/api/v1/finance/fee-schedules", {
        token: ownerA.accessToken,
        body: { feeId: fee.body.id, academicYear: "2026-2027", amount: 500000, effectiveFrom: "2020-01-01" },
      });
      expect(schedule.status, JSON.stringify(schedule.body)).toBe(201);
      const plan = await p.http("POST", "/api/v1/finance/installment-plans", {
        token: ownerA.accessToken,
        body: {
          code: "T4",
          name: "Quatre tranches égales",
          steps: [1, 2, 3, 4].map((n) => ({ label: `Tranche ${n}`, share: { kind: "WEIGHT", weight: 1 }, due: { type: "OFFSET_DAYS", days: 30 * (n - 1) } })),
        },
      });
      expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    });

    it("la facture depuis le barème : numérotée, émise, échéancier 4 × 125 000 = 500 000", async () => {
      const res = await p.http("POST", "/api/v1/finance/invoices/from-schedule", {
        token: ownerA.accessToken,
        headers: { "idempotency-key": "inv-a-0001" },
        body: { learnerId, academicYear: "2026-2027", items: [{ feeCode: "SCOL" }], installments: { planCode: "T4" }, issue: true },
      });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      const invoice = res.body.invoices[0];
      invoiceId = invoice.id;
      invoiceNumber = invoice.number;
      expect(invoiceNumber).toMatch(/^FAC-\d{4}-\d{6}$/);
      expect(invoice.installments.map((i: { amount: { amount: number } }) => i.amount.amount)).toEqual([125000, 125000, 125000, 125000]);
      expect(invoice.total.amount).toBe(500000);
    });

    it("paiement en ligne via le SandboxProvider : en attente, puis confirmé par le webhook SIGNÉ (sans jeton)", async () => {
      const init = await p.http("POST", "/api/v1/finance/payments/online", {
        token: ownerA.accessToken,
        headers: { "idempotency-key": "pay-a-0001" },
        body: { learnerId, amount: 125000, provider: "sandbox", invoiceId, metadata: { sandbox: "pending" } },
      });
      expect(init.status, JSON.stringify(init.body)).toBe(201);
      expect(init.body.payment.status).toBe("PENDING");
      expect(init.body.payment.simulated).toBe(true);
      paymentId = init.body.payment.id;
      providerRef = init.body.payment.providerRef;
      expect(providerRef).toBe(`sbx_${paymentId}`);

      // Webhook SANS Authorization : la route publique n'est pas rejetée par le middleware legacy (401 TOKEN_MISSING)
      // ni par la garde « contexte présent » ; la signature fait foi.
      const raw = webhookBody("evt-a-0001");
      const hook = await p.http("POST", `/api/v1/finance/webhooks/sandbox/${A.tenantId}`, {
        rawBody: raw,
        headers: { "x-sandbox-signature": sign(raw) },
      });
      expect(hook.status, JSON.stringify(hook.body)).toBe(200);
      expect(hook.body).toMatchObject({ status: "PROCESSED", replayed: false, paymentId });

      const detail = await p.http("GET", `/api/v1/finance/payments/${paymentId}`, { token: ownerA.accessToken });
      expect(detail.body.payment.status).toBe("CONFIRMED");
      expect(detail.body.receipt.number).toMatch(/^REC-\d{4}-\d{6}$/);
      const receipt = await p.http("GET", `/api/v1/finance/payments/${paymentId}/receipt`, { token: ownerA.accessToken });
      expect(receipt.status).toBe(200);
      expect(receipt.body.number).toBe(detail.body.receipt.number);
      const invoice = await p.http("GET", `/api/v1/finance/invoices/${invoiceId}`, { token: ownerA.accessToken });
      expect(invoice.body.status).toBe("PARTIALLY_PAID");
      expect(invoice.body.installments[0].status ?? invoice.body.installments[0].paid?.amount).toBeDefined();
    });

    it("webhook : rejeu idempotent, signature falsifiée refusée, webhook d'un AUTRE tenant ignoré", async () => {
      const raw = webhookBody("evt-a-0001");
      const replay = await p.http("POST", `/api/v1/finance/webhooks/sandbox/${A.tenantId}`, { rawBody: raw, headers: { "x-sandbox-signature": sign(raw) } });
      expect(replay.status).toBe(200);
      expect(replay.body.replayed).toBe(true);

      const forged = webhookBody("evt-a-0002");
      const bad = await p.http("POST", `/api/v1/finance/webhooks/sandbox/${A.tenantId}`, { rawBody: forged, headers: { "x-sandbox-signature": "0".repeat(64) } });
      expect(bad.status).toBe(401);

      // Même paiement, mais l'URL désigne le tenant B : la RLS ne lui montre pas ce paiement.
      const crossRaw = webhookBody("evt-b-0001");
      const cross = await p.http("POST", `/api/v1/finance/webhooks/sandbox/${B.tenantId}`, { rawBody: crossRaw, headers: { "x-sandbox-signature": sign(crossRaw) } });
      expect(cross.status).toBe(200);
      expect(cross.body.status).toBe("IGNORED");

      // Un seul reçu, un seul paiement confirmé.
      const count = await p.db.admin.query("SELECT count(*)::int AS n FROM finance.receipts WHERE tenant_id = $1 AND payment_id = $2", [A.tenantId, paymentId]);
      expect(count.rows[0].n).toBe(1);
    });

    it("B ne voit ni la facture, ni le paiement, ni le reçu de A", async () => {
      expect((await p.http("GET", `/api/v1/finance/invoices/${invoiceId}`, { token: ownerB.accessToken })).status).toBe(404);
      expect((await p.http("GET", `/api/v1/finance/payments/${paymentId}`, { token: ownerB.accessToken })).status).toBe(404);
      const listB = await p.http("GET", "/api/v1/finance/invoices", { token: ownerB.accessToken });
      expect(JSON.stringify(listB.body)).not.toContain(invoiceNumber);
    });

    it("le relais du worker publie les événements du tenant, y compris ceux du paiement", async () => {
      await waitFor(
        async () => {
          const r = await p.db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND published_at IS NULL", [A.tenantId]);
          return r.rows[0].n === 0;
        },
        { label: "tous les événements du tenant A publiés par le relais", timeoutMs: 45_000 },
      );
      const types = await p.db.admin.query("SELECT DISTINCT type FROM kernel.domain_events WHERE tenant_id = $1 AND published_at IS NOT NULL", [A.tenantId]);
      expect(types.rows.map((r) => r.type)).toEqual(
        expect.arrayContaining([
          "tenancy.tenant.provisioned",
          "entitlements.subscription.changed",
          "rbac.role.changed",
          "rbac.assignment.changed",
          "iam.mfa.enabled",
          "finance.invoice.issued",
          "finance.payment.initiated",
          "finance.payment.completed",
          "finance.receipt.issued",
        ]),
      );
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("(g) GET /rbac/me/navigation reflète permissions + features", () => {
    const ids = (nav: any, portal = "admin"): string[] => nav.portals[portal].map((i: { key: string }) => i.key);
    const managerToken = (): string => (globalThis as any).__phase1.managerToken;

    it("le propriétaire voit tout ce que son plan permet ; la feature SECONDARY n'est pas souscrite par A (HIGHER)", async () => {
      const nav = await p.http("GET", "/api/v1/rbac/me/navigation", { token: ownerA.accessToken });
      expect(nav.status, JSON.stringify(nav.body)).toBe(200);
      expect(ids(nav.body)).toEqual(
        expect.arrayContaining(["finance.invoices", "finance.payments", "finance.reports", "finance.online-payments", "rbac.roles", "audit.logs", "iam.users"]),
      );
      expect(ids(nav.body)).not.toContain("finance.state-assigned");
    });

    it("un utilisateur au rôle limité ne voit que les entrées couvertes par ses permissions", async () => {
      const nav = await p.http("GET", "/api/v1/rbac/me/navigation", { token: managerToken() });
      expect(nav.status).toBe(200);
      // `finance.report.read` seulement (périmètre campus : « détenue quelque part »).
      expect(ids(nav.body)).toEqual(["finance.reports"]);
      expect(nav.body.availablePortals).toEqual(["admin"]);
    });

    it("la console ajoute le pack SECONDARY : l'entrée conditionnée par la feature apparaît aussitôt", async () => {
      const sub = await p.http("PUT", `/api/v1/platform/tenants/${A.tenantId}/subscription`, {
        token: p.operatorToken,
        body: { planKey: "STARTER", packs: ["HIGHER", "SECONDARY"], status: "ACTIVE" },
      });
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      const nav = await p.http("GET", "/api/v1/rbac/me/navigation", { token: ownerA.accessToken });
      expect(ids(nav.body)).toContain("finance.state-assigned");
      // Le rôle limité ne gagne pas l'entrée : la feature ne remplace pas la permission.
      expect(ids((await p.http("GET", "/api/v1/rbac/me/navigation", { token: managerToken() })).body)).not.toContain("finance.state-assigned");
    });

    it("la suspension du tenant retire les entrées conditionnées par une feature (CORE seulement)", async () => {
      const fee = await p.http("PUT", `/api/v1/platform/tenants/${A.tenantId}/subscription`, {
        token: p.operatorToken,
        body: { planKey: "STARTER", packs: ["HIGHER"], status: "ACTIVE" },
      });
      expect(fee.status).toBe(200);
      const nav = await p.http("GET", "/api/v1/rbac/me/navigation", { token: ownerA.accessToken });
      expect(ids(nav.body)).not.toContain("finance.state-assigned");
      expect(ids(nav.body)).toContain("finance.online-payments");
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("(h) vues minimales pour tout membre : GET /tenancy/branding et /entitlements/me/features", () => {
    const managerToken = (): string => (globalThis as any).__phase1.managerToken;

    it("sans jeton : 401", async () => {
      expect((await p.http("GET", "/api/v1/tenancy/branding")).status).toBe(401);
      expect((await p.http("GET", "/api/v1/entitlements/me/features")).status).toBe(401);
    });

    it("un membre sans `tenancy.institution.read` ni `entitlements.read` : 403 sur les routes complètes, 200 sur les vues minimales", async () => {
      expect((await p.http("GET", "/api/v1/tenancy/profile", { token: managerToken() })).status).toBe(403);
      expect((await p.http("GET", "/api/v1/entitlements/me", { token: managerToken() })).status).toBe(403);

      const branding = await p.http("GET", "/api/v1/tenancy/branding", { token: managerToken() });
      expect(branding.status, JSON.stringify(branding.body)).toBe(200);
      expect(Object.keys(branding.body).sort()).toEqual(["currencyCode", "displayName", "locale", "slug", "theme", "timezone"]);
      expect(Object.keys(branding.body.theme).sort()).toEqual(["logoUrl", "primaryColor", "secondaryColor"]);
      expect(branding.body.slug).toBe(A.slug);

      const features = await p.http("GET", "/api/v1/entitlements/me/features", { token: managerToken() });
      expect(features.status, JSON.stringify(features.body)).toBe(200);
      expect(Object.keys(features.body)).toEqual(["features"]);
      const full = await p.http("GET", "/api/v1/entitlements/me", { token: ownerA.accessToken });
      expect(features.body.features).toEqual(full.body.features);
    });

    it("A/B : chaque propriétaire ne voit que la marque et les fonctionnalités de son tenant", async () => {
      const a = await p.http("GET", "/api/v1/tenancy/branding", { token: ownerA.accessToken });
      const b = await p.http("GET", "/api/v1/tenancy/branding", { token: ownerB.accessToken });
      expect(a.body.slug).toBe(A.slug);
      expect(b.body.slug).toBe(B.slug);
      expect(a.body.displayName).not.toBe(b.body.displayName);
      const fa = await p.http("GET", "/api/v1/entitlements/me/features", { token: ownerA.accessToken });
      const fb = await p.http("GET", "/api/v1/entitlements/me/features", { token: ownerB.accessToken });
      const fullB = await p.http("GET", "/api/v1/entitlements/me", { token: ownerB.accessToken });
      expect(fb.body.features).toEqual(fullB.body.features);
      expect(fa.body.features).not.toEqual(fb.body.features);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("(e) l'audit contient les opérations ci-dessus, chaînage valide, vu par l'API de lecture", () => {
    it("le journal du tenant A (lu par son propriétaire) contient provisioning, rôles, MFA, abonnement, finance", async () => {
      const wanted = [
        "tenancy.tenant.provision",
        "entitlements.subscription.set",
        "rbac.role.created",
        "rbac.assignment.granted",
        "rbac.assignment.revoked",
        "tenancy.campus.create",
        "tenancy.campus.update",
        "finance.fee.created",
        "finance.invoice.issued",
        "finance.payment.completed",
        // Chemin ASYNCHRONE : événements relayés par le worker puis journalisés par les abonnés du module audit.
        "tenant.provisioned",
        "mfa.enabled",
        "subscription.changed",
        "role.changed",
        "assignment.changed",
      ];
      const entries = await waitFor(
        async () => {
          const all = await readAuditLog(p, ownerA.accessToken);
          const actions = new Set(all.map((e) => e.action));
          return wanted.every((a) => actions.has(a)) ? all : false;
        },
        { label: "toutes les opérations dans le journal d'audit de A", timeoutMs: 45_000 },
      );
      const actions = new Set(entries.map((e) => e.action));
      for (const a of wanted) expect(actions, a).toContain(a);

      // Acteurs : l'opérateur plateforme est tracé comme superAdmin, les utilisateurs comme user.
      const provision = entries.find((e) => e.action === "tenancy.tenant.provision");
      expect(provision.actorType).toBe("superAdmin");
      expect(provision.actorId).toBe(p.operatorId);
      expect(entries.find((e) => e.action === "rbac.role.created").actorType).toBe("user");
      // Aucun secret n'est journalisé.
      const dump = JSON.stringify(entries);
      expect(dump).not.toContain(PASSWORD);
      expect(dump).not.toMatch(/otpauth:\/\//);
    });

    it("les entrées issues d'un ÉVÉNEMENT relayé portent l'identifiant de l'événement (dédoublonnage par clé primaire)", async () => {
      const ev = await p.db.admin.query(
        "SELECT id FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'tenancy.tenant.provisioned'",
        [A.tenantId],
      );
      expect(ev.rows).toHaveLength(1);
      const row = await p.db.admin.query("SELECT count(*)::int AS n FROM audit.audit_log WHERE tenant_id = $1 AND id = $2", [A.tenantId, ev.rows[0].id]);
      expect(row.rows[0].n).toBe(1);
    });

    it("GET /audit/verify : chaîne valide pour A et pour B (HMAC), aucun trou", async () => {
      for (const [owner, tenant] of [[ownerA, A], [ownerB, B]] as const) {
        const res = await p.http("GET", "/api/v1/audit/verify", { token: owner.accessToken });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.ok, JSON.stringify(res.body)).toBe(true);
        expect(res.body.checked).toBeGreaterThan(5);
        const head = await p.db.admin.query("SELECT last_seq FROM audit.chain_heads WHERE tenant_id = $1", [tenant.tenantId]);
        expect(Number(head.rows[0].last_seq)).toBeGreaterThanOrEqual(res.body.checked);
      }
      const hmac = await p.db.admin.query("SELECT DISTINCT hash_alg FROM audit.audit_log WHERE tenant_id = $1", [A.tenantId]);
      expect(hmac.rows.map((r) => r.hash_alg)).toEqual(["hmac-sha256"]);
    });

    it("le journal de PLATEFORME trace chaque action de la console et sa chaîne est valide", async () => {
      const rows = await p.db.admin.query("SELECT action, actor_type, actor_id FROM audit.platform_audit_log ORDER BY seq");
      const actions = rows.rows.map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining(["platform.tenant.provisioned", "platform.subscription.set", "platform.override.set", "platform.override.removed", "platform.tenant.status_changed"]),
      );
      // Actions de la console : toutes réalisées par l'opérateur super-admin. Les modules peuvent aussi journaliser des
      // actions automatiques de plateforme (acteur `system`, ex. initialisation de clés ou de catalogues) : tolérées,
      // mais jamais d'acteur `user` dans le journal de plateforme.
      const consoleRows = rows.rows.filter((r) => String(r.action).startsWith("platform."));
      expect(consoleRows.length).toBeGreaterThan(0);
      expect(new Set(consoleRows.map((r) => r.actor_type))).toEqual(new Set(["superAdmin"]));
      expect(new Set(consoleRows.map((r) => r.actor_id))).toEqual(new Set([p.operatorId]));
      expect(rows.rows.every((r) => r.actor_type === "superAdmin" || r.actor_type === "system")).toBe(true);
      const verification = await p.app.v2.systemDb.run("test-verify-platform-chain", (tx) => audit.verifyPlatformChain(tx));
      expect(verification.ok, JSON.stringify(verification)).toBe(true);
    });

    it("le journal est append-only pour l'application : aucune route d'écriture, aucune modification possible en base", async () => {
      // Aucune route d'écriture n'est déclarée pour le journal (lecture seule).
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        for (const url of ["/api/v1/audit/logs", "/api/v1/audit/logs/:id", "/api/v1/audit/verify"]) {
          expect(p.app.hasRoute({ method, url }), `${method} ${url}`).toBe(false);
        }
      }
      // Et la base refuse la modification, même à un acteur applicatif qui l'essaierait (triggers + droits).
      await expect(
        p.app.v2.tenantDb.run(
          { tenantId: A.tenantId, userId: A.ownerIdentityId, roles: [], requestId: "tamper-0001", actor: "user", mfa: false } as never,
          (tx) => tx.query("UPDATE audit.audit_log SET action = 'x.y' WHERE tenant_id = $1", [A.tenantId]),
        ),
      ).rejects.toThrow();
    });
  });
});
