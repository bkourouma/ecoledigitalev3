import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOGIN_ROLE,
  LoginRoleError,
  applicationUrlFor,
  createLoginRole,
  generateRolePassword,
} from "../src/platform/v2-login-role";

describe("génération du mot de passe", () => {
  it("est aléatoire, long et limité à l'alphabet base64url (sûr dans un CREATE ROLE)", () => {
    const a = generateRolePassword();
    const b = generateRolePassword();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("applicationUrlFor", () => {
  it("garde hôte, port et base, remplace l'identité", () => {
    const adminUrl = "postgres://admin@db.local:5544/ecole_v2_dev";
    const url = new URL(applicationUrlFor(adminUrl, "ed_v2_app", "NewSecret_123456789012"));
    expect(url.username).toBe("ed_v2_app");
    expect(url.password).toBe("NewSecret_123456789012");
    expect(url.host).toBe("db.local:5544");
    expect(url.pathname).toBe("/ecole_v2_dev");
  });
});

describe("garde-fous (avant toute connexion)", () => {
  const url = "postgres://admin@localhost:1/never_connected_dev"; // jamais atteinte : les garde-fous échouent avant la connexion

  it("refuse les noms de rôle dangereux ou réservés", async () => {
    for (const role of ["postgres", "app_user", "migrator", "pg_monitor", "UPPER", "a b", "x'; DROP ROLE y;--", "ab"]) {
      await expect(createLoginRole({ adminUrl: url, role })).rejects.toBeInstanceOf(LoginRoleError);
    }
  });

  it("refuse un mot de passe généré hors alphabet sûr (injection dans CREATE ROLE)", async () => {
    await expect(createLoginRole({ adminUrl: url, generateSecret: () => "abc'; DROP ROLE x; --1234567890" })).rejects.toThrow(
      /alphabet base64url/,
    );
    await expect(createLoginRole({ adminUrl: url, generateSecret: () => "court" })).rejects.toBeInstanceOf(LoginRoleError);
  });

  it("a un rôle par défaut explicite", () => {
    expect(DEFAULT_LOGIN_ROLE).toBe("ed_v2_app");
  });
});
