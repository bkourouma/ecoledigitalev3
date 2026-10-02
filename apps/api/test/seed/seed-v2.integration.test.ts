/**
 * Seed v2 — intégration sur Postgres + Redis ÉPHÉMÈRES : le seed est rejoué pour de vrai (plateforme en processus, worker, API HTTP).
 *
 *  - refus : sans ALLOW_SEED, ou contre une base dont le nom n'est pas autorisé, RIEN n'est créé ;
 *  - HIGHER : jeu de données complet (structure, personnes, finances, emploi du temps, appels, notes) et comptes de test utilisables ;
 *  - IDEMPOTENCE : relancé sur le même établissement, il ne crée rien ;
 *  - DÉTERMINISME : un second établissement (autre slug) reçoit exactement les mêmes données métier (même empreinte) ;
 *  - PRIMARY et SECONDARY : la structure disponible est créée et le seed dit ce qui ne l'est pas.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../../../scripts/seed-v2/run";
import { SeedRefusedError } from "../../../../scripts/seed-v2/guards";
import { REDIS_URL, prepareInfra, type Infra } from "../phase1/support/harness";
import { describeIntegration } from "../helpers/fixtures";

const YEAR_START = "2026-09-01";

describeIntegration.skipIf(!REDIS_URL)("seed v2 — exécution réelle sur une base éphémère", () => {
  let infra: Infra;
  let env: NodeJS.ProcessEnv;
  const count = async (sql: string, params: unknown[] = []): Promise<number> => (await infra.db.admin.query(sql, params)).rows[0].n as number;

  beforeAll(async () => {
    infra = await prepareInfra();
    env = { ...process.env, ...infra.env, ALLOW_SEED: "1" };
  }, 300_000);
  afterAll(async () => {
    await infra?.db.drop();
    infra?.restoreEnv();
  });

  it("REFUSE sans ALLOW_SEED=1 et contre une base non autorisée : aucune connexion, aucun tenant", async () => {
    await expect(runSeed(["--pack", "HIGHER", "--slug", "refuse-un"], { env: { ...env, ALLOW_SEED: undefined } })).rejects.toBeInstanceOf(SeedRefusedError);
    const wrongName = infra.env.V2_DATABASE_URL!.replace(/\/[^/]+$/, "/ecole_production");
    await expect(runSeed(["--pack", "HIGHER", "--slug", "refuse-deux"], { env: { ...env, V2_DATABASE_URL: wrongName } })).rejects.toThrowError(/n'est pas autorisée/);
    expect(await count("SELECT count(*)::int AS n FROM kernel.tenants WHERE slug LIKE 'refuse-%'")).toBe(0);
  });

  let first: Awaited<ReturnType<typeof runSeed>>;
  it("HIGHER : établissement complet, comptes de test avec mots de passe générés à l'exécution", async () => {
    first = await runSeed({ pack: "HIGHER", seed: 20261001, slug: "demo-higher", yearStart: YEAR_START }, { env, log: () => undefined });
    expect(first.alreadySeeded).toBe(false);
    expect(first.counts).toMatchObject({ students: 12, guardians: 6, teachers: 3, enrollments: 12, enrollmentsActive: 8, invoices: 20, attendanceSessions: 2, assessments: 2, grades: 16 });
    expect(first.counts.occurrences).toBeGreaterThan(0);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const tenantId = first.tenantId as string;
    expect(await count("SELECT count(*)::int AS n FROM people.students WHERE tenant_id = $1", [tenantId])).toBe(12);
    expect(await count("SELECT count(*)::int AS n FROM academic.enrollments WHERE tenant_id = $1 AND status = 'ACTIVE'", [tenantId])).toBe(8);
    expect(await count("SELECT count(*)::int AS n FROM academic.enrollments WHERE tenant_id = $1 AND status = 'PENDING'", [tenantId])).toBe(4);
    expect(await count("SELECT count(*)::int AS n FROM academic.curriculum_versions WHERE tenant_id = $1 AND status = 'PUBLISHED'", [tenantId])).toBe(1);

    // Six comptes (propriétaire, direction, pédagogie, enseignant, tuteur, élève) : mots de passe distincts, conformes, non dérivés de l'e-mail.
    expect(first.accounts.map((a) => a.role).sort()).toEqual(["directeur", "eleve", "enseignant", "parent", "proprietaire", "responsable_pedagogique"]);
    const passwords = first.accounts.map((a) => a.password);
    expect(new Set(passwords).size).toBe(6);
    for (const a of first.accounts) {
      expect(a.password.length).toBeGreaterThanOrEqual(16);
      expect(a.password.toLowerCase()).not.toContain(a.email.split("@")[0]!.toLowerCase());
    }
    // Les rôles à MFA reçoivent leur secret TOTP (affiché une fois) ; les rôles de portail non.
    expect(first.accounts.filter((a) => a.totpSecret).map((a) => a.role).sort()).toEqual(["directeur", "proprietaire", "responsable_pedagogique"]);
  }, 300_000);

  it("les mots de passe générés fonctionnent : le tuteur se connecte (API publique) avec le mot de passe affiché", async () => {
    // Un second processus d'API sur la même base prouve que les comptes du seed sont utilisables par l'API réelle.
    const { bootInstance } = await import("../phase1/support/harness");
    const { resetRegistryForTests } = await import("../../src/modules/registry");
    const { resetPublicRoutesForTests } = await import("../../src/platform/public-routes");
    resetRegistryForTests();
    resetPublicRoutesForTests();
    const { app } = await bootInstance(infra, {});
    try {
      const parent = first.accounts.find((a) => a.role === "parent")!;
      const res = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: parent.email, password: parent.password, tenantSlug: "demo-higher", client: "mobile" } });
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.parse(res.body).status).toBe("authenticated");
      const wrong = await app.inject({ method: "POST", url: "/api/v1/iam/login", payload: { email: parent.email, password: `${parent.password}x`, tenantSlug: "demo-higher", client: "mobile" } });
      expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await app.close();
    }
  }, 120_000);

  it("IDEMPOTENCE : relancé sur le même établissement, le seed ne crée ni ne modifie rien", async () => {
    const before = {
      students: await count("SELECT count(*)::int AS n FROM people.students"),
      persons: await count("SELECT count(*)::int AS n FROM people.persons"),
      invoices: await count("SELECT count(*)::int AS n FROM finance.invoices"),
      members: await count("SELECT count(*)::int AS n FROM iam.memberships"),
      tenants: await count("SELECT count(*)::int AS n FROM kernel.tenants"),
    };
    const again = await runSeed({ pack: "HIGHER", seed: 20261001, slug: "demo-higher", yearStart: YEAR_START }, { env });
    expect(again.alreadySeeded).toBe(true);
    expect(again.accounts).toEqual([]);
    expect(again.tenantId).toBe(first.tenantId);
    expect({
      students: await count("SELECT count(*)::int AS n FROM people.students"),
      persons: await count("SELECT count(*)::int AS n FROM people.persons"),
      invoices: await count("SELECT count(*)::int AS n FROM finance.invoices"),
      members: await count("SELECT count(*)::int AS n FROM iam.memberships"),
      tenants: await count("SELECT count(*)::int AS n FROM kernel.tenants"),
    }).toEqual(before);
  }, 120_000);

  it("DÉTERMINISME : un second établissement HIGHER (autre slug, mêmes graine et année) a exactement les mêmes données métier", async () => {
    const second = await runSeed({ pack: "HIGHER", seed: 20261001, slug: "demo-higher-bis", yearStart: YEAR_START }, { env });
    expect(second.alreadySeeded).toBe(false);
    expect(second.tenantId).not.toBe(first.tenantId);
    expect(second.counts).toEqual(first.counts);
    expect(second.fingerprint).toBe(first.fingerprint);
    // Les secrets, eux, ne se répètent JAMAIS : d'un établissement à l'autre, les mots de passe générés sont tous différents.
    const reused = second.accounts.filter((a) => first.accounts.some((b) => b.password === a.password));
    expect(reused).toEqual([]);
    // Les mêmes noms d'élèves et numéros d'inscription dans les deux tenants.
    const names = async (tenantId: string): Promise<string[]> =>
      (await infra.db.admin.query("SELECT p.last_name || '|' || p.first_name || '|' || p.birth_date::text AS k FROM people.students s JOIN people.persons p ON p.id = s.person_id WHERE s.tenant_id = $1 ORDER BY s.sequence_number", [tenantId])).rows.map((r) => r.k as string);
    expect(await names(second.tenantId as string)).toEqual(await names(first.tenantId as string));
  }, 300_000);

  it("une graine différente change les données métier (la graine est bien l'unique source d'aléa)", async () => {
    const other = await runSeed({ pack: "HIGHER", seed: 7, slug: "demo-higher-ter", yearStart: YEAR_START }, { env });
    expect(other.fingerprint).not.toBe(first.fingerprint);
  }, 300_000);

  for (const pack of ["PRIMARY", "SECONDARY"] as const) {
    it(`${pack} : la structure disponible est créée et le seed indique ce qui ne l'est pas`, async () => {
      const report = await runSeed({ pack, seed: 20261001, slug: `demo-${pack.toLowerCase()}`, yearStart: YEAR_START }, { env });
      expect(report.alreadySeeded).toBe(false);
      // Primaire : appel journalier (politique du cycle) => aucun appel par séance, et le seed le dit.
      expect(report.counts).toMatchObject({ students: 12, enrollments: 12, enrollmentsActive: 8, periods: 3, attendanceSessions: pack === "PRIMARY" ? 0 : 2 });
      if (pack === "PRIMARY") expect(report.notes.join(" ")).toMatch(/journalière/);
      expect(report.notes.join(" ")).toMatch(/STRUCTURE disponible/);
      expect(report.notes.join(" ")).toMatch(/aucun résultat/);
      expect(report.accounts).toHaveLength(6);
    }, 300_000);
  }
});
