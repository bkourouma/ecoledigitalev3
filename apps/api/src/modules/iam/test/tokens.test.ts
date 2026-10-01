import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ManualClock } from "@ecoledigitale/kernel";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { issueBearerToken, issueStepToken, verifyAccessToken, verifyStepToken, type IssueAccessInput } from "../domain/access-token";
import { decryptSecret, encryptSecret, needsReencrypt, SecretBoxError } from "../domain/secret-box";
import {
  JwtError,
  formatRefreshToken,
  generateRecoveryCode,
  hashOpaqueToken,
  normalizeRecoveryCode,
  parseRefreshToken,
  peekJwtTyp,
  randomSecret,
  safeEqual,
  signJwt,
  verifyJwt,
} from "../domain/tokens";
import { IamConfigError, buildIamConfig, loadIamConfig } from "../config";
import { testConfig, testSecrets } from "./helpers";

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const clock = new ManualClock("2026-10-01T09:00:00.000Z");

const input = (over: Partial<IssueAccessInput> = {}): IssueAccessInput => ({
  userId: randomUUID(),
  tenantId: randomUUID(),
  tenantSlug: "lycee-prigla",
  roles: ["teacher", "parent"],
  activeRole: "teacher",
  sessionId: randomUUID(),
  membershipId: randomUUID(),
  mfa: false,
  amr: ["pwd"],
  ...over,
});

describe("JWT HS256 strict", () => {
  const key = Buffer.alloc(32, 7);

  it("signe puis vérifie un aller-retour", () => {
    const token = signJwt({ a: 1 }, key, "at+jwt");
    expect(verifyJwt(token, key, ["at+jwt"])).toEqual({ a: 1 });
  });

  it("refuse alg:none, avec ou sans signature", () => {
    const body = b64({ sub: "x" });
    for (const sig of ["", "AAAA", Buffer.alloc(32).toString("base64url")]) {
      expect(() => verifyJwt(`${b64({ alg: "none", typ: "at+jwt" })}.${body}.${sig}`, key, ["at+jwt"])).toThrow(JwtError);
    }
    // variantes de casse
    expect(() => verifyJwt(`${b64({ alg: "None", typ: "at+jwt" })}.${body}.`, key, ["at+jwt"])).toThrow(JwtError);
  });

  it("refuse tout autre algorithme, même correctement signé avec la clé (HS384/HS512, RS256)", () => {
    for (const alg of ["HS384", "HS512", "RS256", "ES256", "hs256"]) {
      const h = b64({ alg, typ: "at+jwt" });
      const p = b64({ sub: "x" });
      const sig = createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
      expect(() => verifyJwt(`${h}.${p}.${sig}`, key, ["at+jwt"])).toThrow(JwtError);
    }
  });

  it("refuse les en-têtes à champs supplémentaires (kid, jku, jwk, crit…)", () => {
    for (const extra of [{ kid: "1" }, { jku: "https://evil" }, { jwk: {} }, { crit: ["exp"] }, { x5u: "x" }]) {
      const h = b64({ alg: "HS256", typ: "at+jwt", ...extra });
      const p = b64({ sub: "x" });
      const sig = createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
      expect(() => verifyJwt(`${h}.${p}.${sig}`, key, ["at+jwt"])).toThrow(JwtError);
    }
  });

  it("refuse un payload modifié, une signature tronquée ou non canonique", () => {
    const token = signJwt({ tenantId: "A" }, key, "at+jwt");
    const [h, , s] = token.split(".") as [string, string, string];
    expect(() => verifyJwt(`${h}.${b64({ tenantId: "B" })}.${s}`, key, ["at+jwt"])).toThrow(JwtError);
    expect(() => verifyJwt(token.slice(0, -2), key, ["at+jwt"])).toThrow(JwtError);
    expect(() => verifyJwt(`${token}A`, key, ["at+jwt"])).toThrow(JwtError);
  });

  it("refuse une autre clé et un typ non attendu", () => {
    const token = signJwt({ a: 1 }, key, "mfa+jwt");
    expect(() => verifyJwt(token, Buffer.alloc(32, 8), ["mfa+jwt"])).toThrow(JwtError);
    expect(() => verifyJwt(token, key, ["at+jwt"])).toThrow(JwtError);
  });

  it("refuse les formes invalides et les jetons géants", () => {
    for (const bad of ["", "a.b", "a.b.c.d", "a.b.c", "é.é.é", "a".repeat(5000)]) {
      expect(() => verifyJwt(bad, key, ["at+jwt"])).toThrow(JwtError);
    }
    // @ts-expect-error entrée non conforme volontaire
    expect(() => verifyJwt(undefined, key, ["at+jwt"])).toThrow(JwtError);
  });

  it("peekJwtTyp lit le typ sans rien authentifier", () => {
    expect(peekJwtTyp(signJwt({}, key, "enr+jwt"))).toBe("enr+jwt");
    expect(peekJwtTyp("n'importe quoi")).toBeNull();
  });
});

describe("jeton d'accès", () => {
  const config = testConfig();

  it("porte les revendications compatibles avec le jeton historique (+ sid/mid/mfa/amr)", () => {
    const i = input();
    const { token, claims } = issueBearerToken(config, clock, i);
    const r = verifyAccessToken(token, { config, clock });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(claims);
    expect(claims).toMatchObject({
      iss: "ecoledigitale",
      aud: "lycee-prigla",
      sub: i.userId,
      userId: i.userId,
      tenantId: i.tenantId,
      tenantSlug: "lycee-prigla",
      roles: ["teacher", "parent"],
      activeRole: "teacher",
      scope: "tenant_user",
      sid: i.sessionId,
      mid: i.membershipId,
      mfa: false,
      use: "access",
    });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.exp - claims.iat).toBe(15 * 60);
  });

  it("expire après 15 minutes (plus la tolérance d'horloge)", () => {
    const { token } = issueBearerToken(config, clock, input());
    const later = new ManualClock(clock.now());
    later.advance(15 * 60_000 + config.clockToleranceSec * 1000 - 1000);
    expect(verifyAccessToken(token, { config, clock: later }).ok).toBe(true);
    later.advance(2000);
    const r = verifyAccessToken(token, { config, clock: later });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(AuthErrorCodes.tokenExpired);
  });

  it("refuse un jeton émis dans le futur ou pas encore valide", () => {
    const future = new ManualClock(clock.now());
    future.advance(10 * 60_000);
    const { token } = issueBearerToken(config, future, input());
    const r = verifyAccessToken(token, { config, clock });
    expect(r.ok).toBe(false);
  });

  it("refuse un jeton signé avec une autre configuration (autre secret)", () => {
    const other = testConfig();
    const { token } = issueBearerToken(other, clock, input());
    expect(verifyAccessToken(token, { config, clock }).ok).toBe(false);
  });

  it("refuse un jeton d'étape (challenge MFA) présenté comme jeton d'accès, et inversement", () => {
    const step = issueStepToken(config, clock, { purpose: "mfa_challenge", identityId: randomUUID(), tenantId: randomUUID(), challengeId: randomUUID(), ttlSec: 300 });
    expect(verifyAccessToken(step.token, { config, clock }).ok).toBe(false);
    const access = issueBearerToken(config, clock, input());
    expect(verifyStepToken(access.token, "mfa_challenge", { config, clock }).ok).toBe(false);
    // un jeton d'enrôlement n'est pas un jeton de challenge
    const enroll = issueStepToken(config, clock, { purpose: "mfa_enroll", identityId: randomUUID(), tenantId: randomUUID(), challengeId: randomUUID(), ttlSec: 300 });
    expect(verifyStepToken(enroll.token, "mfa_challenge", { config, clock }).ok).toBe(false);
    expect(verifyStepToken(enroll.token, "mfa_enroll", { config, clock }).ok).toBe(true);
  });

  it("refuse les revendications incohérentes même correctement signées (aud ≠ slug, activeRole hors rôles, claims en trop)", () => {
    const base = { iss: "ecoledigitale", aud: "a", sub: randomUUID(), iat: 1_790_000_000, nbf: 1_790_000_000, exp: 1_790_000_900, jti: randomUUID(), scope: "tenant_user", tenantId: randomUUID(), tenantSlug: "a", roles: ["teacher"], activeRole: "teacher", sid: randomUUID(), mid: randomUUID(), mfa: false, amr: ["pwd"], use: "access" };
    const goodClock = new ManualClock(1_790_000_100_000);
    const sign = (c: Record<string, unknown>): string => signJwt(c, config.keys.bearer, "at+jwt");
    expect(verifyAccessToken(sign({ ...base, userId: base.sub }), { config, clock: goodClock }).ok).toBe(true);
    expect(verifyAccessToken(sign({ ...base, userId: base.sub, aud: "autre" }), { config, clock: goodClock }).ok).toBe(false);
    expect(verifyAccessToken(sign({ ...base, userId: base.sub, activeRole: "owner" }), { config, clock: goodClock }).ok).toBe(false);
    expect(verifyAccessToken(sign({ ...base, userId: randomUUID() }), { config, clock: goodClock }).ok).toBe(false);
    expect(verifyAccessToken(sign({ ...base, userId: base.sub, isSuperAdmin: true }), { config, clock: goodClock }).ok).toBe(false);
    expect(verifyAccessToken(sign({ ...base, userId: base.sub, tenantId: "pas-un-uuid" }), { config, clock: goodClock }).ok).toBe(false);
  });

  it("jeton d'impersonation : claim `act`, typ distinct, TTL court, jamais accepté sous un autre `use`", () => {
    const actor = randomUUID();
    const { token, claims } = issueBearerToken(config, clock, input({ actor: { id: actor }, amr: ["imp"] }));
    expect(peekJwtTyp(token)).toBe("imp+jwt");
    expect(claims).toMatchObject({ use: "impersonation", act: { sub: actor, typ: "super_admin" } });
    expect(claims.exp - claims.iat).toBe(config.impersonationTtlSec);
    expect(config.impersonationTtlSec).toBeLessThanOrEqual(30 * 60);
    expect(verifyAccessToken(token, { config, clock }).ok).toBe(true);
    expect(verifyAccessToken(token, { config, clock, allowImpersonation: false }).ok).toBe(false);

    // Un jeton d'accès ordinaire ne peut pas se faire passer pour une impersonation en changeant `use`.
    const sneaky = signJwt({ ...claims, use: "access" }, config.keys.bearer, "imp+jwt");
    expect(verifyAccessToken(sneaky, { config, clock }).ok).toBe(false);
  });
});

describe("jetons opaques", () => {
  it("génère 256 bits d'entropie et un format de refresh token analysable", () => {
    const secret = randomSecret();
    expect(secret).toHaveLength(43);
    const tenantId = randomUUID();
    const rt = formatRefreshToken(tenantId, secret);
    expect(parseRefreshToken(rt)).toEqual({ tenantId, secret });
    expect(parseRefreshToken("rt1.zz.yy")).toBeNull();
    expect(parseRefreshToken(rt + "x")).toBeNull();
    expect(parseRefreshToken(`rt2.${tenantId.replace(/-/g, "")}.${secret}`)).toBeNull();
  });

  it("l'empreinte dépend de la clé serveur (une fuite de la base seule ne permet pas de tester des jetons)", () => {
    const t = randomSecret();
    const a = hashOpaqueToken(Buffer.alloc(32, 1), t);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(hashOpaqueToken(Buffer.alloc(32, 1), t));
    expect(a).not.toBe(hashOpaqueToken(Buffer.alloc(32, 2), t));
    expect(a).not.toContain(t);
  });

  it("codes de secours : 60 bits lisibles, normalisation tolérante", () => {
    const c = generateRecoveryCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeRecoveryCode(c.toLowerCase().replace(/-/g, " "))).toBe(c.replace(/-/g, ""));
    expect(new Set(Array.from({ length: 200 }, generateRecoveryCode)).size).toBe(200);
  });

  it("safeEqual compare sans court-circuit et gère les longueurs différentes", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("chiffrement des secrets TOTP (AES-256-GCM)", () => {
  const cfg = testConfig();
  const aad = randomUUID();

  it("aller-retour, enveloppe versionnée, IV aléatoire", () => {
    const secret = Buffer.from("12345678901234567890");
    const a = encryptSecret(cfg.mfaKeys, secret, aad);
    const b = encryptSecret(cfg.mfaKeys, secret, aad);
    expect(a).toMatch(/^v1\.k1\./);
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret.toString("base64url"));
    expect(decryptSecret(cfg.mfaKeys, a, aad).equals(secret)).toBe(true);
  });

  it("refuse une enveloppe copiée sur une autre identité (AAD) ou altérée", () => {
    const env = encryptSecret(cfg.mfaKeys, Buffer.from("secret"), aad);
    expect(() => decryptSecret(cfg.mfaKeys, env, randomUUID())).toThrow(SecretBoxError);
    const parts = env.split(".");
    parts[3] = Buffer.from("altere").toString("base64url");
    expect(() => decryptSecret(cfg.mfaKeys, parts.join("."), aad)).toThrow(SecretBoxError);
    expect(() => decryptSecret(cfg.mfaKeys, "n'importe quoi", aad)).toThrow(SecretBoxError);
  });

  it("rotation : l'ancienne clé déchiffre encore et déclenche le rechiffrement", () => {
    const secrets = testSecrets();
    const oldCfg = buildIamConfig({ ...secrets });
    const env = encryptSecret(oldCfg.mfaKeys, Buffer.from("secret"), aad);
    const newKey = testSecrets().mfaEncryptionKey;
    // La nouvelle configuration porte la nouvelle clé comme courante et l'ancienne comme « previous ».
    const rotated = buildIamConfig({ jwtSecret: secrets.jwtSecret, mfaEncryptionKey: newKey, mfaEncryptionKeyPrevious: secrets.mfaEncryptionKey });
    // L'enveloppe porte l'identifiant k1 : dans la config tournée k1 = nouvelle clé, k0 = ancienne.
    expect(() => decryptSecret(rotated.mfaKeys, env, aad)).toThrow(SecretBoxError);
    const asK0 = env.replace(".k1.", ".k0.");
    expect(decryptSecret(rotated.mfaKeys, asK0, aad).toString()).toBe("secret");
    expect(needsReencrypt(rotated.mfaKeys, asK0)).toBe(true);
    expect(needsReencrypt(rotated.mfaKeys, encryptSecret(rotated.mfaKeys, Buffer.from("x"), aad))).toBe(false);
  });
});

describe("configuration : aucun secret par défaut", () => {
  const good = testSecrets();

  it("lève sans secret, sans citer de valeur", () => {
    expect(() => loadIamConfig({})).toThrow(IamConfigError);
    expect(() => loadIamConfig({})).toThrow(/IAM_JWT_SECRET/);
    expect(() => loadIamConfig({ IAM_JWT_SECRET: good.jwtSecret })).toThrow(/IAM_MFA_ENCRYPTION_KEY/);
  });

  it("refuse les secrets courts, répétitifs ou d'exemple", () => {
    const env = (jwt: string) => ({ IAM_JWT_SECRET: jwt, IAM_MFA_ENCRYPTION_KEY: good.mfaEncryptionKey });
    for (const bad of ["court", "a".repeat(64), "change-me-change-me-change-me-change-me", "my-super-secret-value-0123456789abcdef"]) {
      expect(() => loadIamConfig(env(bad))).toThrow(IamConfigError);
    }
    try {
      loadIamConfig(env("court"));
    } catch (e) {
      expect(String(e)).not.toContain("court\"");
    }
  });

  it("valide la clé de chiffrement MFA (32 octets base64)", () => {
    expect(() => loadIamConfig({ IAM_JWT_SECRET: good.jwtSecret, IAM_MFA_ENCRYPTION_KEY: "dG9vLXNob3J0" })).toThrow(IamConfigError);
    expect(loadIamConfig({ IAM_JWT_SECRET: good.jwtSecret, IAM_MFA_ENCRYPTION_KEY: good.mfaEncryptionKey })).toBeTruthy();
  });

  it("bornes dures : accès ≤ 1 h, impersonation ≤ 30 min, cookie non sécurisé interdit en production", () => {
    const base = { IAM_JWT_SECRET: good.jwtSecret, IAM_MFA_ENCRYPTION_KEY: good.mfaEncryptionKey };
    expect(() => loadIamConfig({ ...base, IAM_ACCESS_TTL_SEC: "86400" })).toThrow(IamConfigError);
    expect(() => loadIamConfig({ ...base, IAM_IMPERSONATION_TTL_SEC: "7200" })).toThrow(IamConfigError);
    expect(() => loadIamConfig({ ...base, IAM_COOKIE_SECURE: "false", NODE_ENV: "production" })).toThrow(IamConfigError);
    expect(loadIamConfig({ ...base, IAM_COOKIE_SECURE: "false" }).cookie).toMatchObject({ secure: false, name: "ed_refresh" });
    expect(loadIamConfig(base).cookie).toMatchObject({ secure: true, name: "__Secure-ed_refresh" });
  });

  it("dérive des clés distinctes pour chaque usage", () => {
    const c = testConfig();
    expect(c.keys.bearer.equals(c.keys.step)).toBe(false);
    expect(c.keys.bearer.equals(c.keys.tokenHash)).toBe(false);
    expect(c.keys.step.equals(c.keys.tokenHash)).toBe(false);
  });
});
