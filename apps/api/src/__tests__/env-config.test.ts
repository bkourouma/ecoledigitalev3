import { isWeakSecret, validateEnv } from "../config/env";

// 48 caractères variés, sans fragment faible : un secret acceptable.
const STRONG = "k3Jx9QvR7mTz2LpWb8NfYd5HsGa1CuEo4XiVr6ZtMq0BjAn";
const DB = "postgresql://app:<mot-de-passe>@localhost:5432/db";

function base(overrides: Record<string, string | undefined> = {}) {
  return { DATABASE_URL: DB, JWT_SECRET: STRONG, NODE_ENV: "production", ...overrides };
}

describe("config/env — isWeakSecret", () => {
  it.each([
    "",
    "   ",
    "your-super-secret-jwt-key-change-in-production",
    "your-secret-key-here-change-in-production",
    "CHANGE_ME_random_64_bytes",
    "replace-with-at-least-32-random-characters",
    "<secret-aleatoire-32-caracteres-minimum>",
    "test-jwt-secret",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "Password@2025-Password@2025-Password",
  ])("refuse la valeur faible %#", (value) => {
    expect(isWeakSecret(value)).toBe(true);
  });

  it("accepte un secret aléatoire", () => {
    expect(isWeakSecret(STRONG)).toBe(false);
  });
});

describe("config/env — validateEnv", () => {
  it("accepte une configuration de production correcte", () => {
    const result = validateEnv(base());
    expect(result.ok).toBe(true);
  });

  it("refuse l'absence de JWT_SECRET (tous environnements)", () => {
    for (const NODE_ENV of ["production", "development"]) {
      const result = validateEnv(base({ JWT_SECRET: undefined, NODE_ENV }));
      expect(result.ok).toBe(false);
    }
  });

  it("refuse l'absence de DATABASE_URL", () => {
    const result = validateEnv(base({ DATABASE_URL: undefined }));
    expect(result.ok).toBe(false);
  });

  it("refuse en production un JWT_SECRET trop court ou connu", () => {
    expect(validateEnv(base({ JWT_SECRET: "k3Jx9QvR7mTz" })).ok).toBe(false);
    expect(validateEnv(base({ JWT_SECRET: "your-super-secret-jwt-key-change-in-production" })).ok).toBe(false);
  });

  it("traite un NODE_ENV inconnu (staging) comme la production", () => {
    expect(validateEnv(base({ NODE_ENV: "staging", JWT_SECRET: "short-but-not-listed-k3Jx" })).ok).toBe(false);
  });

  it("refuse en production un SUPER_ADMIN_JWT_SECRET faible", () => {
    expect(validateEnv(base({ SUPER_ADMIN_JWT_SECRET: "change-me-please-change-me-please-123" })).ok).toBe(false);
  });

  it("tolère hors production un secret faible, avec avertissement", () => {
    const result = validateEnv(base({ NODE_ENV: "development", JWT_SECRET: "dev-secret-short" }));
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("n'inclut jamais la valeur du secret dans les messages", () => {
    const secret = "your-super-secret-jwt-key-change-in-production";
    const result = validateEnv(base({ JWT_SECRET: secret }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).not.toContain(secret);
    }
  });

  it("refuse un mot de passe technique trivial en production", () => {
    expect(validateEnv(base({ TECHNICAL_ACCOUNT_PASSWORD: "Password@2025" })).ok).toBe(false);
    expect(validateEnv(base({ TECHNICAL_ACCOUNT_PASSWORD: "q8Zk-W3mT-p7LxB-2" })).ok).toBe(true);
  });
});
