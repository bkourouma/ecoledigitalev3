/**
 * Passerelle IAM -> legacy : fonctions pures (sans base).
 */
import { describe, expect, it } from "vitest";
import { LEGACY_ROLE_TO_TEMPLATES, legacyRoleToTemplate } from "../src/modules/rbac";
import {
  LEGACY_ROLE_COMPOSITION,
  LEGACY_ROLE_KEYS,
  LegacySunsetConfigError,
  assertLegacySunsetConfig,
  iamRolesToLegacy,
  isIamAccessTokenShape,
  isLegacyTokenSunsetReached,
  legacyCodeForIamError,
  legacyIamBridgeEnabled,
  legacyTokenSunsetDate,
  parseLegacyTokenSunset,
  peekJwtTyp,
} from "../src/platform/legacy-iam-bridge";
import Fastify from "fastify";
import { parseTrustProxy, resolveTrustProxy } from "../src/platform/trust-proxy";

const jwtWithTyp = (typ: unknown): string => `${Buffer.from(JSON.stringify({ alg: "HS256", typ })).toString("base64url")}.e30.c2ln`;

describe("rôles IAM -> legacy : inverse STRICT de legacyRoleToTemplate", () => {
  it("le miroir de composition ne dérive pas du RBAC (rôle legacy -> modèles)", () => {
    for (const [legacyRole, templates] of Object.entries(LEGACY_ROLE_COMPOSITION)) {
      expect([...templates]).toEqual(legacyRoleToTemplate(legacyRole));
      expect([...(LEGACY_ROLE_TO_TEMPLATES[legacyRole] ?? [])]).toEqual([...templates]);
    }
  });

  it("aller-retour : les modèles d'un rôle legacy redonnent ce rôle legacy", () => {
    for (const legacyRole of Object.keys(LEGACY_ROLE_COMPOSITION)) {
      const view = iamRolesToLegacy(legacyRoleToTemplate(legacyRole)[0] as string, legacyRoleToTemplate(legacyRole));
      expect(view.available).toContain(legacyRole);
      expect(view.active).toBe(legacyRole);
    }
  });

  it("les clés legacy valent elles-mêmes (c'est ce que l'import écrit dans l'accès)", () => {
    for (const key of LEGACY_ROLE_KEYS) {
      const view = iamRolesToLegacy(key, [key]);
      expect(view).toEqual({ active: key, available: [key], unmapped: [] });
    }
  });

  it("moindre privilège : un modèle partiel n'élève rien (directeur seul n'est PAS admin)", () => {
    for (const partial of [["directeur"], ["secretariat"], ["econome"], ["directeur", "secretariat"], ["directeur", "econome"], ["educateur"], ["responsable_pedagogique"], ["directeur_etudes"]]) {
      const view = iamRolesToLegacy(partial[0] as string, partial);
      expect(view.available, partial.join("+")).not.toContain("admin");
      expect(view.active, partial.join("+")).toBeNull();
    }
    // La composition COMPLÈTE donne admin, quel que soit le modèle actif.
    const full = iamRolesToLegacy("econome", ["directeur", "secretariat", "econome"]);
    expect(full).toMatchObject({ active: "admin", available: ["admin"] });
  });

  it("rôle actif non mappé alors que d'autres le sont : refus (échec fermé), pas de repli sur un autre rôle", () => {
    const view = iamRolesToLegacy("educateur", ["educateur", "teacher"]);
    expect(view.available).toEqual(["teacher"]);
    expect(view.active).toBeNull();
    expect(view.unmapped).toEqual(["educateur"]);
  });

  it("super_admin, inconnu, casse et espaces", () => {
    expect(iamRolesToLegacy("super_admin", ["super_admin"])).toMatchObject({ active: null, available: [] });
    expect(iamRolesToLegacy("zzz", ["zzz"]).unmapped).toEqual(["zzz"]);
    expect(iamRolesToLegacy(" Teacher ", ["TEACHER"])).toMatchObject({ active: "teacher", available: ["teacher"] });
    expect(iamRolesToLegacy("__proto__", ["__proto__"]).active).toBeNull();
    expect(iamRolesToLegacy("", [])).toEqual({ active: null, available: [], unmapped: [] });
  });

  it("plusieurs rôles : ordre de priorité legacy (admin, owner, teacher, parent, student)", () => {
    const view = iamRolesToLegacy("student", ["student", "parent", "teacher", "owner", "admin"]);
    expect(view.available).toEqual(["admin", "owner", "teacher", "parent", "student"]);
    expect(view.active).toBe("student");
  });
});

describe("LEGACY_TOKEN_SUNSET", () => {
  it("absent ou vide : jamais atteinte", () => {
    expect(parseLegacyTokenSunset(undefined)).toBeNull();
    expect(parseLegacyTokenSunset("  ")).toBeNull();
    expect(isLegacyTokenSunsetReached(new Date("2099-01-01"), {})).toBe(false);
  });

  it("date seule = minuit UTC ; date-heure avec fuseau ; atteinte à l'instant exact", () => {
    expect(parseLegacyTokenSunset("2026-12-01")?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(parseLegacyTokenSunset("2026-12-01T10:30:00+01:00")?.toISOString()).toBe("2026-12-01T09:30:00.000Z");
    const env = { LEGACY_TOKEN_SUNSET: "2026-12-01T00:00:00Z" } as NodeJS.ProcessEnv;
    expect(isLegacyTokenSunsetReached(new Date("2026-11-30T23:59:59.999Z"), env)).toBe(false);
    expect(isLegacyTokenSunsetReached(new Date("2026-12-01T00:00:00.000Z"), env)).toBe(true);
  });

  it("valeur mal formée : erreur explicite (le middleware refuse de démarrer)", () => {
    for (const bad of ["demain", "2026-13-45", "01/12/2026", "2026-12-01T10:00", "1700000000"]) {
      expect(() => parseLegacyTokenSunset(bad), bad).toThrow(LegacySunsetConfigError);
    }
    expect(() => assertLegacySunsetConfig({ LEGACY_TOKEN_SUNSET: "bientôt" } as NodeJS.ProcessEnv)).toThrow(LegacySunsetConfigError);
    expect(() => assertLegacySunsetConfig({} as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe("extinction calculée : AUTH_CUTOVER_AT + LEGACY_TOKEN_SUNSET_DAYS", () => {
  const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;

  it("aucune extinction tant que AUTH_CUTOVER_AT n'est pas défini (même avec un nombre de jours)", () => {
    expect(legacyTokenSunsetDate(env({}))).toBeNull();
    expect(legacyTokenSunsetDate(env({ LEGACY_TOKEN_SUNSET_DAYS: "90" }))).toBeNull();
    expect(isLegacyTokenSunsetReached(new Date("2099-01-01"), env({ LEGACY_TOKEN_SUNSET_DAYS: "90" }))).toBe(false);
  });

  it("90 jours par défaut après la bascule, atteinte à l'instant exact", () => {
    const e = env({ AUTH_CUTOVER_AT: "2026-11-02" });
    expect(legacyTokenSunsetDate(e)?.toISOString()).toBe("2027-01-31T00:00:00.000Z");
    expect(isLegacyTokenSunsetReached(new Date("2027-01-30T23:59:59.999Z"), e)).toBe(false);
    expect(isLegacyTokenSunsetReached(new Date("2027-01-31T00:00:00.000Z"), e)).toBe(true);
  });

  it("nombre de jours configurable, date-heure avec fuseau", () => {
    const e = env({ AUTH_CUTOVER_AT: "2026-11-02T10:00:00+01:00", LEGACY_TOKEN_SUNSET_DAYS: "30" });
    expect(legacyTokenSunsetDate(e)?.toISOString()).toBe("2026-12-02T09:00:00.000Z");
    expect(legacyTokenSunsetDate(env({ AUTH_CUTOVER_AT: "2026-11-02", LEGACY_TOKEN_SUNSET_DAYS: "0" }))?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("LEGACY_TOKEN_SUNSET explicite reste prioritaire", () => {
    const e = env({ LEGACY_TOKEN_SUNSET: "2026-12-01", AUTH_CUTOVER_AT: "2026-11-02" });
    expect(legacyTokenSunsetDate(e)?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("valeurs mal formées : démarrage refusé", () => {
    for (const bad of [{ AUTH_CUTOVER_AT: "bientôt" }, { AUTH_CUTOVER_AT: "2026-11-02", LEGACY_TOKEN_SUNSET_DAYS: "-5" }, { AUTH_CUTOVER_AT: "2026-11-02", LEGACY_TOKEN_SUNSET_DAYS: "quatre-vingt-dix" }]) {
      expect(() => assertLegacySunsetConfig(env(bad))).toThrow(LegacySunsetConfigError);
    }
  });
});

describe("aiguillage des jetons et interrupteurs", () => {
  it("typ lu sans rien vérifier ; seuls at+jwt / imp+jwt sont des jetons d'accès IAM", () => {
    expect(peekJwtTyp(jwtWithTyp("at+jwt"))).toBe("at+jwt");
    expect(isIamAccessTokenShape(jwtWithTyp("at+jwt"))).toBe(true);
    expect(isIamAccessTokenShape(jwtWithTyp("imp+jwt"))).toBe(true);
    // Jetons d'étape et jetons legacy : jamais aiguillés vers l'authentification d'accès.
    for (const typ of ["mfa+jwt", "enr+jwt", "JWT", undefined, 12]) expect(isIamAccessTokenShape(jwtWithTyp(typ))).toBe(false);
    for (const junk of ["", "abc", ".x.y", "a.b", "%%%.e30.c2ln"]) expect(peekJwtTyp(junk)).toBeNull();
  });

  it("V2_LEGACY_IAM_BRIDGE : actif par défaut, 0/false/off le coupent", () => {
    expect(legacyIamBridgeEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    for (const off of ["0", "false", "OFF"]) expect(legacyIamBridgeEnabled({ V2_LEGACY_IAM_BRIDGE: off } as NodeJS.ProcessEnv)).toBe(false);
    expect(legacyIamBridgeEnabled({ V2_LEGACY_IAM_BRIDGE: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("codes d'erreur IAM -> codes legacy stables", () => {
    expect(legacyCodeForIamError("iam.token_expired")).toBe("TOKEN_EXPIRED");
    expect(legacyCodeForIamError("iam.session_revoked")).toBe("TOKEN_REVOKED");
    expect(legacyCodeForIamError("iam.mfa_required")).toBe("MFA_REQUIRED");
    expect(legacyCodeForIamError("iam.token_invalid")).toBe("TOKEN_INVALID");
    expect(legacyCodeForIamError(undefined)).toBe("TOKEN_INVALID");
  });
});

describe("TRUST_PROXY", () => {
  it("false par défaut ; nombre de sauts ; liste de CIDR ; valeur absurde refusée", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12")).toEqual(["10.0.0.0/8", "172.16.0.0/12"]);
    expect(() => parseTrustProxy("tout le monde")).toThrow();
    expect(() => parseTrustProxy("999999")).toThrow();
  });

  it("fastify 5 : un nombre de sauts rend toujours l'adresse du client (sinon fail-closed), la liste CIDR aussi", async () => {
    const ipFor = async (raw: string | undefined, forwarded: string, peer = "10.1.1.1") => {
      const app = Fastify({ trustProxy: resolveTrustProxy(raw) });
      app.get("/ip", async (request) => ({ ip: request.ip }));
      const res = await app.inject({ url: "/ip", remoteAddress: peer, headers: { "x-forwarded-for": forwarded } });
      await app.close();
      return (res.json() as { ip: string }).ip;
    };
    // Sans TRUST_PROXY : l'en-tête n'est pas cru.
    expect(await ipFor(undefined, "203.0.113.7")).toBe("10.1.1.1");
    // 1 saut (nginx) : l'adresse annoncée par nginx.
    expect(await ipFor("1", "203.0.113.7")).toBe("203.0.113.7");
    // 2 sauts (nginx + serveur web) : on remonte d'un cran dans la chaîne.
    expect(await ipFor("2", "203.0.113.7, 10.2.2.2")).toBe("203.0.113.7");
    // Un en-tête plus long que les sauts de confiance n'est pas remonté plus loin.
    expect(await ipFor("1", "198.51.100.9, 203.0.113.7")).toBe("203.0.113.7");
    // Liste de CIDR : seuls ces proxys sont crus.
    expect(await ipFor("10.0.0.0/8", "203.0.113.7")).toBe("203.0.113.7");
    expect(await ipFor("10.0.0.0/8", "203.0.113.7", "192.0.2.50")).toBe("192.0.2.50");
  });
});
