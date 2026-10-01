// Exécution : pnpm exec vitest run apps/web/src/lib/__tests__/env.server.test.ts (depuis la racine)
import { describe, expect, it, vi } from "vitest";
import { assertWebEnv, isWeakSecret, resolveNextAuthSecret } from "../env.server";

const STRONG = "k3Jx9QvR7mTz2LpWb8NfYd5HsGa1CuEo4XiVr6ZtMq0BjAn";

describe("env.server — isWeakSecret", () => {
  it.each([
    "",
    "your-secret-key-here-change-in-production",
    "<secret-aleatoire-32-caracteres-minimum>",
    "CHANGE_ME_random_64_bytes",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ])("refuse la valeur faible %#", (value) => {
    expect(isWeakSecret(value)).toBe(true);
  });

  it("accepte un secret aléatoire", () => {
    expect(isWeakSecret(STRONG)).toBe(false);
  });
});

describe("env.server — resolveNextAuthSecret", () => {
  it("production : renvoie le secret de l'environnement s'il est valide", () => {
    expect(resolveNextAuthSecret({ NODE_ENV: "production", NEXTAUTH_SECRET: STRONG })).toBe(STRONG);
  });

  it("production : lève une erreur si le secret est absent", () => {
    expect(() => resolveNextAuthSecret({ NODE_ENV: "production" })).toThrow(/NEXTAUTH_SECRET/);
  });

  it("production : lève une erreur pour l'ancienne valeur par défaut, sans la divulguer", () => {
    const old = "your-secret-key-here-change-in-production";
    try {
      resolveNextAuthSecret({ NODE_ENV: "production", NEXTAUTH_SECRET: old });
      throw new Error("aurait dû lever");
    } catch (error) {
      expect((error as Error).message).toMatch(/NEXTAUTH_SECRET/);
      expect((error as Error).message).not.toContain(old);
    }
  });

  it("production : lève une erreur si le secret est trop court", () => {
    expect(() => resolveNextAuthSecret({ NODE_ENV: "production", NEXTAUTH_SECRET: "k3Jx9QvR7mTz" })).toThrow();
  });

  it("next build : ne lève pas (secrets d'exécution absents), valeur éphémère", () => {
    const value = resolveNextAuthSecret({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" });
    expect(value.length).toBeGreaterThanOrEqual(32);
  });

  it("développement : secret aléatoire par process, identique d'un appel à l'autre", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = resolveNextAuthSecret({ NODE_ENV: "development" });
    const b = resolveNextAuthSecret({ NODE_ENV: "development" });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toMatch(/change-in-production/);
    warn.mockRestore();
  });
});

describe("env.server — assertWebEnv", () => {
  it("production : lève sans NEXTAUTH_SECRET valide", () => {
    expect(() => assertWebEnv({ NODE_ENV: "production" })).toThrow();
  });

  it("production : passe avec un secret valide", () => {
    expect(() => assertWebEnv({ NODE_ENV: "production", NEXTAUTH_SECRET: STRONG })).not.toThrow();
  });

  it("phase de build : ne lève jamais", () => {
    expect(() => assertWebEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
  });
});
