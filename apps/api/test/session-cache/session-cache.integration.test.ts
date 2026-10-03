/**
 * Cache du verdict de session : TESTS DE SÉCURITÉ (Postgres + Redis éphémères).
 *
 *   cd apps/api && node ../worker/scripts/with-infra.mjs test/session-cache
 *
 * Deux « instances d'API » simulées (service IAM + cache local + connexion Redis chacune) partagent la même base et le
 * même Redis (à travers un proxy TCP coupable). Pour CHAQUE cause de changement de verdict : les deux instances mettent
 * le verdict en cache (second appel = hit, sans SQL), l'instance A fait la modification, puis la requête SUIVANTE —
 * sur A et sur B — doit être refusée, sans attente ni avance de l'horloge (aucune fenêtre de grâce).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, noopLogger, systemClock } from "@ecoledigitale/kernel";
import { configureTenantSync, syncTenantToKernel } from "../../src/platform/tenant-sync";
import { setTenantStatus } from "../../src/modules/tenancy";
import * as identityRepo from "../../src/modules/iam/infrastructure/identity-repo";
import * as sessionRepo from "../../src/modules/iam/infrastructure/session-repo";
import { issueBearerToken } from "../../src/modules/iam/domain/access-token";
import { createHarness, hasDb, meta, TEST_PASSWORD, type Harness } from "../../src/modules/iam/test/helpers";
import { RedisProxy, TEST_REDIS_URL, closeInstance, eventually, makeInstance, openRedis, type Instance } from "./support";

const enabled = hasDb && Boolean(TEST_REDIS_URL);
if (!enabled) console.warn("[session-cache] TEST_DATABASE_URL ou TEST_REDIS_URL absente : tests IGNORÉS (utilisez apps/worker/scripts/with-infra.mjs).");

const NO_CAUSE = "iam.session_cache_unavailable";
const OPERATOR = { id: "9f1b6d52-0c3e-4a3e-8f57-6b3a2f1d0c11", email: "support@plateforme.example" };

describe.skipIf(!enabled)("iam — cache du verdict de session : révocation immédiate, échec fermé", () => {
  let h: Harness;
  let proxy: RedisProxy;
  let A: Instance;
  let B: Instance;
  let T1: string;
  let T2: string;
  let unregister: () => void;
  let seq = 0;
  const prefix = `ed:test:${randomBytes(4).toString("hex")}:sv:`;

  beforeAll(async () => {
    h = await createHarness();
    proxy = new RedisProxy(TEST_REDIS_URL as string);
    await proxy.start();
    A = await makeInstance(h, "A", { prefix, redisUrl: proxy.url, pendingTtlMs: 1500 });
    B = await makeInstance(h, "B", { prefix, redisUrl: proxy.url, pendingTtlMs: 1500 });
    unregister = A.cache.registerAsInvalidator();
    T1 = await h.createTenant("lycee-un", "Lycée Un");
    T2 = await h.createTenant("lycee-deux", "Lycée Deux");
  });

  afterAll(async () => {
    unregister?.();
    await Promise.all([A, B].filter(Boolean).map(closeInstance));
    await proxy?.stop();
    await h?.stop();
  });

  // --- aides --------------------------------------------------------------------------------------------------

  async function newUser(roles: string[] = ["teacher"], tenantId = T1, slug = "lycee-un") {
    const email = `u${++seq}-${randomBytes(3).toString("hex")}@exemple.ci`;
    const m = await h.member(tenantId, email, roles);
    const out = await h.loginOk(email, { tenantSlug: slug, ip: `203.0.113.${(seq % 200) + 1}` });
    return { email, ...m, out, token: out.session.accessToken, sessionId: out.session.sessionId };
  }

  async function principalOf(inst: Instance, token: string) {
    const r = await inst.iam.authenticate(token);
    if (!r.ok) throw r.error;
    return r.value.principal;
  }

  /** Les DEUX instances mettent le verdict en cache : le second appel est un hit. */
  async function prime(token: string): Promise<void> {
    for (const inst of [A, B]) {
      expect((await inst.iam.authenticate(token)).ok).toBe(true);
      const before = inst.cache.counters.hits;
      expect((await inst.iam.authenticate(token)).ok).toBe(true);
      expect(inst.cache.counters.hits, `${inst.name} doit servir le second appel depuis le cache`).toBe(before + 1);
    }
  }

  /** Requête SUIVANTE : refusée par B (autre instance) ET par A, sans aucune attente. */
  async function expectRefusedNow(token: string): Promise<void> {
    const rb = await B.iam.authenticate(token);
    expect(rb.ok, "instance B (autre instance) doit refuser immédiatement").toBe(false);
    const ra = await A.iam.authenticate(token);
    expect(ra.ok, "instance A doit refuser immédiatement").toBe(false);
  }

  // --- causes de changement de verdict ------------------------------------------------------------------------

  describe("chaque cause refuse à la requête SUIVANTE, depuis une AUTRE instance", () => {
    it("fonctionne à blanc : deuxième appel servi par le cache, sans transaction SQL", async () => {
      const u = await newUser();
      await prime(u.token);
      const before = { a: A.cache.counters.hits, b: B.cache.counters.hits };
      for (let i = 0; i < 5; i++) expect((await B.iam.authenticate(u.token)).ok).toBe(true);
      expect(B.cache.counters.hits).toBe(before.b + 5);
      expect(A.cache.counters.hits).toBe(before.a);
    });

    it("révocation d'une session par son propriétaire (revokeSession)", async () => {
      const u = await newUser();
      const second = await h.loginOk(u.email, { tenantSlug: "lycee-un" });
      await prime(u.token);
      await prime(second.session.accessToken);
      const p = await principalOf(A, u.token);
      const r = await A.iam.revokeSession(p, second.session.sessionId, meta());
      expect(r.ok).toBe(true);
      await expectRefusedNow(second.session.accessToken);
      // l'autre session de la même personne n'est pas touchée
      expect((await B.iam.authenticate(u.token)).ok).toBe(true);
    });

    it("déconnexion (logout)", async () => {
      const u = await newUser();
      await prime(u.token);
      await A.iam.logout(await principalOf(A, u.token), meta());
      await expectRefusedNow(u.token);
    });

    it("déconnexion par refresh token (jeton d'accès expiré)", async () => {
      const u = await newUser();
      await prime(u.token);
      await A.iam.logoutByRefreshToken(u.out.session.refreshToken as string, meta());
      await expectRefusedNow(u.token);
    });

    it("déconnexion de tous les appareils (logout-all) : époque de l'identité", async () => {
      const u = await newUser();
      const second = await h.loginOk(u.email, { tenantSlug: "lycee-un" });
      await prime(u.token);
      await prime(second.session.accessToken);
      const r = await B.iam.logoutAll(await principalOf(B, u.token), meta());
      expect(r.revoked).toBeGreaterThanOrEqual(2);
      await expectRefusedNow(u.token);
      await expectRefusedNow(second.session.accessToken);
    });

    it("révocation par un administrateur (adminRevokeMemberSessions)", async () => {
      const admin = await newUser(["secretary"]);
      const victim = await newUser(["teacher"]);
      await prime(victim.token);
      const r = await A.iam.adminRevokeMemberSessions(await principalOf(A, admin.token), victim.membershipId, meta());
      expect(r.ok).toBe(true);
      await expectRefusedNow(victim.token);
      expect((await B.iam.authenticate(admin.token)).ok).toBe(true);
    });

    it("accès suspendu puis révoqué (statut du membership)", async () => {
      const admin = await newUser(["secretary"]);
      const victim = await newUser(["teacher"]);
      await prime(victim.token);
      const upd = await A.iam.updateMember(await principalOf(A, admin.token), victim.membershipId, { status: "suspended" }, meta());
      expect(upd.ok).toBe(true);
      await expectRefusedNow(victim.token);

      const victim2 = await newUser(["teacher"]);
      await prime(victim2.token);
      const upd2 = await B.iam.updateMember(await principalOf(B, admin.token), victim2.membershipId, { status: "revoked" }, meta());
      expect(upd2.ok).toBe(true);
      await expectRefusedNow(victim2.token);
    });

    it("changement de rôles (RBAC des rôles de l'accès) : rôle actif retiré -> refus ; rôle ajouté -> verdict frais", async () => {
      const admin = await newUser(["secretary"]);
      const victim = await newUser(["teacher", "parent"]);
      await prime(victim.token);
      // Ajout d'un rôle : la session reste valide, mais le verdict en cache ne doit PAS être servi périmé.
      const add = await A.iam.updateMember(await principalOf(A, admin.token), victim.membershipId, { roles: ["teacher", "parent", "librarian"] }, meta());
      expect(add.ok).toBe(true);
      const seen = await B.iam.authenticate(victim.token);
      expect(seen.ok).toBe(true);
      if (seen.ok) expect(seen.value.principal.availableRoles).toContain("librarian");
      // Retrait du rôle actif : refus immédiat.
      const drop = await A.iam.updateMember(await principalOf(A, admin.token), victim.membershipId, { roles: ["parent"] }, meta());
      expect(drop.ok).toBe(true);
      await expectRefusedNow(victim.token);
    });

    it("changement de mot de passe (changePassword) : époque + révocation", async () => {
      const u = await newUser();
      await prime(u.token);
      const r = await A.iam.changePassword(await principalOf(A, u.token), { currentPassword: TEST_PASSWORD, newPassword: "Nouvelle-Phrase-De-Passe-77", meta: meta() });
      expect(r.ok).toBe(true);
      await expectRefusedNow(u.token);
      // la session neuve émise par le changement est, elle, valide
      if (r.ok) expect((await B.iam.authenticate(r.value.session.accessToken)).ok).toBe(true);
    });

    it("réinitialisation du mot de passe par lien (reset) : époque seule, sans session révoquée une à une", async () => {
      const u = await newUser();
      await prime(u.token);
      h.notifier.resets.length = 0;
      await A.iam.forgotPassword({ email: u.email, meta: meta({ ip: "198.51.100.77" }) });
      await A.iam.drainBackground();
      const mail = h.notifier.resets.find((x) => x.email === u.email);
      expect(mail).toBeTruthy();
      const done = await A.iam.resetPassword({ token: (mail as { token: string }).token, newPassword: "Reinitialise-Phrase-4242", meta: meta() });
      expect(done.ok).toBe(true);
      await expectRefusedNow(u.token);
    });

    it("désactivation de l'identité (statut) et activation/désactivation de la MFA", async () => {
      const u = await newUser();
      await prime(u.token);
      const ctx = createRequestContext({ tenantId: T1, actor: "system" });
      await h.tenantDb.run(ctx, (tx) => identityRepo.setIdentityStatus(tx, u.identityId, "disabled", new Date()));
      await expectRefusedNow(u.token);

      const v = await newUser();
      await prime(v.token);
      await h.tenantDb.run(ctx, (tx) => identityRepo.enableMfa(tx, v.identityId, "secret-chiffre-de-test", 1, new Date()));
      for (const inst of [A, B]) {
        const found = await inst.cache.lookup(T1, v.identityId, v.sessionId);
        expect(found.kind, `${inst.name} : l'activation de la MFA invalide le verdict`).not.toBe("hit");
      }
      await prime(v.token);
      await h.tenantDb.run(ctx, (tx) => identityRepo.disableMfa(tx, v.identityId, new Date()));
      for (const inst of [A, B]) {
        const found = await inst.cache.lookup(T1, v.identityId, v.sessionId);
        expect(found.kind, `${inst.name} : la désactivation de la MFA invalide le verdict`).not.toBe("hit");
      }
    });

    it("réutilisation d'un refresh token : toute la session est révoquée", async () => {
      const u = await newUser();
      await prime(u.token);
      const stolen = u.out.session.refreshToken as string;
      const legit = await A.iam.refresh({ refreshToken: stolen, meta: meta() });
      expect(legit.ok).toBe(true);
      // La rotation seule ne change pas le verdict : le jeton d'accès reste valide.
      expect((await B.iam.authenticate(u.token)).ok).toBe(true);
      const replay = await A.iam.refresh({ refreshToken: stolen, meta: meta() });
      expect(replay.ok).toBe(false);
      await expectRefusedNow(u.token);
      if (legit.ok) await expectRefusedNow(legit.value.session.accessToken);
    });

    it("changement de rôle actif (switchRole) : l'ancienne session est révoquée, la neuve est valide", async () => {
      const u = await newUser(["teacher", "parent"]);
      await prime(u.token);
      const sw = await A.iam.switchRole(await principalOf(A, u.token), { activeRole: "parent", meta: meta() });
      expect(sw.ok).toBe(true);
      await expectRefusedNow(u.token);
      if (sw.ok && sw.value.status === "authenticated") expect((await B.iam.authenticate(sw.value.session.accessToken)).ok).toBe(true);
    });

    it("changement d'établissement (switchTenant) : la session d'origine est révoquée", async () => {
      const email = `multi-${randomBytes(3).toString("hex")}@exemple.ci`;
      await h.member(T1, email, ["teacher"]);
      await h.member(T2, email, ["teacher"]);
      const out = await h.loginOk(email, { tenantSlug: "lycee-un" });
      await prime(out.session.accessToken);
      const sw = await A.iam.switchTenant(await principalOf(A, out.session.accessToken), { tenantId: T2, meta: meta() });
      expect(sw.ok && sw.value.status === "authenticated").toBe(true);
      await expectRefusedNow(out.session.accessToken);
    });

    it("suspension puis archivage du TENANT (module tenancy, port du noyau)", async () => {
      const T3 = await h.createTenant(`lycee-trois-${randomBytes(2).toString("hex")}`, "Lycée Trois");
      const a = await newUser(["teacher"], T3, (await h.admin.query("SELECT slug FROM kernel.tenants WHERE id = $1", [T3])).rows[0].slug);
      const b = await newUser(["teacher"], T3, (await h.admin.query("SELECT slug FROM kernel.tenants WHERE id = $1", [T3])).rows[0].slug);
      const other = await newUser(["teacher"], T1, "lycee-un");
      await prime(a.token);
      await prime(b.token);
      await prime(other.token);

      const op = createRequestContext({ tenantId: T3, userId: OPERATOR.id, actor: "superAdmin", roles: [] });
      const suspended = await setTenantStatus({ db: h.tenantDb, clock: systemClock }, op, { status: "suspended", reason: "test" });
      expect(suspended.ok).toBe(true);
      await expectRefusedNow(a.token);
      await expectRefusedNow(b.token);
      // aucun effet sur un autre tenant
      expect((await B.iam.authenticate(other.token)).ok).toBe(true);

      // réactivation : la session redevient valide (un refus n'est jamais mémorisé)
      const back = await setTenantStatus({ db: h.tenantDb, clock: systemClock }, op, { status: "active" });
      expect(back.ok).toBe(true);
      expect((await B.iam.authenticate(a.token)).ok).toBe(true);
      await prime(a.token);
      const archived = await setTenantStatus({ db: h.tenantDb, clock: systemClock }, op, { status: "archived" });
      expect(archived.ok).toBe(true);
      await expectRefusedNow(a.token);
    });

    it("synchronisation legacy -> kernel : tenant désactivé côté legacy", async () => {
      const T5 = await h.createTenant(`lycee-cinq-${randomBytes(2).toString("hex")}`, "Lycée Cinq");
      const slug5 = (await h.admin.query("SELECT slug FROM kernel.tenants WHERE id = $1", [T5])).rows[0].slug as string;
      const u = await newUser(["teacher"], T5, slug5);
      await prime(u.token);
      configureTenantSync({ systemDb: h.systemDb, logger: noopLogger });
      try {
        const out = await syncTenantToKernel(T5, { strict: true, source: { query: async () => ({ rows: [{ id: T5, slug: slug5, name: "Lycée Cinq", is_active: false }] }) } });
        expect(out).toBe("synced");
      } finally {
        configureTenantSync(null);
      }
      await expectRefusedNow(u.token);
    });

    it("impersonation : fin de session par l'utilisateur, suspension de la cible, suspension du tenant", async () => {
      const target = await newUser(["teacher"]);
      const imp = await A.iam.startImpersonation(OPERATOR, { tenantId: T1, identityId: target.identityId, reason: "Ticket #5521 : vérification du bulletin", meta: meta() });
      if (!imp.ok) throw imp.error;
      await prime(imp.value.accessToken);
      await A.iam.logout(await principalOf(B, imp.value.accessToken), meta());
      await expectRefusedNow(imp.value.accessToken);
      // la session propre de la cible n'est pas touchée
      expect((await B.iam.authenticate(target.token)).ok).toBe(true);

      const admin = await newUser(["secretary"]);
      const victim = await newUser(["teacher"]);
      const imp2 = await A.iam.startImpersonation(OPERATOR, { tenantId: T1, identityId: victim.identityId, reason: "Ticket #5522 : vérification du bulletin", meta: meta() });
      if (!imp2.ok) throw imp2.error;
      await prime(imp2.value.accessToken);
      await A.iam.updateMember(await principalOf(A, admin.token), victim.membershipId, { status: "suspended" }, meta());
      await expectRefusedNow(imp2.value.accessToken);

      const T4 = await h.createTenant(`lycee-quatre-${randomBytes(2).toString("hex")}`, "Lycée Quatre");
      const slug4 = (await h.admin.query("SELECT slug FROM kernel.tenants WHERE id = $1", [T4])).rows[0].slug as string;
      const t4user = await newUser(["teacher"], T4, slug4);
      const imp3 = await A.iam.startImpersonation(OPERATOR, { tenantId: T4, identityId: t4user.identityId, reason: "Ticket #5523 : vérification du bulletin", meta: meta() });
      if (!imp3.ok) throw imp3.error;
      await prime(imp3.value.accessToken);
      await setTenantStatus({ db: h.tenantDb, clock: systemClock }, createRequestContext({ tenantId: T4, userId: OPERATOR.id, actor: "superAdmin", roles: [] }), { status: "suspended" });
      await expectRefusedNow(imp3.value.accessToken);
    });

    it("l'invalidation globale (DEL du jeton global) vide tous les caches de toutes les instances", async () => {
      const u = await newUser();
      await prime(u.token);
      await h.admin.query(`UPDATE iam.sessions SET revoked_at = now() WHERE id = $1`, [u.sessionId]); // SQL direct : hors application
      expect((await B.iam.authenticate(u.token)).ok, "SQL direct : verdict encore en cache (limite documentée, <= TTL)").toBe(true);
      await A.cache.invalidateAll();
      await expectRefusedNow(u.token);
    });
  });

  // --- aucune fenêtre de grâce sous charge concurrente --------------------------------------------------------

  describe("course lecteurs/écrivain : aucune réponse positive après la fin de la révocation", () => {
    it("des lecteurs sur B martèlent pendant que A révoque ; toute lecture démarrée APRÈS la révocation est refusée", async () => {
      for (let round = 0; round < 6; round++) {
        const u = await newUser();
        await prime(u.token);
        let revokedAt = 0;
        let stop = false;
        const violations: string[] = [];
        let after = 0;
        const reader = async (inst: Instance): Promise<void> => {
          while (!stop) {
            const startedAfterRevoke = revokedAt !== 0;
            const r = await inst.iam.authenticate(u.token);
            if (startedAfterRevoke) {
              after++;
              if (r.ok) violations.push(`${inst.name} a accepté une session révoquée`);
            }
          }
        };
        const readers = [reader(B), reader(B), reader(A), reader(B)];
        await new Promise((r) => setTimeout(r, 40 + round * 10));
        const rev = await A.iam.revokeSession(await principalOf(A, u.token), u.sessionId, meta());
        expect(rev.ok).toBe(true);
        revokedAt = Date.now();
        await new Promise((r) => setTimeout(r, 120));
        stop = true;
        await Promise.all(readers);
        expect(violations).toEqual([]);
        expect(after).toBeGreaterThan(0);
      }
    });
  });

  // --- isolation entre tenants --------------------------------------------------------------------------------

  describe("pas de fuite inter-tenant", () => {
    it("la clé de cache est (tenant, session) : jamais de verdict servi à un autre tenant, jeton forgé compris", async () => {
      const a = await newUser(["teacher"], T1, "lycee-un");
      const b = await newUser(["teacher"], T2, "lycee-deux");
      await prime(a.token);
      await prime(b.token);

      // lookup avec le tenant B mais la session de A : jamais un hit
      const crossed = await B.cache.lookup(T2, a.identityId, a.sessionId);
      expect(crossed.kind).toBe("miss");
      // jeton SIGNÉ (secret de test) revendiquant le tenant B avec la session de A
      const forged = issueBearerToken(h.config, h.clock, {
        userId: a.identityId,
        tenantId: T2,
        tenantSlug: "lycee-deux",
        roles: ["teacher"],
        activeRole: "teacher",
        sessionId: a.sessionId,
        membershipId: a.membershipId,
        mfa: false,
        amr: ["pwd"],
      });
      expect((await A.iam.authenticate(forged.token)).ok).toBe(false);
      expect((await B.iam.authenticate(forged.token)).ok).toBe(false);
      // et même identité de B + session de A
      const forged2 = issueBearerToken(h.config, h.clock, {
        userId: b.identityId,
        tenantId: T2,
        tenantSlug: "lycee-deux",
        roles: ["teacher"],
        activeRole: "teacher",
        sessionId: a.sessionId,
        membershipId: b.membershipId,
        mfa: false,
        amr: ["pwd"],
      });
      expect((await B.iam.authenticate(forged2.token)).ok).toBe(false);

      // révoquer chez A ne touche pas B, et inversement
      await A.iam.logout(await principalOf(A, a.token), meta());
      await expectRefusedNow(a.token);
      expect((await B.iam.authenticate(b.token)).ok).toBe(true);
      expect(B.cache.counters.hits).toBeGreaterThan(0);
    });
  });

  // --- Redis indisponible, lent, incohérent : échec fermé -----------------------------------------------------

  describe("Redis tué / lent / incohérent : jamais de verdict périmé", () => {
    it("Redis tué : lecture en base (session valide acceptée, session révoquée EN SQL refusée) ; écriture refusée sans effet", async () => {
      const u = await newUser();
      const v = await newUser();
      await prime(u.token);
      await prime(v.token);

      await proxy.sever();
      try {
        const hitsBefore = B.cache.counters.hits;
        // verdict valide : répondu par la base, jamais par le cache
        expect((await B.iam.authenticate(u.token)).ok).toBe(true);
        expect(B.cache.counters.hits).toBe(hitsBefore);
        expect(B.cache.size).toBe(0);
        // révocation faite hors cache (SQL direct) PENDANT la panne : refusée tout de suite
        await h.admin.query(`UPDATE iam.sessions SET revoked_at = now() WHERE id = $1`, [v.sessionId]);
        expect((await B.iam.authenticate(v.token)).ok).toBe(false);
        expect((await A.iam.authenticate(v.token)).ok).toBe(false);

        // un écrivain ne peut pas confirmer l'invalidation : l'opération est ANNULÉE (échec fermé), rien n'est écrit
        const p = await principalOf(A, u.token);
        await expect(A.iam.logout(p, meta())).rejects.toMatchObject({ code: NO_CAUSE });
        const row = await h.admin.query(`SELECT revoked_at FROM iam.sessions WHERE id = $1`, [u.sessionId]);
        expect(row.rows[0].revoked_at).toBeNull();
        expect((await A.iam.authenticate(u.token)).ok).toBe(true);
      } finally {
        await proxy.restore();
      }

      // Redis revenu : reprise sans verdict périmé
      await eventually(async () => {
        const r = await A.cache.lookup(T1, u.identityId, u.sessionId);
        return r.kind !== "bypass";
      });
      await prime(u.token);
      await A.iam.logout(await principalOf(A, u.token), meta());
      await expectRefusedNow(u.token);
    });

    it("Redis redémarre en perdant ses données (FLUSHALL) : aucun verdict en cache n'est resservi", async () => {
      const u = await newUser();
      await prime(u.token);
      const raw = await openRedis(TEST_REDIS_URL as string);
      try {
        await raw.flushall();
      } finally {
        raw.disconnect();
      }
      const hits = B.cache.counters.hits;
      expect((await B.iam.authenticate(u.token)).ok).toBe(true);
      expect(B.cache.counters.hits, "jetons recréés : le verdict en cache ne correspond plus").toBe(hits);
      await prime(u.token);
    });

    it("Redis plus lent que le délai court : repli sur la base (révocation SQL vue), disjoncteur ensuite", async () => {
      const u = await newUser();
      await prime(u.token);
      proxy.setDelay(600);
      try {
        await h.admin.query(`UPDATE iam.sessions SET revoked_at = now() WHERE id = $1`, [u.sessionId]);
        const t0 = Date.now();
        expect((await B.iam.authenticate(u.token)).ok).toBe(false);
        expect(Date.now() - t0).toBeLessThan(2000);
        const bypasses = B.cache.counters.bypasses;
        expect((await B.iam.authenticate(u.token)).ok).toBe(false);
        expect(B.cache.counters.bypasses).toBe(bypasses + 1); // disjoncteur ouvert : pas d'attente de Redis
      } finally {
        proxy.setDelay(0);
      }
      await eventually(async () => (await B.cache.lookup(T1, u.identityId, u.sessionId)).kind !== "bypass");
    });

    it("réponse Redis incohérente : contournement du cache", async () => {
      const { SessionVerdictCache } = await import("../../src/modules/iam");
      const { createIamService } = await import("../../src/modules/iam");
      const { noopLogger } = await import("@ecoledigitale/kernel");
      const bad = new SessionVerdictCache({ redis: { eval: async () => ["x", "y"] }, logger: noopLogger });
      const iam = createIamService({ config: h.config, tenantDb: h.tenantDb, systemDb: h.systemDb, limiter: h.limiter, clock: h.clock, logger: noopLogger, verdictCache: bad });
      const u = await newUser();
      expect((await iam.authenticate(u.token)).ok).toBe(true);
      expect((await iam.authenticate(u.token)).ok).toBe(true);
      expect(bad.counters.hits).toBe(0);
      expect(bad.counters.bypasses).toBeGreaterThan(0);
      await h.admin.query(`UPDATE iam.sessions SET revoked_at = now() WHERE id = $1`, [u.sessionId]);
      expect((await iam.authenticate(u.token)).ok).toBe(false);
    });

    it("écriture annulée (ROLLBACK) : le marqueur est retiré, la session reste valide et le cache reprend", async () => {
      const u = await newUser();
      await prime(u.token);
      const ctx = createRequestContext({ tenantId: T1, userId: u.identityId, actor: "user", roles: ["teacher"] });
      await expect(
        h.tenantDb.run(ctx, async (tx) => {
          await sessionRepo.revokeSession(tx, T1, u.sessionId, "boom", u.identityId, new Date());
          throw new Error("échec métier après la révocation");
        }),
      ).rejects.toThrow("échec métier");
      const row = await h.admin.query(`SELECT revoked_at FROM iam.sessions WHERE id = $1`, [u.sessionId]);
      expect(row.rows[0].revoked_at).toBeNull();
      expect((await B.iam.authenticate(u.token)).ok).toBe(true);
      await prime(u.token); // plus de marqueur résiduel : le cache sert de nouveau
    });

    it("écrivain qui meurt entre `begin` et `end` : le marqueur bloque tout service du cache puis expire seul", async () => {
      const u = await newUser();
      await prime(u.token);
      await A.cache.begin([{ kind: "identity", identityId: u.identityId }]); // jamais de `end` (crash)
      const hits = B.cache.counters.hits;
      for (let i = 0; i < 3; i++) expect((await B.iam.authenticate(u.token)).ok).toBe(true);
      expect(B.cache.counters.hits).toBe(hits); // jamais servi pendant l'écriture « en cours »
      expect((await B.cache.lookup(T1, u.identityId, u.sessionId)).kind).toBe("bypass"); // ni rempli
      await h.admin.query(`UPDATE iam.sessions SET revoked_at = now() WHERE id = $1`, [u.sessionId]);
      expect((await B.iam.authenticate(u.token)).ok).toBe(false); // la base fait foi
      const v = await newUser();
      // le marqueur de u (identité de u) ne gêne pas v ; celui de u expire après pendingTtlMs (1,5 s ici)
      await prime(v.token);
      await eventually(async () => {
        const r = await B.cache.lookup(T1, u.identityId, u.sessionId);
        return r.kind !== "bypass";
      }, 5000, 100);
    });
  });

  // --- durée de vie absolue -----------------------------------------------------------------------------------

  describe("durée de vie locale absolue", () => {
    it("un verdict plus ancien que le TTL n'est jamais resservi (horloge monotone injectée)", async () => {
      let mono = 1_000;
      const C = await makeInstance(h, "C", { prefix, redisUrl: proxy.url, ttlMs: 2000, now: () => mono });
      try {
        const u = await newUser();
        expect((await C.iam.authenticate(u.token)).ok).toBe(true);
        mono += 1_999;
        expect((await C.iam.authenticate(u.token)).ok).toBe(true);
        expect(C.cache.counters.hits).toBe(1);
        mono += 2; // 2001 ms depuis le remplissage
        expect((await C.iam.authenticate(u.token)).ok).toBe(true);
        expect(C.cache.counters.hits, "au-delà du TTL : relecture en base").toBe(1);
        expect(C.cache.counters.misses).toBe(2);
      } finally {
        await closeInstance(C);
      }
    });
  });
});
