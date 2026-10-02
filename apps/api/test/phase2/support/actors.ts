/**
 * Acteurs du scénario d'année scolaire : TOUS passent par HTTP et par de vrais rôles système (modèles `rbac`), de vrais jetons
 * IAM (connexion, MFA par TOTP) : aucun contexte forgé, aucun contournement des permissions.
 */
import { expect } from "vitest";
import type { HttpResult, Phase1Env } from "../../phase1/support/harness";
import { PASSWORD, loginPlain, loginWithChallenge, redeemInvitation, type Session } from "../../phase1/support/scenario";
import { totpAt } from "../../phase1/support/totp";

export type Http = Phase1Env["http"];

/** Assertion avec le corps de la réponse dans le message d'échec (un diagnostic, pas seulement « 400 ≠ 201 »). */
export function expectStatus(res: HttpResult, status: number | number[]): HttpResult {
  const wanted = Array.isArray(status) ? status : [status];
  expect(wanted, `${res.status} ${JSON.stringify(res.body)?.slice(0, 700)}`).toContain(res.status);
  return res;
}

/** Un acteur authentifié : jeton d'accès IAM (+ MFA si exigée), identité et appels HTTP pré-authentifiés. */
export interface Actor {
  label: string;
  email: string;
  identityId: string;
  token: string;
  totpSecret?: string;
  get(url: string, expected?: number | number[]): Promise<HttpResult>;
  post(url: string, body?: unknown, expected?: number | number[], headers?: Record<string, string>): Promise<HttpResult>;
  put(url: string, body?: unknown, expected?: number | number[], headers?: Record<string, string>): Promise<HttpResult>;
  patch(url: string, body?: unknown, expected?: number | number[]): Promise<HttpResult>;
  del(url: string, expected?: number | number[]): Promise<HttpResult>;
  /** Appel brut : jamais d'assertion (pour prouver un REFUS). */
  raw(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResult>;
}

export function actorFrom(http: Http, label: string, email: string, session: Session): Actor {
  const token = session.accessToken;
  const call = async (method: string, url: string, body: unknown, expected: number | number[], headers?: Record<string, string>): Promise<HttpResult> => {
    const res = await http(method, url, { token, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
    return expectStatus(res, expected);
  };
  return {
    label,
    email,
    identityId: session.identityId,
    token,
    ...(session.totpSecret ? { totpSecret: session.totpSecret } : {}),
    get: (url, expected = 200) => call("GET", url, undefined, expected),
    post: (url, body = {}, expected = [200, 201], headers) => call("POST", url, body, expected, headers),
    put: (url, body = {}, expected = 200, headers) => call("PUT", url, body, expected, headers),
    patch: (url, body = {}, expected = 200) => call("PATCH", url, body, expected),
    del: (url, expected = [200, 204]) => call("DELETE", url, undefined, expected),
    raw: (method, url, body, headers) => http(method, url, { token, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) }),
  };
}

/**
 * Invite un membre (IAM), lui attribue un rôle SYSTÈME de rbac (clé de modèle), active son compte par le lien d'invitation, puis
 * lui fait enrôler la MFA (mot de passe + code TOTP) et se reconnecter avec le défi : sa session porte le second facteur,
 * comme celle d'un directeur réel qui exerce des permissions sensibles.
 */
export async function onboardStaffMember(p: Phase1Env, owner: Actor, slug: string, email: string, systemRole: string, options: { mfa?: boolean } = {}): Promise<Actor> {
  const invite = await owner.post("/api/v1/iam/admin/members", { email, roles: [systemRole], sendInvitation: true }, 201);
  expect(invite.body.membershipId).toBeTruthy();
  await redeemInvitation(p, email);
  const plain = await loginPlain(p, email, slug);

  const roles = await owner.get("/api/v1/rbac/roles");
  const role = (roles.body.roles as Array<{ id: string; templateKey: string | null }>).find((r) => r.templateKey === systemRole);
  expect(role, `rôle système ${systemRole}`).toBeDefined();
  await owner.post("/api/v1/rbac/assignments", { userId: plain.identityId, roleId: role!.id, scope: { type: "tenant" } }, 201);

  if (options.mfa === false) return actorFrom(p.http, systemRole, email, plain);
  const enroll = await p.http("POST", "/api/v1/iam/mfa/enroll", { token: plain.accessToken, body: { password: PASSWORD } });
  expectStatus(enroll, 200);
  const secret = enroll.body.secret as string;
  expectStatus(await p.http("POST", "/api/v1/iam/mfa/verify", { token: plain.accessToken, body: { code: totpAt(secret, Date.now()), client: "mobile" } }), 200);
  const strong = await loginWithChallenge(p, email, slug, secret, 1);
  return actorFrom(p.http, systemRole, email, strong);
}

/** Active le compte d'une personne invitée par le portail (`people`) et la connecte (sans MFA : rôles élève, parent, enseignant). */
export async function activatePortalAccount(p: Phase1Env, slug: string, email: string, label: string): Promise<Actor> {
  await redeemInvitation(p, email);
  const session = await loginPlain(p, email, slug);
  return actorFrom(p.http, label, email, session);
}
