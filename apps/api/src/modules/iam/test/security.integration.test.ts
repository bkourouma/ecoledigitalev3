/**
 * Tests de sécurité : jetons forgés, algorithme `none`, énumération de comptes,
 * timing, force brute, secrets jamais stockés en clair.
 */
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { issueBearerToken } from "../domain/access-token";
import { signJwt } from "../domain/tokens";
import { createHarness, describeIntegration, meta, TEST_PASSWORD, type Harness } from "./helpers";

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");

describeIntegration("iam — sécurité (Postgres réel)", () => {
  let h: Harness;
  let A: string;
  let B: string;

  beforeAll(async () => {
    h = await createHarness({ overrides: { failureMinDurationMs: 0 } });
    A = await h.createTenant("lycee-a", "Lycée A");
    B = await h.createTenant("college-b", "Collège B");
  });
  afterAll(async () => h.stop());

  describe("jetons forgés", () => {
    it("tenant modifié dans le payload d'un vrai jeton (signature conservée) → refusé", async () => {
      await h.member(A, "forge1@exemple.ci", ["teacher"]);
      const out = await h.loginOk("forge1@exemple.ci");
      const [hd, , sig] = out.session.accessToken.split(".") as [string, string, string];
      const payload = JSON.parse(Buffer.from(out.session.accessToken.split(".")[1]!, "base64url").toString());
      const forged = `${hd}.${b64({ ...payload, tenantId: B, tenantSlug: "college-b", aud: "college-b" })}.${sig}`;
      const r = await h.iam.authenticate(forged);
      expect(!r.ok && r.error.code).toBe(AuthErrorCodes.tokenInvalid);
    });

    it("algorithme `none` (avec ou sans signature) → refusé, même pour un payload parfaitement valide", async () => {
      await h.member(A, "forge2@exemple.ci", ["teacher"]);
      const out = await h.loginOk("forge2@exemple.ci");
      const payload = Buffer.from(out.session.accessToken.split(".")[1]!, "base64url").toString();
      for (const alg of ["none", "None", "NONE", "nOnE"]) {
        for (const sig of ["", "AAAA"]) {
          const token = `${b64({ alg, typ: "at+jwt" })}.${Buffer.from(payload).toString("base64url")}.${sig}`;
          const r = await h.iam.authenticate(token);
          expect(r.ok).toBe(false);
        }
      }
    });

    it("confusion d'algorithme : HS512 signé avec la bonne clé, ou RS256 → refusé", async () => {
      await h.member(A, "forge3@exemple.ci", ["teacher"]);
      const out = await h.loginOk("forge3@exemple.ci");
      const body = out.session.accessToken.split(".")[1]!;
      for (const [alg, hash] of [["HS512", "sha512"], ["HS384", "sha384"], ["RS256", "sha256"]] as const) {
        const head = b64({ alg, typ: "at+jwt" });
        const sig = createHmac(hash, h.config.keys.bearer).update(`${head}.${body}`).digest("base64url");
        expect((await h.iam.authenticate(`${head}.${body}.${sig}`)).ok).toBe(false);
      }
    });

    it("jeton signé par une AUTRE instance/secret, ou avec la clé d'un autre usage (étape, hachage) → refusé", async () => {
      const m = await h.member(A, "forge4@exemple.ci", ["teacher"]);
      const out = await h.loginOk("forge4@exemple.ci");
      const claims = { ...out.session.claims, jti: randomUUID() };
      expect((await h.iam.authenticate(signJwt(claims as never, Buffer.alloc(32, 9), "at+jwt"))).ok).toBe(false);
      expect((await h.iam.authenticate(signJwt(claims as never, h.config.keys.step, "at+jwt"))).ok).toBe(false);
      expect((await h.iam.authenticate(signJwt(claims as never, h.config.keys.tokenHash, "at+jwt"))).ok).toBe(false);
      expect(m.identityId).toBe(out.user.id);
    });

    it("jeton correctement signé mais session inexistante / d'une autre identité → refusé par la base", async () => {
      const a = await h.member(A, "forge5@exemple.ci", ["teacher"]);
      const other = await h.member(A, "forge5b@exemple.ci", ["teacher"]);
      const otherOut = await h.loginOk("forge5b@exemple.ci");
      const base = { tenantId: A, tenantSlug: "lycee-a", roles: ["teacher"], activeRole: "teacher", membershipId: a.membershipId, mfa: false, amr: ["pwd"] as ["pwd"] };
      const noSession = issueBearerToken(h.config, h.clock, { ...base, userId: a.identityId, sessionId: randomUUID() });
      expect((await h.iam.authenticate(noSession.token)).ok).toBe(false);
      // identité A avec la session de l'identité B
      const swapped = issueBearerToken(h.config, h.clock, { ...base, userId: a.identityId, sessionId: otherOut.session.sessionId });
      expect((await h.iam.authenticate(swapped.token)).ok).toBe(false);
      // élévation de rôle : jeton valide en forme mais rôle absent du membership
      const elevated = issueBearerToken(h.config, h.clock, { ...base, userId: other.identityId, membershipId: other.membershipId, sessionId: otherOut.session.sessionId, roles: ["teacher", "owner"], activeRole: "owner" });
      expect((await h.iam.authenticate(elevated.token)).ok).toBe(false);
    });

    it("jeton de challenge MFA ou d'enrôlement jamais accepté comme jeton d'accès", async () => {
      await h.member(A, "forge6@exemple.ci", ["owner"]);
      const r = await h.iam.login({ email: "forge6@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      if (!r.ok || r.value.status !== "mfa_enrollment_required") throw new Error("enrôlement attendu");
      expect((await h.iam.authenticate(r.value.enrollmentToken)).ok).toBe(false);
    });
  });

  describe("énumération de comptes", () => {
    it("login : réponses strictement identiques pour inconnu / mot de passe faux / compte sans mot de passe", async () => {
      await h.member(A, "existe@exemple.ci", ["teacher"]);
      await h.iam.provisionMember(h.ctx(A), { email: "sans-mdp@exemple.ci", roles: ["parent"], meta: meta() });
      const bodies = [];
      for (const email of ["absent@exemple.ci", "existe@exemple.ci", "sans-mdp@exemple.ci"]) {
        const r = await h.iam.login({ email, password: "Mauvais-Mot-De-Passe-1", meta: meta({ ip: `198.51.100.${bodies.length + 20}` }) });
        expect(r.ok).toBe(false);
        if (!r.ok) bodies.push(JSON.stringify({ code: r.error.code, message: r.error.message, status: r.error.httpStatus, details: r.error.details ?? null }));
      }
      expect(new Set(bodies).size).toBe(1);
    });

    it("le verrouillage s'applique pareil à un e-mail inexistant (il ne révèle pas l'existence du compte)", async () => {
      await h.member(A, "lock-exist@exemple.ci", ["teacher"]);
      const run = async (email: string, ip: string): Promise<string[]> => {
        const seen: string[] = [];
        for (let i = 0; i < 7; i += 1) {
          const r = await h.iam.login({ email, password: "Mauvais-Mot-De-Passe-1", meta: meta({ ip }) });
          seen.push(r.ok ? "ok" : `${r.error.httpStatus}:${r.error.code}`);
        }
        return seen;
      };
      const known = await run("lock-exist@exemple.ci", "198.51.100.40");
      const unknown = await run("lock-inconnu@exemple.ci", "198.51.100.41");
      expect(known).toEqual(unknown);
      expect(known.slice(0, 5)).toEqual(Array(5).fill("401:iam.invalid_credentials"));
      expect(known.slice(5)).toEqual(Array(2).fill("403:iam.too_many_attempts"));
    });

    it("mot de passe oublié : même résultat et même forme pour un compte existant, inconnu, désactivé", async () => {
      await h.member(A, "oubli-enum@exemple.ci", ["teacher"]);
      const dis = await h.member(A, "oubli-off@exemple.ci", ["teacher"]);
      await h.admin.query(`UPDATE iam.identities SET status = 'disabled' WHERE id = $1`, [dis.identityId]);
      const before = h.notifier.resets.length;
      const results = [];
      for (const [i, email] of ["oubli-enum@exemple.ci", "personne@exemple.ci", "oubli-off@exemple.ci"].entries()) {
        results.push(await h.iam.forgotPassword({ email, meta: meta({ ip: `198.51.100.${60 + i}` }) }));
      }
      await h.iam.drainBackground();
      expect(results).toEqual([undefined, undefined, undefined]);
      expect(h.notifier.resets.length - before).toBe(1); // seul le compte actif reçoit un e-mail
    });

    it("invitation : le résultat ne dit pas si l'identité existait déjà ailleurs", async () => {
      await h.member(B, "deja-ailleurs@exemple.ci", ["parent"]);
      const existing = await h.iam.provisionMember(h.ctx(A), { email: "deja-ailleurs@exemple.ci", roles: ["parent"], meta: meta() });
      const fresh = await h.iam.provisionMember(h.ctx(A), { email: "tout-neuf@exemple.ci", roles: ["parent"], meta: meta() });
      expect(existing.ok && fresh.ok).toBe(true);
      if (existing.ok && fresh.ok) expect(Object.keys(existing.value).sort()).toEqual(Object.keys(fresh.value).sort());
    });

    it("injection SQL / caractères de contrôle dans l'e-mail : traité comme un identifiant inconnu", async () => {
      for (const email of ["x'; DROP TABLE iam.identities;--@a.ci", "a@b.ci\u0000", "\" OR 1=1 --"]) {
        const r = await h.iam.login({ email, password: "Mauvais-Mot-De-Passe-1", meta: meta({ ip: "198.51.100.90" }) });
        expect(!r.ok && r.error.code).toBe(AuthErrorCodes.invalidCredentials);
      }
      expect((await h.admin.query(`SELECT count(*)::int AS n FROM iam.identities`)).rows[0].n).toBeGreaterThan(0);
    });
  });

  describe("force brute", () => {
    it("verrouillage progressif par identité+IP : 5 échecs → verrou, même le BON mot de passe est refusé, puis reprise", async () => {
      await h.member(A, "brute@exemple.ci", ["teacher"]);
      const ip = "198.51.100.100";
      for (let i = 0; i < 5; i += 1) await h.iam.login({ email: "brute@exemple.ci", password: "Mauvais-Mot-De-Passe-1", meta: meta({ ip }) });
      const locked = await h.iam.login({ email: "brute@exemple.ci", password: TEST_PASSWORD, meta: meta({ ip }) });
      expect(!locked.ok && locked.error.code).toBe(AuthErrorCodes.tooManyAttempts);
      expect(!locked.ok && locked.error.details?.retryAfterSec).toBeGreaterThan(0);
      // Une autre IP n'est pas verrouillée par l'identité+IP (le plafond par identité est plus haut).
      expect((await h.iam.login({ email: "brute@exemple.ci", password: TEST_PASSWORD, meta: meta({ ip: "198.51.100.101" }) })).ok).toBe(true);
      // Après expiration du verrou : reprise.
      h.clock.advance(61_000);
      expect((await h.iam.login({ email: "brute@exemple.ci", password: TEST_PASSWORD, meta: meta({ ip }) })).ok).toBe(true);
      // Un nouveau cycle d'échecs double la durée du verrou.
      let last;
      for (let i = 0; i < 5; i += 1) last = await h.iam.login({ email: "brute@exemple.ci", password: "Mauvais-Mot-De-Passe-1", meta: meta({ ip }) });
      void last;
      const l2 = await h.iam.login({ email: "brute@exemple.ci", password: "x", meta: meta({ ip }) });
      expect(!l2.ok && l2.error.code).toBe(AuthErrorCodes.tooManyAttempts);
    });

    it("un succès remet les compteurs à zéro ; la limite par IP s'applique à toutes les identités", async () => {
      await h.member(A, "reset-counter@exemple.ci", ["teacher"]);
      const ip = "198.51.100.110";
      for (let r = 0; r < 3; r += 1) {
        for (let i = 0; i < 4; i += 1) await h.iam.login({ email: "reset-counter@exemple.ci", password: "Mauvais-Mot-De-Passe-1", meta: meta({ ip }) });
        expect((await h.iam.login({ email: "reset-counter@exemple.ci", password: TEST_PASSWORD, meta: meta({ ip }) })).ok).toBe(true);
      }
      const g = await createHarness({ overrides: { loginIpLimit: { limit: 5, windowMs: 60_000 } } });
      try {
        let denied = 0;
        for (let i = 0; i < 8; i += 1) {
          const r = await g.iam.login({ email: `u${i}@exemple.ci`, password: "Mauvais-Mot-De-Passe-1", meta: meta({ ip: "198.51.100.120" }) });
          if (!r.ok && r.error.code === AuthErrorCodes.tooManyAttempts) denied += 1;
        }
        expect(denied).toBe(3);
      } finally {
        await g.stop();
      }
    });

    it("les échecs sont publiés dans l'outbox du tenant visé, sans e-mail en clair, avec `locked`", async () => {
      const before = (await h.events(A, "iam.login.failed")).length;
      for (let i = 0; i < 6; i += 1) {
        await h.iam.login({ email: "cible-evt@exemple.ci", password: "Mauvais-Mot-De-Passe-1", tenantSlug: "lycee-a", meta: meta({ ip: "198.51.100.130" }) });
      }
      await h.iam.drainBackground();
      const evts = (await h.events(A, "iam.login.failed")).slice(before);
      expect(evts.length).toBeGreaterThanOrEqual(5);
      expect(JSON.stringify(evts)).not.toContain("cible-evt@exemple.ci");
      expect(evts[0]!.payload).toMatchObject({ v: 1, reason: "unknown_identity", locked: false });
      expect(evts.some((e) => e.payload.locked === true)).toBe(true);
      expect(evts[0]!.actor_id).toBeNull();
    });
  });

  describe("secrets jamais en clair en base", () => {
    it("refresh token, jeton de reset, codes de secours, secret TOTP, mot de passe : uniquement des empreintes / enveloppes", async () => {
      await h.member(A, "clair@exemple.ci", ["teacher"]);
      const out = await h.loginOk("clair@exemple.ci");
      await h.iam.forgotPassword({ email: "clair@exemple.ci", meta: meta({ ip: "198.51.100.140" }) });
      await h.iam.drainBackground();
      const reset = h.notifier.resets[h.notifier.resets.length - 1]!.token;
      const p = await h.iam.authenticate(out.session.accessToken);
      if (!p.ok) throw p.error;
      const begin = await h.iam.beginMfaEnrollment({ via: "session", principal: p.value.principal }, { password: TEST_PASSWORD, meta: meta() });
      if (!begin.ok) throw begin.error;
      const dump = JSON.stringify([
        (await h.admin.query(`SELECT * FROM iam.refresh_tokens`)).rows,
        (await h.admin.query(`SELECT * FROM iam.password_reset_tokens`)).rows,
        (await h.admin.query(`SELECT * FROM iam.identities`)).rows,
        (await h.admin.query(`SELECT * FROM kernel.domain_events`)).rows,
      ]);
      for (const secret of [out.session.refreshToken!.split(".")[2]!, reset, begin.value.secret, TEST_PASSWORD]) expect(dump).not.toContain(secret);
    });
  });
});

describeIntegration("iam — timing (mesures réelles)", () => {
  let h: Harness;
  let A: string;

  beforeAll(async () => {
    // Plancher réel de 150 ms (sleep réel) ; scrypt minimal : le travail est très inférieur au plancher.
    h = await createHarness({ overrides: { failureMinDurationMs: 150 } });
    (h.iam.deps as { sleep: (ms: number) => Promise<void> }).sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    A = await h.createTenant("lycee-a", "Lycée A");
    await h.member(A, "timing@exemple.ci", ["teacher"]);
  });
  afterAll(async () => h.stop());

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  async function time(email: string, ip: string): Promise<number> {
    const t0 = process.hrtime.bigint();
    await h.iam.login({ email, password: "Mauvais-Mot-De-Passe-1", meta: meta({ ip }) });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  }

  it("un échec prend le même temps (plancher) que le compte existe ou non", async () => {
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      known.push(await time("timing@exemple.ci", `198.51.100.${150 + i}`));
      unknown.push(await time(`fantome${i}@exemple.ci`, `198.51.100.${170 + i}`));
    }
    expect(Math.min(...known)).toBeGreaterThanOrEqual(145);
    expect(Math.min(...unknown)).toBeGreaterThanOrEqual(145);
    expect(Math.abs(median(known) - median(unknown))).toBeLessThan(40);
  });

  it("mot de passe oublié : durée alignée sur le plancher pour un compte existant ou non", async () => {
    const t = async (email: string, ip: string): Promise<number> => {
      const t0 = process.hrtime.bigint();
      await h.iam.forgotPassword({ email, meta: meta({ ip }) });
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const a = [await t("timing@exemple.ci", "198.51.100.190"), await t("timing@exemple.ci", "198.51.100.191")];
    const b = [await t("rien@exemple.ci", "198.51.100.192"), await t("rien2@exemple.ci", "198.51.100.193")];
    expect(Math.min(...a, ...b)).toBeGreaterThanOrEqual(145);
    expect(Math.abs(median(a) - median(b))).toBeLessThan(40);
  });
});
