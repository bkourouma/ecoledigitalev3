/**
 * `pnpm iam:import-legacy` prouvé sur une base legacy PEUPLÉE PAR LES SEEDS DE `tests/characterization`
 * (schéma legacy réel : chaîne Prisma + migrations SQL, scénario `bts-premiere-annee` : établissement, administrateur,
 * étudiants, enseignants), enrichie des cas ambigus qu'un vrai parc contient. Aucune donnée de production.
 *
 *   pnpm --filter @ecoledigitale/api test:auth-import
 */
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noopLogger } from "@ecoledigitale/kernel";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configureTenantSync } from "../../src/platform/tenant-sync";
import { resetPublicRoutesForTests } from "../../src/platform/public-routes";
import { resetRegistryForTests } from "../../src/modules/registry";
import { createImportRuntime, runImportCli } from "../../src/platform/legacy-import-runtime";
import { importLegacyUsers, openLegacyPool, type ImportReport } from "../../src/platform/legacy-import";
import { registerV2Platform } from "../../src/platform/v2-bootstrap";
import { createLoginRole } from "../../src/platform/v2-login-role";
import { runV2Migrations } from "../../src/platform/v2-migrations";
import { createEphemeralDb, describeIntegration, randomSuffix, type EphemeralDb } from "../helpers/fixtures";
import { randomBytes } from "node:crypto";

// Le harnais de caractérisation n'est pas écrit pour les options strictes du programme TypeScript de la plateforme v2 :
// il est chargé à l'exécution (comme `legacyModule` des tests de phase 1), sans entrer dans ce programme.
const here = dirname(fileURLToPath(import.meta.url));
async function characterization<T>(relative: string): Promise<T> {
  return (await import(/* @vite-ignore */ pathToFileURL(resolve(here, "../../../../tests/characterization", relative)).href)) as T;
}
interface ScenarioDatabase {
  name: string;
  url: string;
  pool: Pool;
  drop(): Promise<void>;
}
type CharacterizationScenario = { tenant: { slug: string; name: string } };
const { createScenarioDatabase, createTemplateDatabase, dropDatabase } = await characterization<{
  createScenarioDatabase(templateName: string, label: string): Promise<ScenarioDatabase>;
  createTemplateDatabase(): Promise<{ name: string }>;
  dropDatabase(name: string): Promise<void>;
}>("harness/db.ts");
const { seedBase } = await characterization<{ seedBase(pool: Pool, scenario: CharacterizationScenario): Promise<unknown> }>("harness/seeder.ts");
const { scenarios } = await characterization<{ scenarios: Record<string, CharacterizationScenario> }>("scenarios/index.ts");

const scenario = scenarios["bts-premiere-annee"] as CharacterizationScenario;
const LEGACY_PASSWORD = `Legacy-${randomBytes(9).toString("base64url")}-7x`;
const TECHNICAL_PASSWORD = `Tech-${randomBytes(9).toString("base64url")}-7x`;
const rand = (n = 16): string => randomBytes(n).toString("hex");

describeIntegration("import des utilisateurs legacy vers iam (base legacy issue des seeds de caractérisation)", () => {
  let templateName: string;
  let legacyDb: ScenarioDatabase;
  let v2Db: EphemeralDb;
  let app: FastifyInstance;
  let appUrl: string;
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  const email = (local: string): string => `${local}@${scenario.tenant.slug}.test`;
  const saved = { ...process.env };

  const legacy = (): Pool => legacyDb.pool;
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await legacy().query(sql, params)).rows as T[];

  async function addUser(tenantId: string, mail: string, opts: { roles?: string[]; hash?: string | null; active?: boolean; technical?: boolean; createdAt?: string; name?: string } = {}): Promise<string> {
    const r = await q<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, first_name, last_name, password_hash, is_active, is_technical_account, created_at, updated_at)
       VALUES ($1, $2, $3, 'Prénom', 'Nom', $4, $5, $6, COALESCE($7::timestamptz, now()), now()) RETURNING id`,
      [tenantId, mail, opts.name ?? mail, opts.hash === undefined ? bcrypt.hashSync(LEGACY_PASSWORD, 4) : opts.hash, opts.active ?? true, opts.technical ?? false, opts.createdAt ?? null],
    );
    const id = (r[0] as { id: string }).id;
    for (const role of opts.roles ?? []) await grantLegacyRole(tenantId, id, role);
    return id;
  }

  async function ensureRole(key: string): Promise<string> {
    const found = await q<{ id: string }>("SELECT id FROM roles WHERE key = $1 LIMIT 1", [key]);
    if (found[0]) return found[0].id;
    return ((await q<{ id: string }>("INSERT INTO roles (key, name, is_active, is_system) VALUES ($1, $1, true, false) RETURNING id", [key]))[0] as { id: string }).id;
  }

  async function grantLegacyRole(tenantId: string, userId: string, key: string): Promise<void> {
    const roleId = await ensureRole(key);
    await legacy().query("INSERT INTO user_roles (tenant_id, user_id, role_id, created_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING", [tenantId, userId, roleId]);
  }

  /** Empreinte des tables legacy lues par l'import : prouve qu'il n'écrit rien. */
  async function legacyChecksum(): Promise<string> {
    const h = createHash("sha256");
    for (const table of ["users", "user_roles", "roles", "tenants"]) {
      const rows = (await legacy().query(`SELECT t::text AS r FROM ${table} t ORDER BY 1`)).rows as Array<{ r: string }>;
      h.update(table + rows.map((x) => x.r).join("\n"));
    }
    return h.digest("hex");
  }

  const iamRows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await v2Db.admin.query(sql, params)).rows as T[];
  const membership = async (tenantId: string, mail: string) =>
    (await iamRows<{ identity_id: string; roles: string[]; status: string; base_role: string }>(
      "SELECT m.identity_id, m.roles, m.status, m.base_role FROM iam.memberships m JOIN iam.identities i ON i.id = m.identity_id WHERE m.tenant_id = $1 AND i.email = $2",
      [tenantId, mail.toLowerCase()],
    ))[0];
  const templatesOf = async (tenantId: string, identityId: string): Promise<string[]> =>
    (
      await iamRows<{ template_key: string }>(
        "SELECT r.template_key FROM rbac.user_role_assignments a JOIN rbac.roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id WHERE a.tenant_id = $1 AND a.user_id = $2 ORDER BY 1",
        [tenantId, identityId],
      )
    ).map((r) => r.template_key);

  const kindsOf = (report: ImportReport): string[] => [...new Set(report.ambiguities.map((a) => a.kind))].sort();
  const ambiguity = (report: ImportReport, kind: string, mail?: string) => report.ambiguities.find((a) => a.kind === kind && (mail === undefined || a.email === mail));

  beforeAll(async () => {
    // 1. Base LEGACY : schéma réel + seeds de caractérisation.
    templateName = (await createTemplateDatabase()).name;
    legacyDb = await createScenarioDatabase(templateName, "iam_import");
    await seedBase(legacy(), scenario);
    tenantA = (await q<{ id: string; slug: string }>("SELECT id, slug FROM tenants WHERE slug = $1", [scenario.tenant.slug]))[0] as typeof tenantA;
    tenantB = (await q<{ id: string; slug: string }>("INSERT INTO tenants (slug, name, settings_json) VALUES ('ecole-b', 'École B', '{}') RETURNING id, slug"))[0] as typeof tenantB;

    // 2. Cas d'un vrai parc, en plus des utilisateurs du scénario.
    const adminId = (await q<{ id: string }>("SELECT id FROM users WHERE email = $1", [email("admin")]))[0]!.id;
    await legacy().query("UPDATE users SET password_hash = $2 WHERE id = $1", [adminId, bcrypt.hashSync(LEGACY_PASSWORD, 4)]);
    await grantLegacyRole(tenantA.id, adminId, "admin");
    const firstTeacher = (await q<{ id: string; email: string }>("SELECT u.id, u.email FROM users u JOIN teachers t ON t.user_id = u.id WHERE u.tenant_id = $1 ORDER BY u.email LIMIT 1", [tenantA.id]))[0]!;
    await legacy().query("UPDATE users SET password_hash = $2 WHERE id = $1", [firstTeacher.id, bcrypt.hashSync(LEGACY_PASSWORD, 4)]);
    await grantLegacyRole(tenantA.id, firstTeacher.id, "parent"); // enseignant ET parent
    const firstStudent = (await q<{ id: string; email: string }>("SELECT u.id, u.email FROM users u JOIN student_profiles s ON s.user_id = u.id WHERE u.tenant_id = $1 ORDER BY u.email LIMIT 1", [tenantA.id]))[0]!;
    await legacy().query("UPDATE users SET password_hash = $2 WHERE id = $1", [firstStudent.id, bcrypt.hashSync(LEGACY_PASSWORD, 4)]);

    await addUser(tenantA.id, email("proprio"), { roles: ["owner"] });
    await addUser(tenantA.id, email("comptable"), { roles: ["comptable"] }); // rôle personnalisé
    await addUser(tenantA.id, email("social"), { roles: ["student"], hash: "" }); // connexion sociale : pas de mot de passe
    await addUser(tenantA.id, email("inactif"), { roles: ["teacher"], active: false });
    await addUser(tenantA.id, email("sansrole"), {});
    await addUser(tenantA.id, "pas-un-email", { roles: ["student"] });
    await addUser(tenantA.id, email("operateur"), { roles: ["admin", "super_admin"] });
    await addUser(tenantA.id, "Dup@x.test", { roles: ["student"], createdAt: "2024-01-01T00:00:00Z" });
    await addUser(tenantA.id, "dup@x.test", { roles: ["student"], createdAt: "2024-06-01T00:00:00Z" });
    await addUser(tenantA.id, "partage@x.test", { roles: ["teacher"], createdAt: "2023-01-01T00:00:00Z" });
    await addUser(tenantB.id, "Partage@X.test", { roles: ["teacher"], createdAt: "2025-01-01T00:00:00Z", hash: bcrypt.hashSync("Autre-Mot-De-Passe-9", 4) });
    await addUser(tenantA.id, `admin@${scenario.tenant.slug}.local`, { roles: ["admin"], technical: true, hash: bcrypt.hashSync("ancien-defaut-technique", 4) });

    // 3. Base v2 migrée, rôle applicatif, plateforme assemblée (synchronisation des tenants + rôles système, comme la production).
    process.env.JWT_SECRET = rand(24);
    process.env.SUPER_ADMIN_JWT_SECRET = rand(24);
    delete process.env.REDIS_URL;
    resetRegistryForTests();
    resetPublicRoutesForTests();
    const roleName = `ed_imp_${randomSuffix()}`;
    v2Db = await createEphemeralDb("iam_import_test", [roleName]);
    await runV2Migrations({ url: v2Db.adminUrl, logger: noopLogger });
    appUrl = (await createLoginRole({ adminUrl: v2Db.adminUrl, role: roleName })).applicationUrl;
    app = Fastify({ logger: false });
    app.decorate("pg", legacy() as never);
    await registerV2Platform(app, {
      env: {
        NODE_ENV: "test", V2_DATABASE_URL: appUrl, IAM_JWT_SECRET: rand(32), IAM_MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        IAM_SCRYPT_LOG_N: "10", IAM_COOKIE_SECURE: "false", IAM_MFA_REQUIRED_ROLES: "owner,admin", AUDIT_HMAC_KEY: rand(16),
      } as NodeJS.ProcessEnv,
      legacyPool: legacy() as never,
    });
    await app.ready();
  }, 600_000);

  afterAll(async () => {
    configureTenantSync(null);
    await app?.close().catch(() => undefined);
    await v2Db?.drop();
    await legacyDb?.drop();
    if (templateName) await dropDatabase(templateName);
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  const runtimeFor = () => createImportRuntime({ legacyUrl: legacyDb.url, v2Url: appUrl, logger: noopLogger });

  let before: string;
  let first: ImportReport;

  it("simulation (--dry-run) : rapport complet, RIEN n'est écrit (ni iam, ni rbac, ni legacy)", async () => {
    before = await legacyChecksum();
    const rt = await runtimeFor();
    try {
      const dry = await importLegacyUsers(rt.deps, { dryRun: true });
      expect(dry.dryRun).toBe(true);
      expect(dry.totals.membershipsCreated).toBeGreaterThan(10);
      expect(dry.totals.identitiesCreated).toBeGreaterThan(10);
      expect(dry.totals.assignmentsGranted).toBeGreaterThan(10);
    } finally {
      await rt.close();
    }
    expect((await iamRows<{ n: number }>("SELECT count(*)::int AS n FROM iam.identities"))[0]!.n).toBe(0);
    expect((await iamRows<{ n: number }>("SELECT count(*)::int AS n FROM iam.memberships"))[0]!.n).toBe(0);
    expect((await iamRows<{ n: number }>("SELECT count(*)::int AS n FROM rbac.user_role_assignments"))[0]!.n).toBe(0);
    expect(await legacyChecksum()).toBe(before);
  });

  it("import réel : identités, accès, rôles = ceux du login legacy, assignations RBAC par legacyRoleToTemplate", async () => {
    const rt = await runtimeFor();
    try {
      first = await importLegacyUsers(rt.deps, {});
    } finally {
      await rt.close();
    }
    expect(first.dryRun).toBe(false);
    expect(first.totals.membershipsCreated).toBeGreaterThan(10);
    expect(first.tenants.every((t) => t.status === "imported")).toBe(true);

    // Administrateur : rôle legacy `admin` conservé dans l'accès, trois modèles RBAC.
    const admin = (await membership(tenantA.id, email("admin")))!;
    expect(admin.roles).toEqual(["admin"]);
    expect(await templatesOf(tenantA.id, admin.identity_id)).toEqual(["directeur", "econome", "secretariat"]);
    // Propriétaire.
    const owner = (await membership(tenantA.id, email("proprio")))!;
    expect(owner.roles).toEqual(["owner"]);
    expect(await templatesOf(tenantA.id, owner.identity_id)).toEqual(["owner"]);
    // Enseignant déduit du profil + parent explicite : deux rôles, deux modèles ; le rôle de base suit la priorité legacy.
    const teacher = (await membership(tenantA.id, (await q<{ email: string }>("SELECT u.email FROM users u JOIN teachers t ON t.user_id = u.id WHERE u.tenant_id = $1 ORDER BY u.email LIMIT 1", [tenantA.id]))[0]!.email))!;
    expect([...teacher.roles].sort()).toEqual(["parent", "teacher"]);
    expect(teacher.base_role).toBe("teacher");
    expect(await templatesOf(tenantA.id, teacher.identity_id)).toEqual(["enseignant", "parent"]);
    // Étudiant déduit du profil.
    const student = (await q<{ email: string }>("SELECT u.email FROM users u JOIN student_profiles s ON s.user_id = u.id WHERE u.tenant_id = $1 ORDER BY u.email LIMIT 1", [tenantA.id]))[0]!.email;
    expect((await membership(tenantA.id, student))!.roles).toEqual(["student"]);
    // Rôle personnalisé : conservé, aucune assignation RBAC.
    const custom = (await membership(tenantA.id, email("comptable")))!;
    expect(custom.roles).toEqual(["comptable"]);
    expect(await templatesOf(tenantA.id, custom.identity_id)).toEqual([]);
    // Opérateur : super_admin ignoré, admin conservé.
    expect((await membership(tenantA.id, email("operateur")))!.roles).toEqual(["admin"]);
  });

  it("cas ambigus rapportés, jamais devinés ; le rapport ne contient ni hash ni mot de passe", () => {
    expect(kindsOf(first)).toEqual(
      expect.arrayContaining(["duplicate_in_tenant", "inactive_user", "invalid_email", "no_password_hash", "no_roles", "role_ignored", "shared_email", "technical_account_skipped", "unknown_role", "unusable_password_hash"]),
    );
    expect(ambiguity(first, "shared_email", "partage@x.test")).toBeDefined();
    expect(ambiguity(first, "duplicate_in_tenant", "dup@x.test")).toBeDefined();
    expect(ambiguity(first, "unknown_role", email("comptable"))).toBeDefined();
    expect(ambiguity(first, "technical_account_skipped")?.detail).toContain("IAM_IMPORT_TECHNICAL_PASSWORD");
    const text = JSON.stringify(first);
    expect(text).not.toMatch(/\$2[aby]\$/);
    expect(text).not.toContain(LEGACY_PASSWORD);
    expect(text).not.toContain("ancien-defaut-technique");
  });

  it("aucun compte ignoré n'a d'accès ; e-mail partagé : UNE identité, deux accès ; doublon de casse : le plus ancien seulement", async () => {
    for (const mail of [email("inactif"), email("sansrole"), "pas-un-email"]) {
      expect(await membership(tenantA.id, mail), mail).toBeUndefined();
    }
    expect(await membership(tenantA.id, `admin@${scenario.tenant.slug}.local`)).toBeUndefined(); // compte technique sans mot de passe fourni
    const a = await membership(tenantA.id, "partage@x.test");
    const b = await membership(tenantB.id, "partage@x.test");
    expect(a && b).toBeTruthy();
    expect(a!.identity_id).toBe(b!.identity_id);
    expect((await iamRows<{ n: number }>("SELECT count(*)::int AS n FROM iam.identities WHERE email = 'partage@x.test'"))[0]!.n).toBe(1);
    expect(await membership(tenantA.id, "dup@x.test")).toBeDefined();
    expect((await iamRows<{ n: number }>("SELECT count(*)::int AS n FROM iam.memberships m JOIN iam.identities i ON i.id = m.identity_id WHERE i.email = 'dup@x.test'"))[0]!.n).toBe(1);
  });

  it("idempotent : une seconde exécution ne crée ni accès, ni identité, ni assignation", async () => {
    const countRows = async (): Promise<string> =>
      JSON.stringify(await iamRows("SELECT (SELECT count(*) FROM iam.identities) AS i, (SELECT count(*) FROM iam.memberships) AS m, (SELECT count(*) FROM rbac.user_role_assignments) AS a"));
    const before2 = await countRows();
    const rt = await runtimeFor();
    let second: ImportReport;
    try {
      second = await importLegacyUsers(rt.deps, {});
    } finally {
      await rt.close();
    }
    expect(second.totals.membershipsCreated).toBe(0);
    expect(second.totals.identitiesCreated).toBe(0);
    expect(second.totals.assignmentsGranted).toBe(0);
    expect(second.totals.membershipsExisting).toBe(first.totals.membershipsCreated);
    expect(second.totals.assignmentsExisting).toBe(first.totals.assignmentsGranted);
    expect(await countRows()).toBe(before2);
  });

  it("les hash bcrypt sont conservés puis re-hachés (scrypt) au premier login réussi ; un compte sans mot de passe ne se connecte pas", async () => {
    const mail = (await q<{ email: string }>("SELECT u.email FROM users u JOIN student_profiles s ON s.user_id = u.id WHERE u.tenant_id = $1 ORDER BY u.email LIMIT 1", [tenantA.id]))[0]!.email;
    const stored = async () => (await iamRows<{ password_hash: string }>("SELECT password_hash FROM iam.identities WHERE email = $1", [mail]))[0]!.password_hash;
    expect(await stored()).toMatch(/^\$2[aby]\$/);

    const wrong = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: mail, password: "Un-Mauvais-Mot-De-Passe-9", tenantSlug: tenantA.slug, client: "mobile" } });
    expect(wrong.statusCode).toBe(401);
    expect(await stored()).toMatch(/^\$2[aby]\$/); // un échec ne re-hache pas

    const ok = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: mail, password: LEGACY_PASSWORD, tenantSlug: tenantA.slug, client: "mobile" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(JSON.parse(ok.body).status).toBe("authenticated");
    expect(await stored()).toMatch(/^\$scrypt\$/);

    // Administrateur : mot de passe legacy valide -> la MFA (rôle sensible) est exigée, aucune session sans enrôlement.
    const admin = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: email("admin"), password: LEGACY_PASSWORD, tenantSlug: tenantA.slug, client: "mobile" } });
    expect(JSON.parse(admin.body).status).toBe("mfa_enrollment_required");

    // Sans mot de passe (connexion sociale) : aucun mot de passe ne fonctionne, aucune invitation n'a été envoyée.
    const social = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: email("social"), password: LEGACY_PASSWORD, tenantSlug: tenantA.slug, client: "mobile" } });
    expect(social.statusCode).toBe(401);
    expect((await iamRows<{ n: number }>("SELECT count(*)::int AS n FROM iam.password_reset_tokens"))[0]!.n).toBe(0);
  });

  it("e-mail partagé : le mot de passe du compte LE PLUS ANCIEN est celui de l'identité unique", async () => {
    const oldest = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: "partage@x.test", password: LEGACY_PASSWORD, tenantSlug: "ecole-b", client: "mobile" } });
    expect(oldest.statusCode, oldest.body).toBe(200);
    expect(JSON.parse(oldest.body).user.tenantSlug).toBe("ecole-b");
    const other = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: "partage@x.test", password: "Autre-Mot-De-Passe-9", tenantSlug: tenantA.slug, client: "mobile" } });
    expect(other.statusCode).toBe(401);
  });

  it("comptes techniques : importés SEULEMENT avec un mot de passe fourni par l'environnement, jamais leur hash legacy", async () => {
    const mail = `admin@${scenario.tenant.slug}.local`;
    const rt = await runtimeFor();
    let report: ImportReport;
    try {
      report = await importLegacyUsers(rt.deps, { technicalPassword: TECHNICAL_PASSWORD });
    } finally {
      await rt.close();
    }
    expect(ambiguity(report, "technical_account_imported", mail)).toBeDefined();
    const m = await membership(tenantA.id, mail);
    expect(m?.roles).toEqual(["admin"]);
    const hash = (await iamRows<{ password_hash: string }>("SELECT password_hash FROM iam.identities WHERE email = $1", [mail]))[0]!.password_hash;
    expect(hash).toMatch(/^\$scrypt\$/); // posé par iam avec le mot de passe fourni ; pas le bcrypt legacy
    expect(JSON.stringify(report)).not.toContain(TECHNICAL_PASSWORD);
    // L'ancien mot de passe technique (potentiellement connu) ne fonctionne pas ; le nouveau, oui (jusqu'à la MFA des admins).
    const old = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: mail, password: "ancien-defaut-technique", tenantSlug: tenantA.slug, client: "mobile" } });
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: mail, password: TECHNICAL_PASSWORD, tenantSlug: tenantA.slug, client: "mobile" } });
    expect(JSON.parse(fresh.body).status).toBe("mfa_enrollment_required");
  });

  it("l'import ne modifie JAMAIS le legacy : empreinte identique, et la connexion legacy est en lecture seule", async () => {
    // Les tables lues n'ont pas changé depuis la simulation (les ajouts de rôles/utilisateurs du test précèdent `before`).
    expect(await legacyChecksum()).toBe(before);
    const pool = await openLegacyPool(legacyDb.url);
    try {
      await expect(pool.query("UPDATE users SET name = name")).rejects.toThrow(/read-only/i);
      await expect(pool.query("DELETE FROM user_roles")).rejects.toThrow(/read-only/i);
    } finally {
      await pool.end();
    }
  });

  it("établissement absent de kernel.tenants ou limité par --tenant", async () => {
    const orphan = (await q<{ id: string }>("INSERT INTO tenants (slug, name, settings_json) VALUES ('orphelin', 'Orphelin', '{}') RETURNING id"))[0]!.id;
    await addUser(orphan, "orphelin@x.test", { roles: ["teacher"] });
    const rt = await runtimeFor();
    try {
      const all = await importLegacyUsers(rt.deps, { dryRun: true });
      expect(all.tenants.find((t) => t.slug === "orphelin")).toMatchObject({ status: "skipped", skipReason: "tenant_not_in_v2" });
      expect(ambiguity(all, "tenant_not_in_v2")?.detail).toMatch(/démarrez l'API/);
      const only = await importLegacyUsers(rt.deps, { dryRun: true, tenantSlug: "ecole-b" });
      expect(only.tenants.map((t) => t.slug)).toEqual(["ecole-b"]);
    } finally {
      await rt.close();
    }
  });

  it("ligne de commande : --dry-run, rapport JSON (droits restreints), variables obligatoires", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "iam-import-"));
    const reportFile = join(dir, "rapport.json");
    try {
      expect(await runImportCli(["--dry-run", "--report", reportFile, "--tenant", "ecole-b"], {} as NodeJS.ProcessEnv)).toBe(2); // URLs manquantes
      const code = await runImportCli(["--dry-run", "--report", reportFile, "--tenant", "ecole-b"], { LEGACY_DATABASE_URL: legacyDb.url, V2_DATABASE_URL: appUrl } as NodeJS.ProcessEnv);
      expect(code).toBe(0);
      const parsed = JSON.parse(readFileSync(reportFile, "utf8")) as ImportReport;
      expect(parsed.dryRun).toBe(true);
      expect(parsed.tenants.map((t) => t.slug)).toEqual(["ecole-b"]);
      expect(await runImportCli(["--help"], {} as NodeJS.ProcessEnv)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("un rôle de connexion v2 inacceptable (superuser) est refusé comme à l'API", async () => {
    await expect(createImportRuntime({ legacyUrl: legacyDb.url, v2Url: v2Db.adminUrl, logger: noopLogger })).rejects.toThrow(/SUPERUSER|refusé/i);
  });
});
