/**
 * Harnais « authentification assemblée » : l'API telle que `src/index.ts` l'assemble pour l'authentification, sans Redis
 * ni worker (Postgres éphémère seulement) :
 *
 *   Fastify + base legacy simulée (`fastify.pg`) + VRAIS plugins legacy (tenant-context, auth-middleware, routes
 *   d'auth) + `registerV2Platform` (migrations réelles, rôle `app_user`, rattrapage des tenants legacy, modules).
 *
 * Les comptes de test sont créés par les use cases d'`iam` (`provisionMember`) avec un hash bcrypt IMPORTÉ ou un mot
 * de passe aléatoire ; tout le reste passe par HTTP (`app.inject`).
 */
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { createSystemContext, noopLogger, newId } from "@ecoledigitale/kernel";
import { configureTenantSync } from "../../src/platform/tenant-sync";
import { resetPublicRoutesForTests } from "../../src/platform/public-routes";
import { resetRegistryForTests } from "../../src/modules/registry";
import { registerV2Platform } from "../../src/platform/v2-bootstrap";
import { createLoginRole } from "../../src/platform/v2-login-role";
import { runV2Migrations } from "../../src/platform/v2-migrations";
import { createEphemeralDb, randomSuffix, type EphemeralDb } from "../helpers/fixtures";
import { FakeLegacyDb } from "../phase1/support/fake-legacy";
import { totpAt } from "../phase1/support/totp";

const here = dirname(fileURLToPath(import.meta.url));
const rand = (n = 16): string => randomBytes(n).toString("hex");

/** Charge un module du code LEGACY après la pose des secrets de test (jwt.service exige JWT_SECRET à l'import). */
export async function legacyModule<T>(relativeToSrc: string): Promise<T> {
  return (await import(/* @vite-ignore */ pathToFileURL(resolve(here, "../../src", relativeToSrc)).href)) as T;
}

/** Mot de passe aléatoire conforme à la politique (12+ caractères, ni courant, ni suite, ni répétition). */
export function randomPassword(): string {
  for (;;) {
    const candidate = `Zq${randomBytes(12).toString("base64url")}-9a`;
    const codes = [...candidate].map((c) => c.charCodeAt(0));
    const flat = codes.some((c, i) => i >= 2 && c === codes[i - 1] && c === codes[i - 2]);
    const run = codes.some((c, i) => i >= 2 && c - (codes[i - 1] as number) === (codes[i - 1] as number) - (codes[i - 2] as number) && Math.abs(c - (codes[i - 1] as number)) === 1);
    if (!flat && !run) return candidate;
  }
}

export interface HttpResult<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
  raw: string;
}

export interface Platform {
  app: FastifyInstance;
  db: EphemeralDb;
  legacy: FakeLegacyDb;
  env: Record<string, string>;
  invitations: Array<{ email: string; token: string; kind: "invitation" | "password_reset" }>;
  operatorId: string;
  operatorToken: string;
  /** Jeton legacy (HS256, secret legacy) pour un compte legacy. */
  legacyToken(user: { id: string; tenantId: string; tenantSlug: string; role: string }): string;
  http<T = any>(method: string, url: string, options?: { token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string }): Promise<HttpResult<T>>;
  /** Crée un tenant legacy (+ rattrapage v2 au prochain démarrage) — à appeler AVANT `boot`. */
  addTenant(slug: string, name?: string): { id: string; slug: string };
  /** Crée l'accès IAM (et l'identité) d'un compte ET, si `legacyRoles` est fourni, le compte legacy correspondant. */
  member(input: { tenant: { id: string; slug: string }; email: string; roles: string[]; password?: string; passwordHash?: string; legacyRoles?: string[] | null }): Promise<{ identityId: string; membershipId: string; legacyUserId: string | null; password: string | undefined }>;
  login(input: { email: string; password: string; tenantSlug?: string; activeRole?: string }): Promise<HttpResult>;
  /** Connecte et renvoie directement la session (échoue si une étape MFA est demandée). */
  session(input: { email: string; password: string; tenantSlug?: string; activeRole?: string }): Promise<{ accessToken: string; refreshToken: string; sessionId: string; user: any }>;
  /** Enrôle le TOTP à partir d'un jeton d'enrôlement et renvoie la session MFA. */
  enrollMfa(enrollmentToken: string): Promise<{ accessToken: string; refreshToken: string; secret: string; sessionId: string; recoveryCodes: string[] }>;
  stop(): Promise<void>;
}

export interface BootOptions {
  /** Variables d'environnement supplémentaires pour la plateforme v2 (ex. IAM_MFA_REQUIRED_ROLES). */
  extraEnv?: Record<string, string>;
  /** Tenants legacy présents au démarrage (le rattrapage v2 les couvre). */
  tenants?: Array<{ slug: string; name?: string }>;
}

export async function bootPlatform(options: BootOptions = {}): Promise<Platform & { tenants: Array<{ id: string; slug: string }> }> {
  const saved = { ...process.env };
  process.env.JWT_SECRET = rand(24);
  process.env.SUPER_ADMIN_JWT_SECRET = rand(24);
  delete process.env.LEGACY_TOKEN_SUNSET;
  delete process.env.REDIS_URL;
  resetRegistryForTests();
  resetPublicRoutesForTests();

  const roleName = `ed_ab_${randomSuffix()}`;
  const db = await createEphemeralDb("auth_bridge_test", [roleName]);
  await runV2Migrations({ url: db.adminUrl, logger: noopLogger });
  const appUrl = (await createLoginRole({ adminUrl: db.adminUrl, role: roleName })).applicationUrl;

  const legacy = new FakeLegacyDb();
  const operatorId = newId();
  legacy.superAdmins.set(operatorId, { active: true });
  const tenants: Array<{ id: string; slug: string }> = [];
  const addTenant = (slug: string, name = `École ${slug}`): { id: string; slug: string } => {
    const t = { id: newId(), slug };
    legacy.tenants.push({ id: t.id, slug, name, is_active: true });
    tenants.push(t);
    return t;
  };
  for (const t of options.tenants ?? []) addTenant(t.slug, t.name);

  const env: Record<string, string> = {
    NODE_ENV: "test",
    V2_DATABASE_URL: appUrl,
    IAM_JWT_SECRET: rand(32),
    IAM_MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    IAM_SCRYPT_LOG_N: "10",
    IAM_COOKIE_SECURE: "false",
    // Par défaut seul `owner` impose la MFA dans ces tests (les rôles admin/teacher sont testés sans seconde étape).
    IAM_MFA_REQUIRED_ROLES: "owner",
    AUDIT_HMAC_KEY: rand(16),
    ...(options.extraEnv ?? {}),
  };

  const invitations: Platform["invitations"] = [];
  const app = Fastify({ logger: false });
  app.decorate("pg", legacy.pool as never);
  const { default: tenantContextPlugin } = await legacyModule<{ default: never }>("plugins/tenant-context");
  const { default: authMiddleware } = await legacyModule<{ default: never }>("plugins/auth-middleware");
  const { authRoutes } = await legacyModule<{ authRoutes: never }>("routes/auth");
  await app.register(tenantContextPlugin);
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(authMiddleware);
  const { default: superAdminAuditPlugin } = await legacyModule<{ default: never }>("plugins/super-admin-audit");
  await app.register(superAdminAuditPlugin);
  await registerV2Platform(app, {
    env: env as NodeJS.ProcessEnv,
    legacyPool: legacy.pool as never,
    runtime: {
      accountNotifier: {
        async sendInvitation(m) {
          invitations.push({ kind: "invitation", email: m.email, token: m.token });
        },
        async sendPasswordReset(m) {
          invitations.push({ kind: "password_reset", email: m.email, token: m.token });
        },
      },
    },
  });
  // Routes legacy de sonde, enregistrées APRÈS la plateforme comme les vraies routes dans index.ts.
  app.get("/api/v1/students/probe", async (request) => ({
    userId: request.userId ?? null,
    user: request.user ?? null,
    tenantId: request.tenantId ?? null,
    tenantSlug: request.tenantSlug ?? null,
    xUserId: request.headers["x-user-id"] ?? null,
  }));
  app.post("/api/v1/students/probe", async (request) => ({ userId: request.userId ?? null, role: request.user?.activeRole ?? null }));
  // Sous le préfixe « santé » : publique côté legacy (aucune authentification), elle expose le tenant résolu.
  app.get("/api/v1/health/tenant-probe", async (request) => ({ tenantId: request.tenantId ?? null, source: request.tenantSelectionSource ?? null }));
  await app.ready();

  const { generateSuperAdminToken } = await legacyModule<{ generateSuperAdminToken(id: string, email: string): string }>("services/super-admin-jwt.service");
  const { generateToken } = await legacyModule<{ generateToken(payload: Record<string, unknown>): string }>("services/jwt.service");
  const operatorToken = generateSuperAdminToken(operatorId, "ops@plateforme.test");

  const http: Platform["http"] = async (method, url, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let payload: string | undefined;
    if (opts.rawBody !== undefined) payload = opts.rawBody;
    else if (opts.body !== undefined) payload = JSON.stringify(opts.body);
    if (payload !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    const res = await app.inject({ method: method as never, url, headers, ...(payload !== undefined ? { payload } : {}) });
    let body: any = res.body;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON */
    }
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown>, raw: res.body };
  };

  const platform: Platform & { tenants: typeof tenants } = {
    app,
    db,
    legacy,
    env,
    invitations,
    operatorId,
    operatorToken,
    tenants,
    http,
    addTenant,
    legacyToken: (u) =>
      generateToken({ iss: "ecoledigitale", aud: u.tenantSlug, sub: u.id, userId: u.id, scope: "tenant_user", tenantId: u.tenantId, tenantSlug: u.tenantSlug, roles: [u.role], activeRole: u.role } as never),
    async member({ tenant, email, roles, password, passwordHash, legacyRoles }) {
      const ctx = createSystemContext(tenant.id, newId());
      const pwd = passwordHash === undefined ? (password ?? randomPassword()) : undefined;
      const out = await app.iam.provisionMember(ctx, {
        email,
        roles,
        ...(pwd !== undefined ? { password: pwd } : { passwordHash: passwordHash as string }),
        sendInvitation: false,
        invitedBy: null,
        meta: { ip: null, userAgent: null, requestId: newId() },
      });
      if (!out.ok) throw out.error;
      let legacyUserId: string | null = null;
      if (legacyRoles !== null) {
        legacyUserId = newId();
        legacy.users.push({ id: legacyUserId, email, tenantId: tenant.id, tenantSlug: tenant.slug, roles: legacyRoles ?? roles });
      }
      return { identityId: out.value.identityId, membershipId: out.value.membershipId, legacyUserId, password: pwd };
    },
    login: (input) => http("POST", "/api/v1/iam/login", { body: { ...input, client: "mobile" } }),
    async session(input) {
      const res = await http("POST", "/api/v1/iam/login", { body: { ...input, client: "mobile" } });
      if (res.status !== 200 || res.body?.status !== "authenticated") throw new Error(`login attendu authentifié, reçu ${res.status} ${res.raw.slice(0, 200)}`);
      return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken, sessionId: res.body.sessionId, user: res.body.user };
    },
    async enrollMfa(enrollmentToken) {
      const enroll = await http("POST", "/api/v1/iam/mfa/enroll", { token: enrollmentToken, body: {} });
      if (enroll.status !== 200) throw new Error(`enroll ${enroll.status} ${enroll.raw}`);
      const secret = enroll.body.secret as string;
      const verify = await http("POST", "/api/v1/iam/mfa/verify", { token: enrollmentToken, body: { code: totpAt(secret, Date.now()), client: "mobile" } });
      if (verify.status !== 200) throw new Error(`verify ${verify.status} ${verify.raw}`);
      return { accessToken: verify.body.session.accessToken, refreshToken: verify.body.session.refreshToken, secret, sessionId: verify.body.session.sessionId, recoveryCodes: verify.body.recoveryCodes };
    },
    async stop() {
      configureTenantSync(null);
      await app.close().catch(() => undefined);
      await db.drop();
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    },
  };
  return platform;
}
