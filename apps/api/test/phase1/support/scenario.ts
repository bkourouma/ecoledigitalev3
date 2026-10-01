/**
 * Gestes réutilisés par les tests d'assemblage : provisionner par la console, activer un compte invité,
 * se connecter avec ou sans MFA. Tout passe par HTTP (`app.inject`), jamais par les use cases.
 */
import { expect } from "vitest";
import { totpAt } from "./totp";
import type { HttpResult, Phase1Env } from "./harness";

export interface ProvisionedOwner {
  tenantId: string;
  slug: string;
  ownerEmail: string;
  ownerIdentityId: string;
  institutionId: string;
  defaultCampusId: string;
}

export interface Session {
  accessToken: string;
  identityId: string;
  /** Secret TOTP (base32), si la MFA a été enrôlée par ce geste. */
  totpSecret?: string;
}

export const PASSWORD = "Cobalt-Brume-4821-Zeta";

export async function provisionByConsole(
  p: Phase1Env,
  input: { name: string; slug: string; packs: string[]; ownerEmail: string; trial?: { planKey?: string; days?: number } },
): Promise<ProvisionedOwner> {
  const res = await p.http("POST", "/api/v1/platform/tenants", {
    token: p.operatorToken,
    body: {
      name: input.name,
      slug: input.slug,
      countryCode: "CI",
      packs: input.packs,
      adminContact: { name: "Responsable Test", email: input.ownerEmail, phone: "+225 07 00 00 00 00" },
      ...(input.trial ? { trial: input.trial } : {}),
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    tenantId: res.body.tenantId,
    slug: res.body.slug,
    ownerEmail: input.ownerEmail,
    ownerIdentityId: res.body.owner.identityId,
    institutionId: res.body.institutions[0].id,
    defaultCampusId: res.body.institutions[0].defaultCampusId,
  };
}

/** Le propriétaire (ou un invité) définit son mot de passe avec le lien d'invitation « envoyé ». */
export async function redeemInvitation(p: Phase1Env, email: string, password = PASSWORD): Promise<void> {
  const invite = [...p.invitations].reverse().find((i) => i.email === email && i.kind === "invitation");
  expect(invite, `invitation pour ${email}`).toBeDefined();
  const res = await p.http("POST", "/api/v1/iam/password/reset", { body: { token: invite!.token, newPassword: password } });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
}

export async function loginRaw(p: Phase1Env, email: string, slug: string, password = PASSWORD): Promise<HttpResult> {
  return p.http("POST", "/api/v1/iam/login", { body: { email, password, tenantSlug: slug, client: "mobile" } });
}

/** Connexion d'un compte SANS MFA obligatoire. */
export async function loginPlain(p: Phase1Env, email: string, slug: string, password = PASSWORD): Promise<Session> {
  const res = await loginRaw(p, email, slug, password);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe("authenticated");
  return { accessToken: res.body.accessToken, identityId: res.body.user.id ?? res.body.user.userId };
}

/** Enrôlement TOTP à partir d'un jeton d'enrôlement (login d'un rôle qui impose la MFA). Renvoie la session MFA. */
export async function loginWithMfaEnrollment(p: Phase1Env, email: string, slug: string, password = PASSWORD): Promise<Session> {
  const login = await loginRaw(p, email, slug, password);
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  expect(login.body.status).toBe("mfa_enrollment_required");
  const enroll = await p.http("POST", "/api/v1/iam/mfa/enroll", { token: login.body.enrollmentToken, body: {} });
  expect(enroll.status, JSON.stringify(enroll.body)).toBe(200);
  const secret = enroll.body.secret as string;
  const verify = await p.http("POST", "/api/v1/iam/mfa/verify", {
    token: login.body.enrollmentToken,
    body: { code: totpAt(secret, Date.now()), client: "mobile" },
  });
  expect(verify.status, JSON.stringify(verify.body)).toBe(200);
  expect(verify.body.recoveryCodes.length).toBeGreaterThan(0);
  expect(verify.body.session?.accessToken).toBeTruthy();
  return {
    accessToken: verify.body.session.accessToken,
    identityId: verify.body.session.user.id ?? verify.body.session.user.userId,
    totpSecret: secret,
  };
}

/** Connexion d'un compte qui a déjà un TOTP : défi, puis code du pas SUIVANT (anti-rejeu : le pas courant est consommé). */
export async function loginWithChallenge(p: Phase1Env, email: string, slug: string, totpSecret: string, stepsAhead = 1, password = PASSWORD): Promise<Session> {
  const login = await loginRaw(p, email, slug, password);
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  expect(login.body.status).toBe("mfa_required");
  const challenge = await p.http("POST", "/api/v1/iam/mfa/challenge", {
    body: { challengeToken: login.body.challengeToken, code: totpAt(totpSecret, Date.now() + stepsAhead * 30_000), client: "mobile" },
  });
  expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
  return { accessToken: challenge.body.accessToken, identityId: challenge.body.user.id ?? challenge.body.user.userId, totpSecret };
}

/** Récupère toutes les pages du journal d'audit du tenant (API de lecture). */
export async function readAuditLog(p: Phase1Env, token: string, query = ""): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const qs: string = `limit=200${query ? `&${query}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res: HttpResult = await p.http("GET", `/api/v1/audit/logs?${qs}`, { token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    items.push(...res.body.items);
    cursor = res.body.nextCursor;
    if (!cursor) break;
  }
  return items;
}
