/**
 * API v2 de la démonstration : la plateforme v2 assemblée (`registerV2Platform` : tous les modules, adaptateurs, IAM, RBAC)
 * derrière Fastify, avec l'observabilité (`/health`, `/ready`), SANS la base legacy (aucune table Prisma n'est requise).
 *
 * Particularités propres à la démonstration (tout est local) :
 *  - l'opérateur de la plateforme (super-admin) se connecte par `POST /api/v1/super-admin/auth/login` (même contrat que le legacy :
 *    `{ token, superAdmin }`) avec les identifiants générés à l'exécution (`.demo/credentials.md`) ; le jeton est un JWT HS256 de 8 h ;
 *  - les invitations et réinitialisations de mot de passe ne sont PAS envoyées : elles sont écrites dans `.demo/mailbox.jsonl`
 *    (boîte aux lettres locale) pour que le testeur puisse suivre les liens (activation, mot de passe oublié) ;
 *  - aucune télémétrie, aucun appel réseau sortant.
 *
 * Variables : celles de `scripts/demo/lib/env.mjs` (posées par `pnpm demo:up`).
 */
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
// Observabilité EN PREMIER (avant Fastify et pg) : voir apps/api/src/index.ts.
import { observability } from "../../apps/api/src/platform/observability/bootstrap";
import { observabilityPlugin } from "../../apps/api/src/platform/observability/plugin";
import { registerV2Platform } from "../../apps/api/src/platform/v2-bootstrap";
import { bodylessMethodsCompat, compatRouterOptions } from "../../apps/api/src/platform/http-compat";
import { createSuperAdminAuthorizer } from "../../apps/api/src/platform/super-admin-authorizer";

const apiRequire = createRequire(resolve(__dirname, "../../apps/api/package.json"));
const Fastify = apiRequire("fastify") as (opts: Record<string, unknown>) => any;
const multipart = apiRequire("@fastify/multipart");

const OPERATOR_ID = "0192f0a4-7b1e-7c3a-8d2e-0000000000f1";
const OPERATOR_TTL_SEC = 8 * 3600;

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} est requis (posé par pnpm demo:up).`);
  return v;
}

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");

function signOperatorToken(secret: string, email: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: "ecoledigitale-demo", aud: "super-admin", scope: "super_admin", sub: OPERATOR_ID, superAdminId: OPERATOR_ID, email, jti: `op-${iat}-${Math.random().toString(36).slice(2, 10)}`, iat, exp: iat + OPERATOR_TTL_SEC });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verifyOperatorToken(secret: string, token: string): { superAdminId: string; email: string; jti: string; scope: string } {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) throw new Error("jeton malformé");
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("signature invalide");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  if (claims.iss !== "ecoledigitale-demo" || claims.aud !== "super-admin" || typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) throw new Error("jeton refusé");
  return { superAdminId: String(claims.superAdminId), email: String(claims.email), jti: String(claims.jti), scope: String(claims.scope) };
}

function passwordMatches(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

async function main(): Promise<void> {
  const operatorEmail = required("DEMO_OPERATOR_EMAIL").toLowerCase();
  const operatorHash = required("DEMO_OPERATOR_PASSWORD_HASH");
  const operatorSecret = required("DEMO_OPERATOR_JWT_SECRET");
  const mailbox = required("DEMO_MAILBOX_FILE");

  const app = Fastify({ ...observability.fastifyOptions, routerOptions: { ...compatRouterOptions(), maxParamLength: 1024 } });
  await app.register(observabilityPlugin, { observability });
  await app.register(bodylessMethodsCompat);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  const operatorAuthorizer = createSuperAdminAuthorizer({
    verify: (token) => verifyOperatorToken(operatorSecret, token),
    isRevoked: async () => false,
    isActive: async (id) => id === OPERATOR_ID,
  });

  const writeMail = (entry: Record<string, unknown>): void => {
    try {
      appendFileSync(mailbox, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
    } catch {
      /* boîte aux lettres locale : au mieux */
    }
  };
  const webBase = required("V2_APP_BASE_URL");

  await registerV2Platform(app, {
    env: process.env,
    skipLegacyCatchUp: true,
    runtime: {
      superAdminAuthorizer: operatorAuthorizer,
      accountNotifier: {
        async sendInvitation(m: { email: string; token: string; tenantName?: string }) {
          writeMail({ kind: "invitation", email: m.email, tenant: m.tenantName ?? null, link: `${webBase}/auth/invitation?token=${encodeURIComponent(m.token)}`, token: m.token });
        },
        async sendPasswordReset(m: { email: string; token: string }) {
          writeMail({ kind: "password_reset", email: m.email, link: `${webBase}/auth/reset-password?token=${encodeURIComponent(m.token)}`, token: m.token });
        },
      } as never,
    },
  });

  // Connexion de l'opérateur de la plateforme (console `/v2/platform`). Limite simple : 8 échecs / minute / adresse.
  const failures = new Map<string, { n: number; since: number }>();
  app.post("/api/v1/super-admin/auth/login", async (request: any, reply: any) => {
    const ip = String(request.ip);
    const f = failures.get(ip);
    if (f && Date.now() - f.since < 60_000 && f.n >= 8) return reply.code(429).send({ error: "Too Many Requests", message: "Trop de tentatives." });
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (email === operatorEmail && password.length > 0 && passwordMatches(password, operatorHash)) {
      failures.delete(ip);
      return reply.send({ token: signOperatorToken(operatorSecret, operatorEmail), superAdmin: { id: OPERATOR_ID, email: operatorEmail, name: "Opérateur de démonstration" } });
    }
    const cur = f && Date.now() - f.since < 60_000 ? f : { n: 0, since: Date.now() };
    failures.set(ip, { n: cur.n + 1, since: cur.since });
    return reply.code(401).send({ error: "Unauthorized", message: "Identifiants invalides." });
  });
  // La console lit parfois `GET /api/v1/auth/whoami` (id legacy) : absent ici, le web retombe sur l'identité IAM.

  app.setErrorHandler((error: any, request: any, reply: any) => {
    request.log.error(error);
    if (error.validation) {
      reply.status(400).send({ error: "Validation Error", message: error.message, details: error.validation });
      return;
    }
    if (error.kind === "unavailable") {
      reply.status(503).send({ status: 503, code: error.code ?? "UNAVAILABLE", kind: "unavailable", message: "Service momentanément indisponible. Réessayez dans un instant." });
      return;
    }
    const status = typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    reply.status(status).send({ error: status === 500 ? "Internal Server Error" : "Error", message: error.message });
  });

  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 4100);
  await app.listen({ host, port });
  app.log.info(`API de démonstration prête sur http://${host}:${port}`);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      const guard = setTimeout(() => process.exit(1), 10_000);
      guard.unref();
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
}

main().catch((err) => {
  console.error("[api] ÉCHEC du démarrage :", err instanceof Error ? err.message : err);
  process.exit(1);
});
