/**
 * Harnais du test de sortie de phase 2 (année scolaire simulée) : la plateforme ASSEMBLÉE comme `src/index.ts` le fait
 * (Fastify + vrais plugins legacy + `registerV2Platform` + vrais adaptateurs inter-modules) ET le vrai worker en processus
 * (relais d'outbox, abonnés, jobs), avec en plus ce que la phase 2 exige : stockage d'objets (repli disque partagé par l'API
 * et le worker), clé de signature des bulletins, rendu PDF (Chrome si présent).
 *
 * Il réutilise l'infrastructure de la phase 1 (`../../phase1/support/harness.ts`) sans la modifier.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { configureTenantSync } from "../../../src/platform/tenant-sync";
import { findPuppeteerCachedChrome } from "../../../src/modules/reportcards";
import { bootInstance, flushQueuePrefix, legacyModule, prepareInfra, workerFor, type HttpResult, type Phase1Env } from "../../phase1/support/harness";

export type Phase2Env = Phase1Env & {
  /** Dossier du stockage d'objets (repli disque), partagé par l'API et le worker. */
  storageDir: string;
  /** `true` si un Chrome a été trouvé : le rendu PDF est alors RÉEL. */
  realPdf: boolean;
  chromePath: string | null;
  /** Empreinte publique de la clé de signature des bulletins. */
  signingKeyId: string;
};

/** Cherche un Chrome/Chromium : variables d'environnement, installations usuelles, cache Puppeteer. `null` sinon. */
export function detectChrome(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = [env.REPORTCARDS_CHROME_PATH, env.PUPPETEER_EXECUTABLE_PATH, env.CHROME_PATH].filter((p): p is string => Boolean(p));
  const usual = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const p of [...fromEnv, ...usual]) if (existsSync(p)) return p;
  return findPuppeteerCachedChrome();
}

export async function startPhase2Platform(): Promise<Phase2Env> {
  const infra = await prepareInfra();

  const storageDir = mkdtempSync(join(tmpdir(), "ed-p2-objects-"));
  const chromePath = detectChrome();
  const { privateKey } = generateKeyPairSync("ed25519");
  const signingKey = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const signingKeyId = `p2-${randomBytes(4).toString("hex")}-key`;
  const extra: Record<string, string> = {
    // Stockage d'objets : même dossier et même secret de signature d'URL côté API et côté worker.
    STORAGE_DISK_DIR: storageDir,
    STORAGE_SIGNING_SECRET: randomBytes(24).toString("hex"),
    STORAGE_PUBLIC_BASE_URL: "http://localhost:3001",
    // Bulletins : clé Ed25519 jetable, jamais écrite sur disque, domaine de vérification publique.
    REPORTCARDS_SIGNING_KEY: signingKey,
    REPORTCARDS_SIGNING_KEY_ID: signingKeyId,
    REPORTCARDS_VERIFICATION_BASE_URL: "https://verif.ecoledigitale.test",
    V2_APP_BASE_URL: "https://app.ecoledigitale.test",
    // Les sessions du scénario durent plus que les 15 minutes par défaut.
    IAM_ACCESS_TTL_SEC: "3600",
    ...(chromePath ? { REPORTCARDS_CHROME_PATH: chromePath, REPORTCARDS_CHROME_NO_SANDBOX: process.env.CI ? "1" : "0" } : {}),
  };
  // Le worker lit `process.env` (restauré par `infra.restoreEnv()`).
  Object.assign(process.env, extra);

  const { app, status } = await bootInstance(infra, { extraEnv: extra });
  const worker = workerFor(infra);
  await worker.start();

  const { generateSuperAdminToken } = await legacyModule<{ generateSuperAdminToken(id: string, email: string): string }>("services/super-admin-jwt.service");
  const { generateToken } = await legacyModule<{ generateToken(payload: Record<string, unknown>): string }>("services/jwt.service");
  const operatorToken = generateSuperAdminToken(infra.operatorId, "ops@plateforme.test");

  const http: Phase1Env["http"] = async (method, url, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let payload: string | undefined;
    if (opts.rawBody !== undefined) payload = opts.rawBody;
    else if (opts.body !== undefined) payload = JSON.stringify(opts.body);
    if (payload !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    const res = await app.inject({ method: method as never, url, headers, ...(payload !== undefined ? { payload } : {}) });
    let body: any = res.body;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON (CSV, HTML, PDF) : conservé tel quel */
    }
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown>, raw: res.body } as HttpResult;
  };

  return {
    app,
    db: infra.db,
    legacy: infra.legacy,
    status,
    env: { ...infra.env, ...extra },
    queuePrefix: infra.queuePrefix,
    worker,
    operatorToken,
    operatorId: infra.operatorId,
    invitations: infra.invitations,
    http,
    generateLegacyToken: (u) =>
      generateToken({
        iss: "ecoledigitale",
        aud: u.tenantSlug,
        sub: u.id,
        userId: u.id,
        scope: "tenant_user",
        tenantId: u.tenantId,
        tenantSlug: u.tenantSlug,
        roles: [u.role],
        activeRole: u.role,
      } as never),
    storageDir,
    realPdf: chromePath !== null,
    chromePath,
    signingKeyId,
    async stop() {
      await worker.stop("test").catch(() => undefined);
      configureTenantSync(null);
      await app.close().catch(() => undefined);
      await flushQueuePrefix(infra.queuePrefix);
      await infra.db.drop();
      rmSync(storageDir, { recursive: true, force: true });
      infra.restoreEnv();
    },
  };
}
