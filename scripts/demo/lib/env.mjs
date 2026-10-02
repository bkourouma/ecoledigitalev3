/**
 * Variables d'environnement d'EXÉCUTION de chaque processus de la démonstration. Elles sont passées au processus fils par le
 * script : AUCUN fichier `.env` n'est lu ni copié (le `.env` éventuel de l'utilisateur n'est jamais chargé : `NODE_ENV` et
 * toutes les variables utiles sont posées ici, et les processus lancés ne cherchent pas de `.env` pour les variables déjà
 * définies).
 *
 * Aucune valeur de secret n'est écrite dans ce fichier : elles viennent de `.demo/secrets.json` (générées à l'exécution).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DB_NAME } from "./docker.mjs";
import { OBJECTS_DIR } from "./paths.mjs";

export const APP_ROLE = "ed_demo_app";
export const QUEUE_PREFIX = "eddemo";
export const WEB_HOST = "localhost";

/** Premier navigateur Chromium trouvé (rendu des bulletins PDF par le worker) ; `undefined` : cache Puppeteer du worker. */
export function findChrome(env = process.env) {
  if (env.REPORTCARDS_CHROME_PATH && existsSync(env.REPORTCARDS_CHROME_PATH)) return env.REPORTCARDS_CHROME_PATH;
  // Chrome du cache Puppeteer : le moteur de rendu du worker le trouve lui-même (aucun chemin à poser).
  if (existsSync(join(homedir(), ".cache", "puppeteer", "chrome"))) return undefined;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return undefined; // sinon : Chrome du cache Puppeteer, trouvé par le moteur de rendu du worker
}

export function pgUrl(user, password, port) {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${DB_NAME}`;
}

/** Variables communes à l'API, au worker et au seed. */
export function platformEnv({ secrets, ports }) {
  const appUrl = pgUrl(APP_ROLE, secrets.appRolePassword, ports.pg);
  const chrome = findChrome();
  const apiBase = `http://127.0.0.1:${ports.api}`;
  const webBase = `http://${WEB_HOST}:${ports.web}`;
  return {
    NODE_ENV: "development",
    LOG_LEVEL: "info",
    V2_DATABASE_URL: appUrl,
    WORKER_DATABASE_URL: appUrl,
    REDIS_URL: `redis://:${encodeURIComponent(secrets.redisPassword)}@127.0.0.1:${ports.redis}`,
    WORKER_QUEUE_PREFIX: QUEUE_PREFIX,
    IAM_JWT_SECRET: secrets.iamJwtSecret,
    IAM_MFA_ENCRYPTION_KEY: secrets.iamMfaEncryptionKey,
    IAM_MFA_TOTP_ISSUER: "EcoleDigitale (démo)",
    IAM_COOKIE_SECURE: "false",
    IAM_ACCESS_TTL_SEC: "900",
    AUDIT_HMAC_KEY: secrets.auditHmacKey,
    // Paiements : coffre des secrets marchands et environnement de développement (fournisseur SANDBOX uniquement, déterministe, sans réseau).
    FINANCE_ENV: "development",
    FINANCE_SECRETS_KEYS: `k1:${secrets.financeSecretsKey}`,
    FINANCE_SECRETS_ACTIVE_KEY: "k1",
    FINANCE_WEBHOOK_BASE_URL: apiBase,
    // Bulletins : clé de signature Ed25519 générée à l'exécution ; vérification publique servie par le web de démonstration.
    REPORTCARDS_SIGNING_KEY: secrets.reportcardsSigningKeyPem,
    REPORTCARDS_SIGNING_KEY_ID: "ed-demo-key-1",
    REPORTCARDS_VERIFICATION_BASE_URL: webBase,
    REPORTCARDS_RENDER_CONCURRENCY: "2",
    ...(chrome ? { REPORTCARDS_CHROME_PATH: chrome } : {}),
    V2_APP_BASE_URL: webBase,
    ADMISSIONS_PUBLIC_BASE_URL: webBase,
    ADMISSIONS_FINGERPRINT_SECRET: secrets.admissionsFingerprintSecret,
    // Stockage d'objets : repli disque (dossier local ignoré par git), URL signées servies par l'API.
    STORAGE_DISK_DIR: OBJECTS_DIR,
    // URLs signées servies par l'API derrière le web (même origine : `/api/v1/storage/object` est relayé par les réécritures de Next).
    STORAGE_PUBLIC_BASE_URL: webBase,
    STORAGE_SIGNING_SECRET: secrets.storageSigningSecret,
    // Notifications : AUCUN envoi réel. SMS Orange en sandbox (aucun appel réseau), e-mail et WhatsApp non configurés ;
    // la simulation consigne les remises sans les émettre.
    NOTIFICATIONS_UNSUBSCRIBE_SECRET: secrets.notificationsUnsubscribeSecret,
    NOTIFICATIONS_WEBHOOK_SECRET: secrets.notificationsWebhookSecret,
    NOTIFICATIONS_SMS_PROVIDER: "orange",
    ORANGE_SMS_MODE: "sandbox",
    NOTIFICATIONS_SIMULATE: "1",
    // Essais par défaut des organisations créées par la console.
    ENTITLEMENTS_TRIAL_PLAN: "PROFESSIONAL",
    ENTITLEMENTS_TRIAL_DAYS: "365",
    // Jamais de télémétrie sortante.
    OTEL_SDK_DISABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "",
  };
}

/** Variables propres à l'API de démonstration. */
export function apiEnv({ secrets, ports }) {
  return {
    ...platformEnv({ secrets, ports }),
    HOST: "127.0.0.1",
    PORT: String(ports.api),
    DEMO_OPERATOR_EMAIL: secrets.operatorEmail,
    DEMO_OPERATOR_PASSWORD_HASH: secrets.operatorPasswordHash,
    DEMO_OPERATOR_JWT_SECRET: secrets.operatorJwtSecret,
  };
}

export function workerEnv({ secrets, ports }) {
  return {
    ...platformEnv({ secrets, ports }),
    WORKER_HTTP_HOST: "127.0.0.1",
    WORKER_HTTP_PORT: String(ports.worker),
    WORKER_RELAY_SWEEP_INTERVAL_MS: "1000",
    WORKER_TZ: "Africa/Abidjan",
  };
}

export function webEnv({ secrets, ports, defaultTenantSlug }) {
  const apiBase = `http://127.0.0.1:${ports.api}`;
  return {
    NODE_ENV: "development",
    NEXT_PUBLIC_AUTH_V2: "1",
    NEXT_PUBLIC_TENANT_SLUG: defaultTenantSlug,
    NEXT_PUBLIC_TENANT_BASE_DOMAINS: "",
    NEXT_PUBLIC_PWA: process.env.ED_DEMO_PWA === "1" ? "1" : "0",
    // Après connexion, chaque rôle atterrit sur son écran v2 (l'API de démonstration n'expose pas les routes historiques).
    NEXT_PUBLIC_V2_LANDING: "1",
    NEXT_PUBLIC_API_URL: apiBase,
    API_INTERNAL_URL: apiBase,
    API_BASE_URL: apiBase,
    NEXTAUTH_SECRET: secrets.nextAuthSecret,
    NEXT_TELEMETRY_DISABLED: "1",
    // Le panneau de comptes techniques du legacy n'existe pas dans cette démonstration.
    SHOW_TECHNICAL_ACCOUNTS: "false",
  };
}
