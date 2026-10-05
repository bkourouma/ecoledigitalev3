/**
 * Élévation d'authentification (step-up MFA) : POST /api/v1/iam/mfa/step-up.
 * Postgres réel (RLS) : fenêtre courte, anti-rejeu, limiteur, audit sans code, isolation inter-tenants.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { base32Decode, totp } from "../domain/totp";
import { registerIam } from "../http/plugin";
import * as sessionRepo from "../infrastructure/session-repo";
import { createHarness, describeIntegration, meta, TEST_PASSWORD, type Harness } from "./helpers";

const P = "/api/v1/iam";

describeIntegration("iam — step-up MFA (Postgres réel)", () => {
  let h: Harness;
  let A: string;
  let B: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    h = await createHarness({ overrides: { mfa: { stepUpTtlSec: 120 } } });
    A = await h.createTenant("lycee-a", "Lycée A");
    B = await h.createTenant("college-b", "Collège B");
    app = Fastify();
    await registerIam(app, { iam: h.iam });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await h.stop();
  });

  const codeAt = (secretB32: string, offsetMs = 0): string => totp(base32Decode(secretB32), h.clock.now().getTime() + offsetMs);

  /** Utilisateur dont la session courante est SANS MFA alors que son compte a un TOTP (enrôlement après coup). */
  async function sessionWithoutMfa(email: string, tenantId = A, slug = "lycee-a"): Promise<{ token: string; secret: string }> {
    await h.member(tenantId, email, ["teacher"]);
    const out = await h.loginOk(email, { tenantSlug: slug });
    const auth = await h.iam.authenticate(out.session.accessToken);
    if (!auth.ok) throw auth.error;
    const p = auth.value.principal;
    const begin = await h.iam.beginMfaEnrollment({ via: "session", principal: p }, { password: TEST_PASSWORD, meta: meta() });
    if (!begin.ok) throw begin.error;
    const done = await h.iam.confirmMfaEnrollment({ via: "session", principal: p }, { code: codeAt(begin.value.secret), meta: meta() });
    if (!done.ok) throw done.error;
    // Le pas TOTP d'enrôlement est consommé : on passe au pas suivant pour la suite.
    h.clock.advance(31_000);
    return { token: out.session.accessToken, secret: begin.value.secret };
  }

  const stepUp = (token: string, code: string) =>
    app.inject({ method: "POST", url: `${P}/mfa/step-up`, payload: { code }, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const mfaOf = async (token: string): Promise<boolean> => {
    const r = await h.iam.authenticate(token);
    if (!r.ok) throw r.error;
    return r.value.principal.mfa && r.value.principal.ctx.mfa;
  };

  it("une session sans MFA devient MFA-satisfaite pour la fenêtre courte, puis redevient non élevée", async () => {
    const { token, secret } = await sessionWithoutMfa("stepup1@exemple.ci");
    expect(await mfaOf(token)).toBe(false);
    const before = await h.iam.authenticate(token);
    if (!before.ok) throw before.error;
    expect(before.value.principal.ctx.mfaElevatedUntil).toBeUndefined(); // pas d'élévation : pas de « MFA récente » (Q-PAY-38)

    const res = await stepUp(token, codeAt(secret));
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body).toMatchObject({ elevated: true, ttlSec: 120 });
    expect(new Date(body.expiresAt).getTime()).toBe(h.clock.now().getTime() + 120_000);
    expect(await mfaOf(token)).toBe(true);
    // Le contexte porte la fin de la fenêtre : les actions qui exigent une MFA RÉCENTE la comparent à l'horloge.
    const elevated = await h.iam.authenticate(token);
    if (!elevated.ok) throw elevated.error;
    expect(elevated.value.principal.ctx.mfaElevatedUntil?.getTime()).toBe(h.clock.now().getTime() + 120_000);

    h.clock.advance(119_000);
    expect(await mfaOf(token)).toBe(true);
    h.clock.advance(2_000);
    expect(await mfaOf(token)).toBe(false);
    const expired = await h.iam.authenticate(token);
    if (!expired.ok) throw expired.error;
    expect(expired.value.principal.ctx.mfaElevatedUntil).toBeUndefined();
  });

  it("refuse un mauvais code (401), un format invalide (400), sans session (401) ; n'élève rien", async () => {
    const { token, secret } = await sessionWithoutMfa("stepup2@exemple.ci");
    const bad = await stepUp(token, codeAt(secret) === "000000" ? "111111" : "000000");
    expect(bad.statusCode).toBe(401);
    expect(bad.json().code).toBe(AuthErrorCodes.mfaInvalidCode);
    expect(await mfaOf(token)).toBe(false);
    expect((await stepUp(token, "12ab")).statusCode).toBe(400);
    const anon = await app.inject({ method: "POST", url: `${P}/mfa/step-up`, payload: { code: "123456" }, headers: { "content-type": "application/json" } });
    expect(anon.statusCode).toBe(401);
  });

  it("anti-rejeu : un code déjà accepté ne sert pas deux fois", async () => {
    const { token, secret } = await sessionWithoutMfa("stepup3@exemple.ci");
    const code = codeAt(secret);
    expect((await stepUp(token, code)).statusCode).toBe(200);
    const replay = await stepUp(token, code);
    expect(replay.statusCode).toBe(401);
  });

  it("limiteur : verrouillage progressif après des essais répétés (429/403 avec Retry-After), même avec le bon code ensuite", async () => {
    const { token, secret } = await sessionWithoutMfa("stepup4@exemple.ci");
    const wrong = codeAt(secret) === "000000" ? "111111" : "000000";
    let last = await stepUp(token, wrong);
    for (let i = 0; i < 6 && last.json().code !== AuthErrorCodes.tooManyAttempts; i += 1) last = await stepUp(token, wrong);
    expect(last.json().code).toBe(AuthErrorCodes.tooManyAttempts);
    expect(last.headers["retry-after"]).toBeDefined();
    const blocked = await stepUp(token, codeAt(secret));
    expect(blocked.json().code).toBe(AuthErrorCodes.tooManyAttempts);
    expect(await mfaOf(token)).toBe(false);
  });

  it("compte sans TOTP : refus explicite (409 iam.mfa_not_enabled), pas d'élévation", async () => {
    await h.member(A, "nototp@exemple.ci", ["teacher"]);
    const out = await h.loginOk("nototp@exemple.ci");
    const res = await stepUp(out.session.accessToken, "123456");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe(AuthErrorCodes.mfaNotEnabled);
    expect(await mfaOf(out.session.accessToken)).toBe(false);
  });

  it("la révocation de la session éteint l'élévation", async () => {
    const one = await sessionWithoutMfa("stepup5@exemple.ci");
    expect((await stepUp(one.token, codeAt(one.secret))).statusCode).toBe(200);
    expect(await mfaOf(one.token)).toBe(true);
    const auth = await h.iam.authenticate(one.token);
    if (!auth.ok) throw auth.error;
    const revoked = await h.iam.revokeSession(auth.value.principal, auth.value.principal.sessionId, meta());
    expect(revoked.ok).toBe(true);
    expect((await h.iam.authenticate(one.token)).ok).toBe(false);
  });

  it("événement d'audit iam.mfa.elevated sans aucun code ; échec journalisé sans le code saisi", async () => {
    const { token, secret } = await sessionWithoutMfa("stepup6@exemple.ci");
    const wrong = codeAt(secret) === "000000" ? "111111" : "000000";
    await stepUp(token, wrong);
    const good = codeAt(secret);
    await stepUp(token, good);
    const elevated = await h.events(A, "iam.mfa.elevated");
    expect(elevated.length).toBeGreaterThanOrEqual(1);
    const last = elevated[elevated.length - 1]!;
    expect(last.payload).toMatchObject({ v: 1, sessionId: expect.any(String), expiresAt: expect.any(String) });
    const all = JSON.stringify(await h.events(A));
    expect(all).not.toContain(good);
    expect(all).not.toContain(`"${wrong}"`);
    expect(all).not.toContain(secret);
    expect(JSON.stringify(h.notifier)).not.toContain(good);
  });

  it("RLS A/B : le contexte du tenant B ne peut pas élever une session du tenant A ; la session B reste intacte", async () => {
    const a = await sessionWithoutMfa("iso-a@exemple.ci");
    const b = await sessionWithoutMfa("iso-b@exemple.ci", B, "college-b");
    const authA = await h.iam.authenticate(a.token);
    if (!authA.ok) throw authA.error;
    const until = new Date(h.clock.now().getTime() + 60_000);
    const crossed = await h.tenantDb.run(h.ctx(B), (tx) => sessionRepo.elevateSession(tx, B, authA.value.principal.sessionId, until));
    expect(crossed).toBe(false);
    const crossedWithOwnTenantId = await h.tenantDb.run(h.ctx(B), (tx) => sessionRepo.elevateSession(tx, A, authA.value.principal.sessionId, until));
    expect(crossedWithOwnTenantId).toBe(false);
    expect(await mfaOf(a.token)).toBe(false);
    // Élévation de A : sans effet sur B.
    expect((await stepUp(a.token, codeAt(a.secret))).statusCode).toBe(200);
    expect(await mfaOf(a.token)).toBe(true);
    expect(await mfaOf(b.token)).toBe(false);
    // Un code TOTP de A n'élève pas B.
    expect((await stepUp(b.token, codeAt(a.secret))).statusCode).toBe(401);
    expect(await mfaOf(b.token)).toBe(false);
  });
});
