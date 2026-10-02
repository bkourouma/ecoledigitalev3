/**
 * Acteurs du seed : de vrais comptes IAM (invitation, mot de passe, MFA TOTP) qui appellent l'API HTTP publique avec leurs jetons.
 * Les mots de passe sont générés À L'EXÉCUTION (aléatoires, conformes à la politique) : ils ne figurent dans aucun fichier.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { Http, HttpResult, Invitation } from "./runtime";

export class SeedStepError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
    this.name = "SeedStepError";
  }
}

/** Mot de passe aléatoire : 12+ caractères, ni courant ni dérivé de l'e-mail, sans répétition ni suite de 3 caractères (tirage rejeté sinon). */
export function randomPassword(): string {
  for (;;) {
    const candidate = `Zq${randomBytes(12).toString("base64url")}-9a`;
    const codes = [...candidate].map((c) => c.charCodeAt(0));
    const flat = codes.some((c, i) => i >= 2 && c === codes[i - 1] && c === codes[i - 2]);
    const run = codes.some((c, i) => i >= 2 && c - (codes[i - 1] as number) === (codes[i - 1] as number) - (codes[i - 2] as number) && Math.abs(c - (codes[i - 1] as number)) === 1);
    if (!flat && !run) return candidate;
  }
}

// --- TOTP (RFC 6238, SHA-1, 6 chiffres, pas de 30 s) -------------------------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("secret TOTP invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totpAt(secret: string, timeMs: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = (mac[mac.length - 1] as number) & 0x0f;
  const code = (((mac[o] as number) & 0x7f) << 24) | (((mac[o + 1] as number) & 0xff) << 16) | (((mac[o + 2] as number) & 0xff) << 8) | ((mac[o + 3] as number) & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export interface Actor {
  label: string;
  email: string;
  identityId: string;
  token: string;
  /** Secret TOTP (base32) si le compte a la MFA : affiché UNE fois à l'utilisateur du seed, jamais écrit. */
  totpSecret?: string;
  get(url: string, expected?: number | number[]): Promise<HttpResult>;
  post(url: string, body?: unknown, expected?: number | number[], headers?: Record<string, string>): Promise<HttpResult>;
  put(url: string, body?: unknown, expected?: number | number[], headers?: Record<string, string>): Promise<HttpResult>;
  patch(url: string, body?: unknown, expected?: number | number[]): Promise<HttpResult>;
  /** Appel brut : aucune assertion (pour sonder). */
  raw(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResult>;
  /** Corps BRUT (téléversement de fichier), sans sérialisation JSON. */
  upload(method: string, url: string, rawBody: string | Buffer, headers: Record<string, string>): Promise<HttpResult>;
}

export interface Session {
  accessToken: string;
  identityId: string;
  totpSecret?: string;
}

export function expectStatus(res: HttpResult, status: number | number[], what: string): HttpResult {
  const wanted = Array.isArray(status) ? status : [status];
  if (!wanted.includes(res.status)) {
    throw new SeedStepError(`${what} : HTTP ${res.status} (attendu ${wanted.join("/")}) ${JSON.stringify(res.body)?.slice(0, 600)}`, res.status, res.body);
  }
  return res;
}

export function actorFrom(http: Http, label: string, email: string, session: Session): Actor {
  const token = session.accessToken;
  const call = async (method: string, url: string, body: unknown, expected: number | number[], headers?: Record<string, string>): Promise<HttpResult> =>
    expectStatus(await http(method, url, { token, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) }), expected, `${label} ${method} ${url}`);
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
    raw: (method, url, body, headers) => http(method, url, { token, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) }),
    upload: (method, url, rawBody, headers) => http(method, url, { token, rawBody, headers }),
  };
}

export class Accounts {
  private readonly secrets = new Map<string, { email: string; password: string; totpSecret?: string }>();
  constructor(private readonly http: Http, private readonly invitations: Invitation[], private readonly slug: string) {}

  /** Comptes créés (pour l'affichage unique en fin d'exécution). */
  list(): Array<{ role: string; email: string; password: string; totpSecret?: string }> {
    return [...this.secrets.entries()].map(([role, v]) => ({ role, ...v }));
  }

  private async redeem(email: string, password: string): Promise<void> {
    const invite = [...this.invitations].reverse().find((i) => i.email === email && i.kind === "invitation");
    if (!invite) throw new SeedStepError(`Aucune invitation reçue pour ${email}.`);
    expectStatus(await this.http("POST", "/api/v1/iam/password/reset", { body: { token: invite.token, newPassword: password } }), 204, `activation de ${email}`);
  }

  private async login(email: string, password: string): Promise<HttpResult> {
    return this.http("POST", "/api/v1/iam/login", { body: { email, password, tenantSlug: this.slug, client: "mobile" } });
  }

  private async plainSession(email: string, password: string): Promise<Session> {
    const res = expectStatus(await this.login(email, password), 200, `connexion de ${email}`);
    if (res.body.status !== "authenticated") throw new SeedStepError(`Connexion de ${email} : statut inattendu ${String(res.body.status)}`);
    return { accessToken: res.body.accessToken, identityId: res.body.user.id ?? res.body.user.userId };
  }

  /** Propriétaire : active son compte, enrôle la MFA (TOTP) et obtient une session MFA. */
  async owner(role: string, email: string): Promise<Actor> {
    const password = randomPassword();
    await this.redeem(email, password);
    const login = expectStatus(await this.login(email, password), 200, `connexion de ${email}`);
    if (login.body.status !== "mfa_enrollment_required") throw new SeedStepError(`Le propriétaire devrait enrôler la MFA (statut ${String(login.body.status)}).`);
    const enroll = expectStatus(await this.http("POST", "/api/v1/iam/mfa/enroll", { token: login.body.enrollmentToken, body: {} }), 200, "enrôlement MFA");
    const secret = enroll.body.secret as string;
    const verify = expectStatus(
      await this.http("POST", "/api/v1/iam/mfa/verify", { token: login.body.enrollmentToken, body: { code: totpAt(secret, Date.now()), client: "mobile" } }),
      200,
      "validation MFA",
    );
    this.secrets.set(role, { email, password, totpSecret: secret });
    return actorFrom(this.http, role, email, {
      accessToken: verify.body.session.accessToken,
      identityId: verify.body.session.user.id ?? verify.body.session.user.userId,
      totpSecret: secret,
    });
  }

  /** Membre du personnel invité par le propriétaire (rôle SYSTÈME rbac), avec MFA : le défi du second facteur exige le pas SUIVANT (anti-rejeu). */
  async staff(owner: Actor, role: string, email: string, systemRole: string, options: { mfa?: boolean } = {}): Promise<Actor> {
    expectStatus(await owner.raw("POST", "/api/v1/iam/admin/members", { email, roles: [systemRole], sendInvitation: true }), 201, `invitation de ${email}`);
    const password = randomPassword();
    await this.redeem(email, password);
    const plain = await this.plainSession(email, password);
    const roles = await owner.get("/api/v1/rbac/roles");
    const found = (roles.body.roles as Array<{ id: string; templateKey: string | null }>).find((r) => r.templateKey === systemRole);
    if (!found) throw new SeedStepError(`Rôle système introuvable : ${systemRole}`);
    await owner.post("/api/v1/rbac/assignments", { userId: plain.identityId, roleId: found.id, scope: { type: "tenant" } }, 201);
    if (options.mfa === false) {
      // Rôle sans permission sensible : la session simple suffit (la MFA reste activable depuis /v2/account/security).
      this.secrets.set(role, { email, password });
      return actorFrom(this.http, role, email, plain);
    }
    const enroll = expectStatus(await this.http("POST", "/api/v1/iam/mfa/enroll", { token: plain.accessToken, body: { password } }), 200, `enrôlement MFA de ${email}`);
    const secret = enroll.body.secret as string;
    expectStatus(await this.http("POST", "/api/v1/iam/mfa/verify", { token: plain.accessToken, body: { code: totpAt(secret, Date.now()), client: "mobile" } }), 200, `validation MFA de ${email}`);
    const login = expectStatus(await this.login(email, password), 200, `reconnexion de ${email}`);
    if (login.body.status !== "mfa_required") throw new SeedStepError(`Défi MFA attendu pour ${email} (statut ${String(login.body.status)}).`);
    const challenge = expectStatus(
      await this.http("POST", "/api/v1/iam/mfa/challenge", { body: { challengeToken: login.body.challengeToken, code: totpAt(secret, Date.now() + 30_000), client: "mobile" } }),
      200,
      `défi MFA de ${email}`,
    );
    this.secrets.set(role, { email, password, totpSecret: secret });
    return actorFrom(this.http, role, email, { accessToken: challenge.body.accessToken, identityId: challenge.body.user.id ?? challenge.body.user.userId, totpSecret: secret });
  }

  /** Compte de portail (enseignant, parent, élève) invité par `people` : activation puis connexion, sans MFA. */
  async portal(role: string, email: string): Promise<Actor> {
    const password = randomPassword();
    await this.redeem(email, password);
    const session = await this.plainSession(email, password);
    this.secrets.set(role, { email, password });
    return actorFrom(this.http, role, email, session);
  }
}
