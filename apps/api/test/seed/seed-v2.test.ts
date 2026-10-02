/**
 * Seed v2 — parties PURES (sans base de données) : garde-fous, arguments, jeu de données déterministe.
 */
import { describe, expect, it } from "vitest";
import { buildDataset, createPrng, defaultYearStart, STUDENT_COUNT } from "../../../../scripts/seed-v2/dataset";
import { assertSeedAllowed, assertSeedEnvironment, databaseNameOf, parseSeedArgs, SeedRefusedError } from "../../../../scripts/seed-v2/guards";

const URL_OF = (db: string): string => `postgres://ed_v2_app@localhost:5432/${db}`;

describe("seed v2 — garde-fous (refus par défaut)", () => {
  it("refuse sans ALLOW_SEED=1, même sur une base _dev", () => {
    expect(() => assertSeedAllowed({}, URL_OF("ecole_dev"))).toThrowError(/ALLOW_SEED=1/);
    expect(() => assertSeedAllowed({ ALLOW_SEED: "true" }, URL_OF("ecole_dev"))).toThrowError(SeedRefusedError);
    expect(() => assertSeedAllowed({ ALLOW_SEED: "0" }, URL_OF("ecole_dev"))).toThrowError(SeedRefusedError);
  });

  it("refuse toute base dont le nom ne finit pas par _dev, _test ou _local (production, noms trompeurs, suffixe au milieu)", () => {
    for (const db of ["ecole", "ecole_prod", "ecole_production", "ecole_dev_backup", "dev", "ecole-dev", "ecole_devx", "prod_test_ecole", "ecole_TEST"]) {
      expect(() => assertSeedAllowed({ ALLOW_SEED: "1" }, URL_OF(db)), db).toThrowError(/n'est pas autorisée/);
    }
  });

  it("accepte _dev, _test et _local avec ALLOW_SEED=1 et renvoie le nom de la base", () => {
    for (const db of ["ecole_dev", "ecole_test", "ecole_local", "ed_api_ab12_test"]) {
      expect(assertSeedAllowed({ ALLOW_SEED: "1" }, URL_OF(db))).toBe(db);
    }
  });

  it("refuse en NODE_ENV=production, sans URL, avec une URL illisible ou d'un autre protocole", () => {
    expect(() => assertSeedAllowed({ ALLOW_SEED: "1", NODE_ENV: "production" }, URL_OF("ecole_dev"))).toThrowError(/production/);
    expect(() => assertSeedAllowed({ ALLOW_SEED: "1" }, undefined)).toThrowError(/V2_DATABASE_URL/);
    expect(() => assertSeedAllowed({ ALLOW_SEED: "1" }, "pas une url")).toThrowError(SeedRefusedError);
    expect(() => assertSeedAllowed({ ALLOW_SEED: "1" }, "mysql://u:p@h/ecole_dev")).toThrowError(SeedRefusedError);
    expect(databaseNameOf("postgres://h:5432/")).toBeNull();
  });

  it("les secrets de l'API et Redis sont exigés (les secrets MFA créés doivent être ceux de l'API)", () => {
    expect(() => assertSeedEnvironment({})).toThrowError(/IAM_MFA_ENCRYPTION_KEY/);
    expect(() => assertSeedEnvironment({ V2_DATABASE_URL: "x", REDIS_URL: "x", IAM_JWT_SECRET: "x", IAM_MFA_ENCRYPTION_KEY: "x", AUDIT_HMAC_KEY: "x" })).not.toThrow();
  });
});

describe("seed v2 — arguments", () => {
  it("--pack est obligatoire et limité à HIGHER, PRIMARY, SECONDARY (insensible à la casse)", () => {
    expect(() => parseSeedArgs([])).toThrowError(/--pack/);
    expect(() => parseSeedArgs(["--pack", "VIRTUAL"])).toThrowError(/--pack/);
    expect(parseSeedArgs(["--pack", "higher"]).pack).toBe("HIGHER");
    expect(parseSeedArgs(["--", "--pack=PRIMARY"]).pack).toBe("PRIMARY");
  });

  it("valeurs par défaut stables ; options inconnues, graine, slug et date invalides refusés", () => {
    expect(parseSeedArgs(["--pack", "SECONDARY"])).toEqual({ pack: "SECONDARY", seed: 20261001, slug: "demo-secondary", yearStart: null });
    expect(() => parseSeedArgs(["--pack", "HIGHER", "--force"])).toThrowError(/inconnue/);
    expect(() => parseSeedArgs(["--pack", "HIGHER", "--seed", "-3"])).toThrowError(/--seed/);
    expect(() => parseSeedArgs(["--pack", "HIGHER", "--slug", "Mauvais Slug"])).toThrowError(/--slug/);
    expect(() => parseSeedArgs(["--pack", "HIGHER", "--year-start", "2026-13-45"])).toThrowError(/--year-start/);
    expect(parseSeedArgs(["--pack", "HIGHER", "--year-start", "2026-09-01", "--seed", "7"])).toMatchObject({ seed: 7, yearStart: "2026-09-01" });
  });
});

describe("seed v2 — jeu de données déterministe", () => {
  const input = { pack: "HIGHER", seed: 20261001, slug: "demo-higher", yearStart: "2026-09-01" } as const;

  it("mêmes paramètres = exactement le même jeu de données ; autre graine = autres données", () => {
    expect(buildDataset(input)).toEqual(buildDataset(input));
    expect(buildDataset({ ...input, seed: 1 }).students).not.toEqual(buildDataset(input).students);
  });

  it("noms uniques par construction (aucun doublon probable), fratries de deux, e-mails sous .test, aucun mot de passe", () => {
    for (const pack of ["HIGHER", "PRIMARY", "SECONDARY"] as const) {
      const d = buildDataset({ ...input, pack });
      expect(d.students).toHaveLength(STUDENT_COUNT);
      expect(new Set(d.students.map((s) => `${s.lastName}|${s.firstName}|${s.birthDate}`)).size).toBe(STUDENT_COUNT);
      const persons = [...d.students, ...d.guardians, ...d.teachers].map((p) => `${p.lastName}|${p.firstName}`);
      expect(new Set(persons).size, "aucun couple nom-prénom répété entre élèves, tuteurs et enseignants").toBe(persons.length);
      expect(d.guardians).toHaveLength(STUDENT_COUNT / 2);
      for (const g of d.guardians) expect(d.students.filter((s) => s.guardian === d.guardians.indexOf(g))).toHaveLength(2);
      const mails = [...Object.values(d.accounts), ...d.guardians.map((g) => g.email), ...d.teachers.map((t) => t.email)];
      for (const m of mails) expect(m).toMatch(/@demo-higher\.test$/);
      expect(JSON.stringify(d)).not.toMatch(/password|motdepasse|mot de passe/i);
      expect(d.yearCode).toBe("2026-2027");
      expect(d.yearEnd).toBe("2027-08-31");
    }
  });

  it("l'année par défaut est le 1er septembre de l'année scolaire en cours ; le PRNG est reproductible", () => {
    expect(defaultYearStart(new Date("2026-10-02T10:00:00Z"))).toBe("2026-09-01");
    expect(defaultYearStart(new Date("2027-03-15T10:00:00Z"))).toBe("2026-09-01");
    expect(defaultYearStart(new Date("2027-08-31T10:00:00Z"))).toBe("2027-09-01");
    const a = createPrng(42);
    const b = createPrng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
