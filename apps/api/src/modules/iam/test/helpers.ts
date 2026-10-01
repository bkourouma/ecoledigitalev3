/**
 * Aides de test partagées : configuration jetable, Postgres jetable (via la
 * baseline de packages/database), seed de tenants/identités.
 */
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { ManualClock, noopLogger, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { SystemDb, TenantDb, migrate } from "@ecoledigitale/database";
import { buildIamConfig, type IamConfig } from "../config";
import { createIamService, type IamService } from "../application/service";
import type { AccountNotifier, RateLimiter } from "../application/ports";
import type { RequestMeta } from "../application/deps";
import type { AuthenticatedOutcome } from "../application/session-issue";
import { MemoryRateLimiter } from "../infrastructure/rate-limiter.memory";

const here = dirname(fileURLToPath(import.meta.url));
export const BASELINE_DIR = resolve(here, "../../../../../../packages/database/migrations");
export const IAM_DIR = resolve(here, "../migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);
export const describeIntegration: typeof describe = describe.skipIf(!hasDb) as unknown as typeof describe;

if (!hasDb) {
  console.warn("[iam] TEST_DATABASE_URL absente : tests d'intégration IGNORÉS (utilisez packages/database/scripts/with-postgres.mjs).");
}

/** Secrets de test ALÉATOIRES générés à chaque exécution (rien de réel dans le dépôt). */
export function testSecrets(): { jwtSecret: string; mfaEncryptionKey: string } {
  return { jwtSecret: randomBytes(48).toString("base64"), mfaEncryptionKey: randomBytes(32).toString("base64") };
}

export function testConfig(overrides: Parameters<typeof buildIamConfig>[0]["overrides"] = {}, secrets = testSecrets()): IamConfig {
  return buildIamConfig({
    ...secrets,
    overrides: {
      // Paramètres scrypt minimaux : les tests ne valident pas le coût, seulement la logique.
      scrypt: { logN: 10, r: 8, p: 1 },
      failureMinDurationMs: 0,
      cookie: { secure: true },
      ...overrides,
    },
  });
}

export const meta = (over: Partial<RequestMeta> = {}): RequestMeta => ({ ip: "203.0.113.7", userAgent: "vitest", requestId: randomBytes(8).toString("hex"), ...over });

/** Notificateur qui mémorise les envois (récupération du jeton en clair, comme le ferait le lien e-mail). */
export class RecordingNotifier implements AccountNotifier {
  resets: Array<{ email: string; token: string; expiresAt: Date; tenantName?: string }> = [];
  invitations: Array<{ email: string; token: string; expiresAt: Date; tenantName: string }> = [];
  async sendPasswordReset(i: { email: string; token: string; expiresAt: Date; tenantName?: string }): Promise<void> {
    this.resets.push(i);
  }
  async sendInvitation(i: { email: string; token: string; expiresAt: Date; tenantName: string }): Promise<void> {
    this.invitations.push(i);
  }
}

export interface Harness {
  admin: Client;
  adminUrl: string;
  dbName: string;
  pool: Pool;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  clock: ManualClock;
  notifier: RecordingNotifier;
  limiter: RateLimiter;
  config: IamConfig;
  iam: IamService;
  /** Crée un tenant actif et renvoie son id. */
  createTenant(slug: string, name?: string): Promise<string>;
  /** Crée une identité + un accès (via le use case de provisioning). */
  member(tenantId: string, email: string, roles: string[], password?: string): Promise<{ identityId: string; membershipId: string }>;
  ctx(tenantId: string, userId?: string): RequestContext;
  /** Événements de l'outbox d'un tenant (lecture administrateur, hors RLS). */
  events(tenantId: string, type?: string): Promise<Array<{ type: string; payload: Record<string, any>; actor_id: string | null }>>;
  /** Connexion réussie (échoue le test sinon) ; renvoie la réponse « authenticated ». */
  loginOk(email: string, over?: { tenantSlug?: string; password?: string; activeRole?: string; ip?: string }): Promise<AuthenticatedOutcome>;
  stop(): Promise<void>;
}

export interface HarnessOptions {
  overrides?: Parameters<typeof buildIamConfig>[0]["overrides"];
  limiter?: RateLimiter;
  secrets?: ReturnType<typeof testSecrets>;
  startTime?: string;
}

const PASSWORD = "Correct-Horse-Battery-9"; // secret-scan:allow (mot de passe factice de test)
export const TEST_PASSWORD = PASSWORD;

/** Base éphémère `ed_it_*_test` + baseline v2 + migrations iam, connexion applicative non propriétaire. */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const name = `ed_it_${randomBytes(4).toString("hex")}_iam_test`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);

  const url = (user?: string, password?: string): string => {
    const u = new URL(TEST_DATABASE_URL as string);
    u.pathname = `/${name}`;
    if (user) u.username = user;
    if (password) u.password = password;
    return u.toString();
  };
  const adminUrl = url();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await migrate({ client: admin, dirs: [BASELINE_DIR, IAM_DIR], role: "migrator", logger: noopLogger });

  const loginRole = `iam_app_${randomBytes(4).toString("hex")}`;
  const loginPassword = randomBytes(12).toString("hex");
  await admin.query(`CREATE ROLE "${loginRole}" LOGIN PASSWORD '${loginPassword}' IN ROLE app_user`);
  const pool = new Pool({ connectionString: url(loginRole, loginPassword), max: 8 });

  const clock = new ManualClock(options.startTime ?? "2026-10-01T09:00:00.000Z");
  const tenantDb = new TenantDb(pool);
  const systemDb = new SystemDb(tenantDb, { logger: noopLogger });
  const notifier = new RecordingNotifier();
  const limiter = options.limiter ?? new MemoryRateLimiter(clock);
  const config = testConfig(options.overrides, options.secrets);
  const iam = createIamService({ config, tenantDb, systemDb, limiter, notifier, clock, logger: noopLogger, sleep: async () => undefined });

  const h: Harness = {
    admin,
    adminUrl,
    dbName: name,
    pool,
    tenantDb,
    systemDb,
    clock,
    notifier,
    limiter,
    config,
    iam,
    async createTenant(slug, tenantName = slug) {
      const r = await admin.query(`INSERT INTO kernel.tenants (slug, name) VALUES ($1, $2) RETURNING id`, [slug, tenantName]);
      return r.rows[0].id as string;
    },
    ctx(tenantId, userId) {
      return userId
        ? createRequestContext({ tenantId, userId, actor: "user", roles: ["admin"] })
        : createRequestContext({ tenantId, actor: "system" });
    },
    async member(tenantId, email, roles, password = PASSWORD) {
      const out = await iam.provisionMember(h.ctx(tenantId), { email, roles, password, meta: meta() });
      if (!out.ok) throw out.error;
      return out.value;
    },
    async events(tenantId, type) {
      const r = await admin.query(
        `SELECT type, payload, actor_id FROM kernel.domain_events WHERE tenant_id = $1 ${type ? "AND type = $2" : ""} ORDER BY id`,
        type ? [tenantId, type] : [tenantId],
      );
      return r.rows;
    },
    async loginOk(email, over = {}) {
      const r = await iam.login({ email, password: over.password ?? PASSWORD, tenantSlug: over.tenantSlug, activeRole: over.activeRole, meta: meta(over.ip ? { ip: over.ip } : {}) });
      if (!r.ok) throw r.error;
      if (r.value.status !== "authenticated") throw new Error(`statut inattendu : ${r.value.status}`);
      return r.value;
    },
    async stop() {
      await iam.drainBackground().catch(() => undefined);
      await pool.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      try {
        await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await maintenance.query(`DROP ROLE IF EXISTS "${loginRole}"`);
      } finally {
        await maintenance.end().catch(() => undefined);
      }
    },
  };
  return h;
}
