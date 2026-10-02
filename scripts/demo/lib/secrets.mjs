/**
 * Secrets de la démonstration : générés UNE FOIS (aléatoires) et écrits dans `.demo/secrets.json`, fichier local ignoré par
 * git. Ils ne sont ni affichés ni journalisés. Ils persistent entre `demo:down` et `demo:up` (les données de la base, chiffrées
 * ou signées avec eux, restent valides) et disparaissent avec `demo:reset`.
 */
import { generateKeyPairSync, randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { SECRETS_FILE } from "./paths.mjs";
import { readJson, writeJson } from "./state.mjs";

const hex = (n) => randomBytes(n).toString("hex");
const b64url = (n) => randomBytes(n).toString("base64url");

/** Mot de passe aléatoire conforme à la politique des comptes. */
export function randomPassword() {
  return `Zq${b64url(14)}-7k`;
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function loadSecrets() {
  return existsSync(SECRETS_FILE) ? readJson(SECRETS_FILE, null) : null;
}

export function generateSecrets() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const operatorPassword = randomPassword();
  return {
    createdAt: new Date().toISOString(),
    pgSuperPassword: b64url(24),
    appRolePassword: b64url(24),
    redisPassword: b64url(24),
    iamJwtSecret: b64url(48),
    iamMfaEncryptionKey: randomBytes(32).toString("base64"),
    auditHmacKey: hex(24),
    financeSecretsKey: randomBytes(32).toString("base64"),
    reportcardsSigningKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    nextAuthSecret: hex(32),
    storageSigningSecret: hex(24),
    notificationsUnsubscribeSecret: hex(24),
    notificationsWebhookSecret: hex(24),
    admissionsFingerprintSecret: hex(24),
    operatorJwtSecret: b64url(48),
    operatorEmail: "plateforme@demo.test",
    operatorPassword,
    operatorPasswordHash: hashPassword(operatorPassword),
  };
}

export function loadOrCreateSecrets() {
  const existing = loadSecrets();
  if (existing) return { secrets: existing, created: false };
  const secrets = generateSecrets();
  writeJson(SECRETS_FILE, secrets, { secret: true });
  return { secrets, created: true };
}
