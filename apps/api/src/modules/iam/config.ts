/**
 * Configuration du module `iam`.
 *
 * Règles de sécurité (ADR-008) :
 *  - AUCUN secret n'a de valeur par défaut. `loadIamConfig` lève une
 *    `IamConfigError` (qui ne cite que les NOMS des variables, jamais leurs
 *    valeurs) si un secret manque, est trop court, ou ressemble à un
 *    espace réservé (« changeme », « secret »…) ;
 *  - une seule clé maître (`IAM_JWT_SECRET`) alimente, par HKDF-SHA256 avec des
 *    étiquettes distinctes, trois clés indépendantes : jetons « porteur »
 *    (accès/impersonation), jetons d'étape (challenge MFA, enrôlement) et
 *    hachage des jetons opaques. Un jeton d'un usage ne se vérifie donc jamais
 *    avec la clé d'un autre ;
 *  - le chiffrement des secrets TOTP utilise une clé séparée
 *    (`IAM_MFA_ENCRYPTION_KEY`), rotatable indépendamment ;
 *  - tous les délais ont des bornes dures (un jeton d'accès ne dépasse jamais 1 h).
 */
import { hkdfSync } from "node:crypto";

export class IamConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IamConfigError";
  }
}

export interface ScryptParams {
  /** Coût CPU/mémoire = 2^logN. */
  logN: number;
  r: number;
  p: number;
}

export interface PasswordPolicyOptions {
  minLength: number;
  maxLength: number;
  /** Nombre minimal de classes de caractères (minuscule, majuscule, chiffre, autre). 0 = non exigé (recommandation NIST SP 800-63B). */
  minCharacterClasses: number;
  /** Mots de passe interdits en plus de la liste intégrée (comparés après normalisation). */
  extraBlocklist: readonly string[];
}

export interface LockoutRule {
  /** Échecs consécutifs (dans `failureWindowMs`) qui déclenchent un verrou. */
  threshold: number;
  failureWindowMs: number;
  /** Durée du premier verrou ; doublée à chaque verrou successif. */
  baseLockMs: number;
  maxLockMs: number;
  /** Durée pendant laquelle le « niveau » de verrouillage est mémorisé. */
  levelMemoryMs: number;
}

export interface WindowRule {
  limit: number;
  windowMs: number;
}

export interface IamKeys {
  /** Jetons porteur : accès et impersonation. */
  bearer: Buffer;
  /** Jetons d'étape : challenge MFA, enrôlement MFA. */
  step: Buffer;
  /** Hachage (HMAC) des jetons opaques et codes de secours. */
  tokenHash: Buffer;
}

export interface MfaKeyRing {
  currentId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface IamConfig {
  issuer: string;
  keys: IamKeys;
  mfaKeys: MfaKeyRing;

  accessTtlSec: number;
  refreshIdleTtlSec: number;
  sessionMaxAgeSec: number;
  challengeTtlSec: number;
  enrollTtlSec: number;
  resetTtlSec: number;
  invitationTtlSec: number;
  impersonationTtlSec: number;
  /** Tolérance d'horloge pour `exp`/`nbf`/`iat`. */
  clockToleranceSec: number;
  /** 0 = rotation stricte : toute réutilisation d'un refresh token révoque la session. */
  refreshReuseGraceMs: number;

  password: PasswordPolicyOptions;
  scrypt: ScryptParams;

  /** Durée minimale (ms) d'une réponse d'échec d'authentification (anti-timing). */
  failureMinDurationMs: number;
  loginPairLockout: LockoutRule;
  loginIdentityLockout: LockoutRule;
  loginIpLimit: WindowRule;
  mfaIdentityLockout: LockoutRule;
  passwordChangeLockout: LockoutRule;
  forgotEmailLimit: WindowRule;
  forgotIpLimit: WindowRule;
  resetIpLimit: WindowRule;
  refreshIpLimit: WindowRule;
  impersonationLimit: WindowRule;

  mfa: {
    /** Libellé de l'émetteur dans `otpauth://` (affiché par l'application d'authentification). */
    totpIssuer: string;
    /** Rôles pour lesquels la MFA est obligatoire (plan §3.6 : propriétaire, directeur, économe, super-admin). */
    requiredRoles: readonly string[];
    maxChallengeAttempts: number;
    recoveryCodeCount: number;
  };

  cookie: {
    name: string;
    path: string;
    secure: boolean;
    domain?: string;
  };
  /** Origines autorisées pour les routes authentifiées par cookie (contrôle CSRF complémentaire à SameSite=Lax). */
  allowedOrigins: readonly string[];
}

export interface IamConfigInput {
  jwtSecret: string;
  mfaEncryptionKey: string;
  mfaEncryptionKeyPrevious?: string;
  overrides?: DeepPartial<Omit<IamConfig, "keys" | "mfaKeys" | "issuer">>;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

const PLACEHOLDERS = ["changeme", "change-me", "change_me", "secret", "password", "default", "example", "your-", "your_", "replace", "placeholder", "xxxxxxxx", "test-secret"];

function assertStrongSecret(name: string, value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IamConfigError(`Variable d'environnement obligatoire absente : ${name}.`);
  }
  if (value.length < 32) {
    throw new IamConfigError(`${name} doit faire au moins 32 caractères.`);
  }
  const lower = value.toLowerCase();
  if (PLACEHOLDERS.some((p) => lower.includes(p))) {
    throw new IamConfigError(`${name} ressemble à une valeur d'exemple : générez un secret aléatoire (openssl rand -base64 48).`);
  }
  if (new Set(value).size < 10) {
    throw new IamConfigError(`${name} manque d'entropie (caractères trop répétitifs).`);
  }
  return value;
}

function parseAesKey(name: string, value: string | undefined): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new IamConfigError(`Variable d'environnement obligatoire absente : ${name}.`);
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new IamConfigError(`${name} doit être une clé de 32 octets encodée en base64 (openssl rand -base64 32).`);
  }
  if (new Set(key).size < 8) throw new IamConfigError(`${name} manque d'entropie.`);
  return key;
}

function derive(master: string, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(master, "utf8"), Buffer.from("ecoledigitale-iam-v1", "utf8"), Buffer.from(label, "utf8"), 32));
}

function bounded(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new IamConfigError(`${name} doit être un entier entre ${min} et ${max} (reçu ${String(value)}).`);
  }
  return value;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const DEFAULT_LOCKOUT_PAIR: LockoutRule = { threshold: 5, failureWindowMs: 15 * MINUTE, baseLockMs: MINUTE, maxLockMs: HOUR, levelMemoryMs: 24 * HOUR };
const DEFAULT_LOCKOUT_IDENTITY: LockoutRule = { threshold: 25, failureWindowMs: 15 * MINUTE, baseLockMs: 5 * MINUTE, maxLockMs: HOUR, levelMemoryMs: 24 * HOUR };
const DEFAULT_LOCKOUT_MFA: LockoutRule = { threshold: 5, failureWindowMs: 10 * MINUTE, baseLockMs: MINUTE, maxLockMs: HOUR, levelMemoryMs: 24 * HOUR };

export function buildIamConfig(input: IamConfigInput): IamConfig {
  const o = (input.overrides ?? {}) as Record<string, any>;
  const jwtSecret = assertStrongSecret("IAM_JWT_SECRET", input.jwtSecret);

  const current = parseAesKey("IAM_MFA_ENCRYPTION_KEY", input.mfaEncryptionKey);
  const keys = new Map<string, Buffer>([["k1", current]]);
  if (input.mfaEncryptionKeyPrevious) {
    const prev = parseAesKey("IAM_MFA_ENCRYPTION_KEY_PREVIOUS", input.mfaEncryptionKeyPrevious);
    if (prev.equals(current)) throw new IamConfigError("IAM_MFA_ENCRYPTION_KEY_PREVIOUS doit différer de la clé courante.");
    keys.set("k0", prev);
  }

  const accessTtlSec = bounded("accessTtlSec", o.accessTtlSec ?? 15 * 60, 60, 3600);
  const impersonationTtlSec = bounded("impersonationTtlSec", o.impersonationTtlSec ?? 10 * 60, 60, 30 * 60);

  const password: PasswordPolicyOptions = {
    minLength: bounded("password.minLength", o.password?.minLength ?? 12, 8, 64),
    maxLength: bounded("password.maxLength", o.password?.maxLength ?? 128, 64, 256),
    minCharacterClasses: bounded("password.minCharacterClasses", o.password?.minCharacterClasses ?? 0, 0, 4),
    extraBlocklist: Object.freeze([...(o.password?.extraBlocklist ?? [])]),
  };

  const scrypt: ScryptParams = {
    logN: bounded("scrypt.logN", o.scrypt?.logN ?? 16, 10, 20),
    r: bounded("scrypt.r", o.scrypt?.r ?? 8, 1, 16),
    p: bounded("scrypt.p", o.scrypt?.p ?? 1, 1, 4),
  };

  const requiredRoles: readonly string[] = Object.freeze(
    [...(o.mfa?.requiredRoles ?? ["owner", "admin", "director", "bursar", "accountant", "super_admin"])].map((r: string) => r.trim()).filter(Boolean),
  );

  return Object.freeze({
    issuer: "ecoledigitale",
    keys: Object.freeze({
      bearer: derive(jwtSecret, "iam:jwt:bearer"),
      step: derive(jwtSecret, "iam:jwt:step"),
      tokenHash: derive(jwtSecret, "iam:token-hash"),
    }),
    mfaKeys: Object.freeze({ currentId: "k1", keys }),

    accessTtlSec,
    refreshIdleTtlSec: bounded("refreshIdleTtlSec", o.refreshIdleTtlSec ?? 14 * 24 * 3600, 300, 90 * 24 * 3600),
    sessionMaxAgeSec: bounded("sessionMaxAgeSec", o.sessionMaxAgeSec ?? 30 * 24 * 3600, 600, 365 * 24 * 3600),
    challengeTtlSec: bounded("challengeTtlSec", o.challengeTtlSec ?? 5 * 60, 30, 15 * 60),
    enrollTtlSec: bounded("enrollTtlSec", o.enrollTtlSec ?? 10 * 60, 60, 30 * 60),
    resetTtlSec: bounded("resetTtlSec", o.resetTtlSec ?? 30 * 60, 300, 24 * 3600),
    invitationTtlSec: bounded("invitationTtlSec", o.invitationTtlSec ?? 7 * 24 * 3600, 3600, 30 * 24 * 3600),
    impersonationTtlSec,
    clockToleranceSec: bounded("clockToleranceSec", o.clockToleranceSec ?? 5, 0, 60),
    refreshReuseGraceMs: bounded("refreshReuseGraceMs", o.refreshReuseGraceMs ?? 0, 0, 30_000),

    password: Object.freeze(password),
    scrypt: Object.freeze(scrypt),

    failureMinDurationMs: bounded("failureMinDurationMs", o.failureMinDurationMs ?? 600, 0, 5000),
    loginPairLockout: { ...DEFAULT_LOCKOUT_PAIR, ...(o.loginPairLockout ?? {}) },
    loginIdentityLockout: { ...DEFAULT_LOCKOUT_IDENTITY, ...(o.loginIdentityLockout ?? {}) },
    loginIpLimit: { limit: 300, windowMs: 15 * MINUTE, ...(o.loginIpLimit ?? {}) },
    mfaIdentityLockout: { ...DEFAULT_LOCKOUT_MFA, ...(o.mfaIdentityLockout ?? {}) },
    passwordChangeLockout: { ...DEFAULT_LOCKOUT_MFA, ...(o.passwordChangeLockout ?? {}) },
    forgotEmailLimit: { limit: 3, windowMs: HOUR, ...(o.forgotEmailLimit ?? {}) },
    forgotIpLimit: { limit: 20, windowMs: HOUR, ...(o.forgotIpLimit ?? {}) },
    resetIpLimit: { limit: 20, windowMs: HOUR, ...(o.resetIpLimit ?? {}) },
    refreshIpLimit: { limit: 120, windowMs: MINUTE, ...(o.refreshIpLimit ?? {}) },
    impersonationLimit: { limit: 20, windowMs: HOUR, ...(o.impersonationLimit ?? {}) },

    mfa: Object.freeze({
      totpIssuer: o.mfa?.totpIssuer ?? "EcoleDigitale",
      requiredRoles,
      maxChallengeAttempts: bounded("mfa.maxChallengeAttempts", o.mfa?.maxChallengeAttempts ?? 5, 1, 10),
      recoveryCodeCount: bounded("mfa.recoveryCodeCount", o.mfa?.recoveryCodeCount ?? 10, 4, 20),
    }),

    cookie: Object.freeze({
      name: o.cookie?.name ?? ((o.cookie?.secure ?? true) ? "__Secure-ed_refresh" : "ed_refresh"),
      path: o.cookie?.path ?? "/api/v1/iam",
      secure: o.cookie?.secure ?? true,
      ...(o.cookie?.domain ? { domain: o.cookie.domain as string } : {}),
    }),
    allowedOrigins: Object.freeze([...(o.allowedOrigins ?? [])] as string[]),
  });
}

/** Lit la configuration depuis l'environnement. Lève `IamConfigError` si un secret manque. */
export function loadIamConfig(env: Record<string, string | undefined> = process.env): IamConfig {
  const secure = env.IAM_COOKIE_SECURE === undefined ? true : env.IAM_COOKIE_SECURE !== "false";
  const origins = (env.IAM_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const mfaRoles = env.IAM_MFA_REQUIRED_ROLES?.split(",").map((s) => s.trim()).filter(Boolean);
  const num = (name: string): number | undefined => {
    const raw = env[name];
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new IamConfigError(`${name} doit être un nombre.`);
    return n;
  };
  const secure_ = secure;
  if (!secure_ && env.NODE_ENV === "production") {
    throw new IamConfigError("IAM_COOKIE_SECURE=false est interdit en production.");
  }
  return buildIamConfig({
    jwtSecret: env.IAM_JWT_SECRET as string,
    mfaEncryptionKey: env.IAM_MFA_ENCRYPTION_KEY as string,
    ...(env.IAM_MFA_ENCRYPTION_KEY_PREVIOUS ? { mfaEncryptionKeyPrevious: env.IAM_MFA_ENCRYPTION_KEY_PREVIOUS } : {}),
    overrides: {
      ...(num("IAM_ACCESS_TTL_SEC") !== undefined ? { accessTtlSec: num("IAM_ACCESS_TTL_SEC") as number } : {}),
      ...(num("IAM_REFRESH_IDLE_TTL_SEC") !== undefined ? { refreshIdleTtlSec: num("IAM_REFRESH_IDLE_TTL_SEC") as number } : {}),
      ...(num("IAM_SESSION_MAX_AGE_SEC") !== undefined ? { sessionMaxAgeSec: num("IAM_SESSION_MAX_AGE_SEC") as number } : {}),
      ...(num("IAM_IMPERSONATION_TTL_SEC") !== undefined ? { impersonationTtlSec: num("IAM_IMPERSONATION_TTL_SEC") as number } : {}),
      ...(num("IAM_REFRESH_REUSE_GRACE_MS") !== undefined ? { refreshReuseGraceMs: num("IAM_REFRESH_REUSE_GRACE_MS") as number } : {}),
      ...(num("IAM_REFRESH_REUSE_GRACE_MS") !== undefined ? { refreshReuseGraceMs: num("IAM_REFRESH_REUSE_GRACE_MS") as number } : {}),
      ...(num("IAM_PASSWORD_MIN_LENGTH") !== undefined ? { password: { minLength: num("IAM_PASSWORD_MIN_LENGTH") as number } } : {}),
      ...(num("IAM_SCRYPT_LOG_N") !== undefined ? { scrypt: { logN: num("IAM_SCRYPT_LOG_N") as number } } : {}),
      ...(mfaRoles ? { mfa: { requiredRoles: mfaRoles } } : {}),
      ...(env.IAM_MFA_TOTP_ISSUER ? { mfa: { totpIssuer: env.IAM_MFA_TOTP_ISSUER, ...(mfaRoles ? { requiredRoles: mfaRoles } : {}) } } : {}),
      cookie: { secure: secure_, ...(env.IAM_COOKIE_DOMAIN ? { domain: env.IAM_COOKIE_DOMAIN } : {}) },
      allowedOrigins: origins,
    },
  });
}
