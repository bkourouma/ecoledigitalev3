/**
 * Mots de passe (changement, oubli, réinitialisation), MFA TOTP (enrôlement, challenge,
 * rejeu, codes de secours, désactivation, réinitialisation admin) et impersonation —
 * contre un Postgres réel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { base32Decode, totp } from "../domain/totp";
import { createHarness, describeIntegration, meta, TEST_PASSWORD, type Harness } from "./helpers";
import type { AuthenticatedPrincipal } from "../application/ports";

describeIntegration("iam — mots de passe, MFA, impersonation (Postgres réel)", () => {
  let h: Harness;
  let A: string;
  let B: string;

  beforeAll(async () => {
    h = await createHarness();
    A = await h.createTenant("lycee-a", "Lycée A");
    B = await h.createTenant("college-b", "Collège B");
  });
  afterAll(async () => h.stop());

  const principalOf = async (token: string): Promise<AuthenticatedPrincipal> => {
    const r = await h.iam.authenticate(token);
    if (!r.ok) throw r.error;
    return r.value.principal;
  };
  const codeNow = (secretB32: string, offsetMs = 0): string => totp(base32Decode(secretB32), h.clock.now().getTime() + offsetMs);

  /** Enrôle le TOTP d'un utilisateur déjà connecté ; renvoie secret et codes de secours. */
  async function enroll(email: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    const out = await h.loginOk(email);
    const p = await principalOf(out.session.accessToken);
    const begin = await h.iam.beginMfaEnrollment({ via: "session", principal: p }, { password: TEST_PASSWORD, meta: meta() });
    if (!begin.ok) throw begin.error;
    const done = await h.iam.confirmMfaEnrollment({ via: "session", principal: p }, { code: codeNow(begin.value.secret), meta: meta() });
    if (!done.ok) throw done.error;
    return { secret: begin.value.secret, recoveryCodes: done.value.recoveryCodes };
  }

  describe("changement de mot de passe", () => {
    it("exige l'ancien mot de passe, applique la politique, coupe les autres sessions et garde l'appelant connecté", async () => {
      await h.member(A, "change@exemple.ci", ["teacher"]);
      const s1 = await h.loginOk("change@exemple.ci");
      const s2 = await h.loginOk("change@exemple.ci");
      const p = await principalOf(s1.session.accessToken);

      const wrong = await h.iam.changePassword(p, { currentPassword: "faux", newPassword: "Nouveau-Mot-De-Passe-77", meta: meta() });
      expect(!wrong.ok && wrong.error.code).toBe(AuthErrorCodes.invalidCredentials);
      const weak = await h.iam.changePassword(p, { currentPassword: TEST_PASSWORD, newPassword: "password123", meta: meta() });
      expect(!weak.ok && weak.error.code).toBe(AuthErrorCodes.passwordPolicy);
      const same = await h.iam.changePassword(p, { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD, meta: meta() });
      expect(same.ok).toBe(false);
      const email = await h.iam.changePassword(p, { currentPassword: TEST_PASSWORD, newPassword: "change@exemple.ci", meta: meta() });
      expect(email.ok).toBe(false);

      const ok = await h.iam.changePassword(p, { currentPassword: TEST_PASSWORD, newPassword: "Nouveau-Mot-De-Passe-77", meta: meta() });
      if (!ok.ok) throw ok.error;
      expect((await h.iam.authenticate(s1.session.accessToken)).ok).toBe(false);
      expect((await h.iam.authenticate(s2.session.accessToken)).ok).toBe(false);
      expect((await h.iam.authenticate(ok.value.session.accessToken)).ok).toBe(true);
      expect((await h.iam.login({ email: "change@exemple.ci", password: TEST_PASSWORD, meta: meta() })).ok).toBe(false);
      await h.loginOk("change@exemple.ci", { password: "Nouveau-Mot-De-Passe-77" });
      expect((await h.events(A, "iam.password.changed")).length).toBeGreaterThanOrEqual(1);
    });

    it("verrouille progressivement les essais répétés du mot de passe actuel", async () => {
      await h.member(A, "brute-change@exemple.ci", ["teacher"]);
      const p = await principalOf((await h.loginOk("brute-change@exemple.ci")).session.accessToken);
      let last;
      for (let i = 0; i < 6; i += 1) last = await h.iam.changePassword(p, { currentPassword: "faux", newPassword: "Nouveau-Mot-De-Passe-77", meta: meta() });
      expect(!last!.ok && last!.error.httpStatus).toBe(403);
      expect(!last!.ok && last!.error.code).toBe(AuthErrorCodes.tooManyAttempts);
    });
  });

  describe("mot de passe oublié / réinitialisation", () => {
    it("réponse identique que le compte existe ou non ; jeton à usage unique, haché en base, expirant", async () => {
      await h.member(A, "oubli@exemple.ci", ["teacher"]);
      const s = await h.loginOk("oubli@exemple.ci");
      await h.iam.forgotPassword({ email: "oubli@exemple.ci", meta: meta() });
      await h.iam.forgotPassword({ email: "fantome@exemple.ci", meta: meta({ ip: "198.51.100.5" }) });
      await h.iam.drainBackground();
      expect(h.notifier.resets.map((r) => r.email)).toEqual(["oubli@exemple.ci"]);
      const mail = h.notifier.resets[h.notifier.resets.length - 1]!;

      const stored = await h.admin.query(`SELECT token_hash FROM iam.password_reset_tokens`);
      expect(JSON.stringify(stored.rows)).not.toContain(mail.token);

      const weak = await h.iam.resetPassword({ token: mail.token, newPassword: "azertyuiop123", meta: meta() });
      expect(!weak.ok && weak.error.code).toBe(AuthErrorCodes.passwordPolicy); // le jeton n'est PAS brûlé
      const ok = await h.iam.resetPassword({ token: mail.token, newPassword: "Reinitialise-Phrase-42", meta: meta() });
      expect(ok.ok).toBe(true);
      const again = await h.iam.resetPassword({ token: mail.token, newPassword: "Autre-Phrase-De-Passe-43", meta: meta() });
      expect(!again.ok && again.error.code).toBe(AuthErrorCodes.resetTokenInvalid);

      expect((await h.iam.authenticate(s.session.accessToken)).ok).toBe(false); // sessions mortes
      await h.loginOk("oubli@exemple.ci", { password: "Reinitialise-Phrase-42" });
    });

    it("jeton expiré, inventé ou remplacé par une nouvelle demande → refus générique", async () => {
      await h.member(A, "expire-reset@exemple.ci", ["teacher"]);
      await h.iam.forgotPassword({ email: "expire-reset@exemple.ci", meta: meta({ ip: "198.51.100.8" }) });
      await h.iam.drainBackground();
      const first = h.notifier.resets[h.notifier.resets.length - 1]!;
      h.clock.advance(5 * 60_000);
      await h.iam.forgotPassword({ email: "expire-reset@exemple.ci", meta: meta({ ip: "198.51.100.8" }) });
      await h.iam.drainBackground();
      const second = h.notifier.resets[h.notifier.resets.length - 1]!;
      expect(second.token).not.toBe(first.token);
      expect((await h.iam.resetPassword({ token: first.token, newPassword: "Reinitialise-Phrase-42", meta: meta() })).ok).toBe(false);
      expect((await h.iam.resetPassword({ token: "x".repeat(43), newPassword: "Reinitialise-Phrase-42", meta: meta() })).ok).toBe(false);
      h.clock.advance((h.config.resetTtlSec + 1) * 1000);
      expect((await h.iam.resetPassword({ token: second.token, newPassword: "Reinitialise-Phrase-42", meta: meta() })).ok).toBe(false);
    });

    it("deux réinitialisations simultanées avec le même jeton : une seule réussit", async () => {
      await h.member(A, "double-reset@exemple.ci", ["teacher"]);
      await h.iam.forgotPassword({ email: "double-reset@exemple.ci", meta: meta({ ip: "198.51.100.9" }) });
      await h.iam.drainBackground();
      const mail = h.notifier.resets[h.notifier.resets.length - 1]!;
      const [x, y] = await Promise.all([
        h.iam.resetPassword({ token: mail.token, newPassword: "Premiere-Phrase-De-Passe-1", meta: meta() }),
        h.iam.resetPassword({ token: mail.token, newPassword: "Seconde-Phrase-De-Passe-2", meta: meta() }),
      ]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    });

    it("invitation : lien de définition du mot de passe, puis connexion", async () => {
      const p = await h.iam.provisionMember(h.ctx(A), { email: "nouveau@exemple.ci", roles: ["parent"], meta: meta() });
      expect(p.ok).toBe(true);
      await h.iam.drainBackground();
      const inv = h.notifier.invitations.find((i) => i.email === "nouveau@exemple.ci")!;
      expect(inv.tenantName).toBe("Lycée A");
      expect((await h.iam.resetPassword({ token: inv.token, newPassword: "Bienvenue-Dans-Ecole-2026", meta: meta() })).ok).toBe(true);
      await h.loginOk("nouveau@exemple.ci", { password: "Bienvenue-Dans-Ecole-2026" });
    });
  });

  describe("MFA TOTP", () => {
    it("enrôlement : secret chiffré au repos, ré-authentification exigée, codes de secours hachés", async () => {
      await h.member(A, "mfa1@exemple.ci", ["teacher"]);
      const p = await principalOf((await h.loginOk("mfa1@exemple.ci")).session.accessToken);
      const noPw = await h.iam.beginMfaEnrollment({ via: "session", principal: p }, { meta: meta() });
      expect(noPw.ok).toBe(false);
      const badPw = await h.iam.beginMfaEnrollment({ via: "session", principal: p }, { password: "faux", meta: meta() });
      expect(badPw.ok).toBe(false);
      const begin = await h.iam.beginMfaEnrollment({ via: "session", principal: p }, { password: TEST_PASSWORD, meta: meta() });
      if (!begin.ok) throw begin.error;
      expect(begin.value.otpauthUri).toMatch(/^otpauth:\/\/totp\/EcoleDigitale:mfa1%40exemple\.ci\?/);

      const pending = await h.admin.query(`SELECT mfa_pending_secret_enc, mfa_enabled FROM iam.identities WHERE email = 'mfa1@exemple.ci'`);
      expect(pending.rows[0].mfa_enabled).toBe(false);
      expect(pending.rows[0].mfa_pending_secret_enc).toMatch(/^v1\.k1\./);
      expect(pending.rows[0].mfa_pending_secret_enc).not.toContain(begin.value.secret);

      const bad = await h.iam.confirmMfaEnrollment({ via: "session", principal: p }, { code: "000000", meta: meta() });
      expect(!bad.ok && bad.error.code).toBe(AuthErrorCodes.mfaInvalidCode);
      const done = await h.iam.confirmMfaEnrollment({ via: "session", principal: p }, { code: codeNow(begin.value.secret), meta: meta() });
      if (!done.ok) throw done.error;
      expect(done.value.recoveryCodes).toHaveLength(10);
      const rows = await h.admin.query(`SELECT code_hash FROM iam.mfa_recovery_codes`);
      for (const c of done.value.recoveryCodes) expect(JSON.stringify(rows.rows)).not.toContain(c.replace(/-/g, ""));
      expect((await h.events(A, "iam.mfa.enabled")).length).toBeGreaterThanOrEqual(1);

      const again = await h.iam.beginMfaEnrollment({ via: "session", principal: p }, { password: TEST_PASSWORD, meta: meta() });
      expect(!again.ok && again.error.code).toBe(AuthErrorCodes.mfaAlreadyEnabled);
    });

    it("login avec MFA : challenge, code valide → session mfa ; rejeu du même code refusé ; mauvais code refusé", async () => {
      await h.member(A, "mfa2@exemple.ci", ["teacher"]);
      const { secret } = await enroll("mfa2@exemple.ci");
      h.clock.advance(60_000);

      const r = await h.iam.login({ email: "mfa2@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      if (!r.ok || r.value.status !== "mfa_required") throw new Error("challenge attendu");
      const token = r.value.challengeToken;

      const wrong = await h.iam.completeMfaChallenge({ challengeToken: token, code: "123456", meta: meta() });
      expect(!wrong.ok && wrong.error.code).toBe(AuthErrorCodes.mfaInvalidCode);

      const code = codeNow(secret);
      const good = await h.iam.completeMfaChallenge({ challengeToken: token, code, meta: meta() });
      if (!good.ok) throw good.error;
      expect(good.value.session.claims).toMatchObject({ mfa: true, amr: ["pwd", "otp"] });
      expect((await principalOf(good.value.session.accessToken)).mfa).toBe(true);
      expect((await h.events(A, "iam.user.logged_in")).some((e) => e.payload.method === "mfa_totp")).toBe(true);

      // Le challenge est à usage unique.
      const reuse = await h.iam.completeMfaChallenge({ challengeToken: token, code: codeNow(secret, 30_000), meta: meta() });
      expect(!reuse.ok && reuse.error.code).toBe(AuthErrorCodes.mfaChallengeInvalid);

      // Rejeu : nouveau challenge, MÊME code (déjà consommé) → refusé.
      const r2 = await h.iam.login({ email: "mfa2@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      if (!r2.ok || r2.value.status !== "mfa_required") throw new Error("challenge attendu");
      const replay = await h.iam.completeMfaChallenge({ challengeToken: r2.value.challengeToken, code, meta: meta() });
      expect(!replay.ok && replay.error.code).toBe(AuthErrorCodes.mfaInvalidCode);
      // Le code du pas suivant est accepté.
      const next = await h.iam.completeMfaChallenge({ challengeToken: r2.value.challengeToken, code: codeNow(secret, 30_000), meta: meta() });
      expect(next.ok).toBe(true);
    });

    it("le challenge meurt après le nombre maximal d'essais, et après expiration", async () => {
      await h.member(A, "mfa3@exemple.ci", ["teacher"]);
      const { secret } = await enroll("mfa3@exemple.ci");
      h.clock.advance(60_000);
      const r = await h.iam.login({ email: "mfa3@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      if (!r.ok || r.value.status !== "mfa_required") throw new Error("challenge attendu");
      for (let i = 0; i < 4; i += 1) await h.iam.completeMfaChallenge({ challengeToken: r.value.challengeToken, code: "111111", meta: meta() });
      // 5e essai faux → verrou/limite ; même le BON code ne passe plus ensuite.
      await h.iam.completeMfaChallenge({ challengeToken: r.value.challengeToken, code: "111111", meta: meta() });
      const late = await h.iam.completeMfaChallenge({ challengeToken: r.value.challengeToken, code: codeNow(secret), meta: meta() });
      expect(late.ok).toBe(false);

      h.clock.advance(2 * 3600_000);
      const r2 = await h.iam.login({ email: "mfa3@exemple.ci", password: TEST_PASSWORD, meta: meta({ ip: "198.51.100.77" }) });
      if (!r2.ok || r2.value.status !== "mfa_required") throw new Error("challenge attendu");
      h.clock.advance((h.config.challengeTtlSec + 10) * 1000);
      const expired = await h.iam.completeMfaChallenge({ challengeToken: r2.value.challengeToken, code: codeNow(secret), meta: meta() });
      expect(!expired.ok && expired.error.code).toBe(AuthErrorCodes.mfaChallengeInvalid);
    });

    it("codes de secours : usage unique, normalisation tolérante", async () => {
      await h.member(A, "mfa4@exemple.ci", ["teacher"]);
      const { recoveryCodes } = await enroll("mfa4@exemple.ci");
      const login = async () => {
        const r = await h.iam.login({ email: "mfa4@exemple.ci", password: TEST_PASSWORD, meta: meta() });
        if (!r.ok || r.value.status !== "mfa_required") throw new Error("challenge attendu");
        return r.value.challengeToken;
      };
      const code = recoveryCodes[0]!;
      const ok = await h.iam.completeMfaChallenge({ challengeToken: await login(), recoveryCode: code.toLowerCase().replace(/-/g, ""), meta: meta() });
      if (!ok.ok) throw ok.error;
      expect(ok.value.session.claims.amr).toEqual(["pwd", "rcv"]);
      const reused = await h.iam.completeMfaChallenge({ challengeToken: await login(), recoveryCode: code, meta: meta() });
      expect(reused.ok).toBe(false);
      const other = await h.iam.completeMfaChallenge({ challengeToken: await login(), recoveryCode: recoveryCodes[1]!, meta: meta() });
      expect(other.ok).toBe(true);
    });

    it("rôle soumis à la politique MFA sans MFA → enrôlement obligatoire avant toute session", async () => {
      await h.member(A, "owner@exemple.ci", ["owner"]);
      const r = await h.iam.login({ email: "owner@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      if (!r.ok || r.value.status !== "mfa_enrollment_required") throw new Error("enrôlement attendu");
      const subject = await h.iam.resolveEnrollmentToken(r.value.enrollmentToken, meta());
      if (!subject.ok) throw subject.error;
      const begin = await h.iam.beginMfaEnrollment(subject.value, { meta: meta() });
      if (!begin.ok) throw begin.error;
      const done = await h.iam.confirmMfaEnrollment(subject.value, { code: codeNow(begin.value.secret), meta: meta() });
      if (!done.ok) throw done.error;
      expect(done.value.session?.session.claims.mfa).toBe(true);
      expect(done.value.recoveryCodes).toHaveLength(10);
      // le jeton d'enrôlement est consommé
      expect((await h.iam.resolveEnrollmentToken(r.value.enrollmentToken, meta())).ok).toBe(false);
      // les connexions suivantes passent par le challenge
      const again = await h.iam.login({ email: "owner@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      expect(again.ok && again.value.status).toBe("mfa_required");
    });

    it("une session SANS MFA est refusée dès que le rôle devient soumis à la politique", async () => {
      const m = await h.member(A, "devient-owner@exemple.ci", ["teacher"]);
      const out = await h.loginOk("devient-owner@exemple.ci");
      expect((await h.iam.authenticate(out.session.accessToken)).ok).toBe(true);
      await h.admin.query(`UPDATE iam.memberships SET roles = ARRAY['owner'], base_role = 'owner', active_role = NULL WHERE id = $1`, [m.membershipId]);
      // activeRole du jeton ('teacher') n'existe plus : refus ; et même avec 'owner' la session non-MFA serait refusée.
      expect((await h.iam.authenticate(out.session.accessToken)).ok).toBe(false);
    });

    it("désactivation : mot de passe + second facteur, refusée si un rôle impose la MFA, invalide les autres sessions", async () => {
      await h.member(A, "mfa5@exemple.ci", ["teacher"]);
      const { secret } = await enroll("mfa5@exemple.ci");
      h.clock.advance(120_000);
      const r = await h.iam.login({ email: "mfa5@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      if (!r.ok || r.value.status !== "mfa_required") throw new Error("challenge attendu");
      const sess = await h.iam.completeMfaChallenge({ challengeToken: r.value.challengeToken, code: codeNow(secret), meta: meta() });
      if (!sess.ok) throw sess.error;
      const other = await h.loginOk("mfa5@exemple.ci").catch(() => null);
      expect(other).toBeNull(); // MFA activée : plus de connexion directe
      const p = await principalOf(sess.value.session.accessToken);

      const noPw = await h.iam.disableMfa(p, { password: "faux", code: codeNow(secret, 30_000), meta: meta() });
      expect(noPw.ok).toBe(false);
      const noCode = await h.iam.disableMfa(p, { password: TEST_PASSWORD, code: "000000", meta: meta() });
      expect(noCode.ok).toBe(false);
      h.clock.advance(60_000);
      const done = await h.iam.disableMfa(p, { password: TEST_PASSWORD, code: codeNow(secret), meta: meta() });
      if (!done.ok) throw done.error;
      expect((await h.iam.authenticate(sess.value.session.accessToken)).ok).toBe(false);
      expect((await h.iam.authenticate(done.value.session.accessToken)).ok).toBe(true);
      const row = await h.admin.query(`SELECT mfa_enabled, mfa_secret_enc FROM iam.identities WHERE email = 'mfa5@exemple.ci'`);
      expect(row.rows[0]).toEqual({ mfa_enabled: false, mfa_secret_enc: null });
      expect((await h.admin.query(`SELECT 1 FROM iam.mfa_recovery_codes WHERE identity_id = (SELECT id FROM iam.identities WHERE email = 'mfa5@exemple.ci')`)).rowCount).toBe(0);
      await h.loginOk("mfa5@exemple.ci");
    });

    it("désactivation refusée pour qui détient un rôle imposant la MFA, même dans un AUTRE établissement", async () => {
      await h.member(A, "mfa6@exemple.ci", ["teacher"]);
      await h.member(B, "mfa6@exemple.ci", ["director"]);
      const { secret } = await enroll("mfa6@exemple.ci");
      h.clock.advance(60_000);
      const r = await h.iam.login({ email: "mfa6@exemple.ci", password: TEST_PASSWORD, tenantSlug: "lycee-a", meta: meta() });
      if (!r.ok || r.value.status !== "mfa_required") throw new Error("challenge attendu");
      const s = await h.iam.completeMfaChallenge({ challengeToken: r.value.challengeToken, code: codeNow(secret), meta: meta() });
      if (!s.ok) throw s.error;
      h.clock.advance(60_000);
      const d = await h.iam.disableMfa(await principalOf(s.value.session.accessToken), { password: TEST_PASSWORD, code: codeNow(secret), meta: meta() });
      expect(!d.ok && d.error.code).toBe(AuthErrorCodes.mfaMandatory);
    });

    it("switch-tenant vers un établissement imposant la MFA depuis une session sans MFA → challenge / enrôlement", async () => {
      await h.member(A, "switch-mfa@exemple.ci", ["parent"]);
      await h.member(B, "switch-mfa@exemple.ci", ["bursar"]);
      const out = await h.loginOk("switch-mfa@exemple.ci", { tenantSlug: "lycee-a" });
      const sw = await h.iam.switchTenant(await principalOf(out.session.accessToken), { tenantId: B, meta: meta() });
      expect(sw.ok && sw.value.status).toBe("mfa_enrollment_required");
      expect((await h.iam.authenticate(out.session.accessToken)).ok).toBe(true); // session d'origine conservée
    });

    it("réinitialisation par un administrateur : session MFA exigée, accès mono-établissement seulement", async () => {
      const victim = await h.member(A, "perdu-tel@exemple.ci", ["teacher"]);
      const { secret } = await enroll("perdu-tel@exemple.ci");
      expect(secret).toBeTruthy();
      await h.member(A, "dir@exemple.ci", ["director"]);
      const dirEnroll = await enroll("dir@exemple.ci").catch(() => null);
      expect(dirEnroll).toBeNull(); // le directeur passe par l'enrôlement forcé, pas par une session directe

      // Le directeur s'enrôle via le flux obligatoire.
      const r = await h.iam.login({ email: "dir@exemple.ci", password: TEST_PASSWORD, meta: meta() });
      if (!r.ok || r.value.status !== "mfa_enrollment_required") throw new Error("enrôlement attendu");
      const subject = await h.iam.resolveEnrollmentToken(r.value.enrollmentToken, meta());
      if (!subject.ok) throw subject.error;
      const begin = await h.iam.beginMfaEnrollment(subject.value, { meta: meta() });
      if (!begin.ok) throw begin.error;
      const done = await h.iam.confirmMfaEnrollment(subject.value, { code: codeNow(begin.value.secret), meta: meta() });
      if (!done.ok || !done.value.session) throw new Error("session attendue");
      const dir = await principalOf(done.value.session.session.accessToken);

      expect((await h.iam.adminResetMfa({ ...dir, mfa: false }, victim.membershipId, meta())).ok).toBe(false);
      const reset = await h.iam.adminResetMfa(dir, victim.membershipId, meta());
      expect(reset.ok).toBe(true);
      await h.loginOk("perdu-tel@exemple.ci");
      expect((await h.events(A, "iam.mfa.reset")).length).toBe(1);

      // Une personne qui a aussi un accès ailleurs : refus sans détail.
      const shared = await h.member(A, "partage@exemple.ci", ["teacher"]);
      await h.member(B, "partage@exemple.ci", ["teacher"]);
      await enroll("partage@exemple.ci");
      const refused = await h.iam.adminResetMfa(dir, shared.membershipId, meta());
      expect(refused.ok).toBe(false);
    });
  });

  describe("impersonation super-admin", () => {
    const actor = { id: "9f1b6d52-0c3e-4a3e-8f57-6b3a2f1d0c11", email: "support@plateforme.example" };

    it("jeton distinct à TTL court, claim act, session traçable, événement d'audit dans la même transaction", async () => {
      const target = await h.member(A, "cible@exemple.ci", ["teacher"]);
      const out = await h.iam.startImpersonation(actor, { tenantId: A, identityId: target.identityId, reason: "Ticket #4821 : bulletin introuvable", meta: meta() });
      if (!out.ok) throw out.error;
      const auth = await h.iam.authenticate(out.value.accessToken);
      if (!auth.ok) throw auth.error;
      expect(auth.value.claims).toMatchObject({ use: "impersonation", act: { sub: actor.id, typ: "super_admin" }, mfa: false });
      expect(auth.value.claims.exp - auth.value.claims.iat).toBe(h.config.impersonationTtlSec);
      expect(auth.value.principal.ctx).toMatchObject({ actor: "superAdmin", userId: target.identityId, mfa: false });
      expect(auth.value.principal.impersonatedBy).toBe(actor.id);

      const evt = (await h.events(A, "iam.impersonation.started"))[0]!;
      expect(evt.actor_id).toBe(actor.id);
      expect(evt.payload).toMatchObject({ v: 1, superAdminId: actor.id, targetUserId: target.identityId, reason: "Ticket #4821 : bulletin introuvable", sessionId: out.value.sessionId });
      const sess = await h.admin.query(`SELECT kind, actor_id, reason FROM iam.sessions WHERE id = $1`, [out.value.sessionId]);
      expect(sess.rows[0]).toMatchObject({ kind: "impersonation", actor_id: actor.id });
      expect((await h.admin.query(`SELECT 1 FROM iam.refresh_tokens WHERE session_id = $1`, [out.value.sessionId])).rowCount).toBe(0); // non renouvelable

      h.clock.advance((h.config.impersonationTtlSec + 10) * 1000);
      expect((await h.iam.authenticate(out.value.accessToken)).ok).toBe(false);
    });

    it("motif obligatoire, cible inactive refusée, actions sensibles interdites sous impersonation, révocable", async () => {
      const target = await h.member(A, "cible2@exemple.ci", ["teacher"]);
      const noReason = await h.iam.startImpersonation(actor, { tenantId: A, identityId: target.identityId, reason: "court", meta: meta() });
      expect(!noReason.ok && noReason.error.code).toBe(AuthErrorCodes.impersonationForbidden);
      const ghost = await h.iam.startImpersonation(actor, { tenantId: A, identityId: "00000000-0000-4000-8000-000000000001", reason: "Motif suffisamment long", meta: meta() });
      expect(ghost.ok).toBe(false);
      const wrongTenant = await h.iam.startImpersonation(actor, { tenantId: B, identityId: target.identityId, reason: "Motif suffisamment long", meta: meta() });
      expect(wrongTenant.ok).toBe(false);

      const out = await h.iam.startImpersonation(actor, { tenantId: A, identityId: target.identityId, reason: "Motif suffisamment long", meta: meta() });
      if (!out.ok) throw out.error;
      const p = await principalOf(out.value.accessToken);
      expect((await h.iam.changePassword(p, { currentPassword: TEST_PASSWORD, newPassword: "Nouveau-Mot-De-Passe-88", meta: meta() })).ok).toBe(false);
      expect((await h.iam.beginMfaEnrollment({ via: "session", principal: p }, { password: TEST_PASSWORD, meta: meta() })).ok).toBe(false);
      expect((await h.iam.switchTenant(p, { tenantId: B, meta: meta() })).ok).toBe(false);
      await h.iam.logout(p, meta());
      expect((await h.iam.authenticate(out.value.accessToken)).ok).toBe(false);
    });

    it("sans audit, pas de session : si l'écriture de l'événement échoue, rien n'est créé", async () => {
      const target = await h.member(A, "cible3@exemple.ci", ["teacher"]);
      const before = await h.admin.query(`SELECT count(*)::int AS n FROM iam.sessions WHERE kind = 'impersonation'`);
      await h.admin.query(`REVOKE INSERT ON kernel.domain_events FROM app_user`);
      try {
        await expect(h.iam.startImpersonation(actor, { tenantId: A, identityId: target.identityId, reason: "Motif suffisamment long", meta: meta() })).rejects.toThrow();
      } finally {
        await h.admin.query(`GRANT INSERT ON kernel.domain_events TO app_user`);
      }
      const after = await h.admin.query(`SELECT count(*)::int AS n FROM iam.sessions WHERE kind = 'impersonation'`);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });
});
