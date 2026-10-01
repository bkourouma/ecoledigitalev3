#!/usr/bin/env node
/**
 * Faux module `iam` pour le test e2e de l'authentification V2 (e2e/auth-v2.spec.ts) : AUCUNE base, AUCUN Redis, aucune
 * dépendance. Il imite le CONTRAT de `/api/v1/iam/*` (formes de réponse de packages/contracts/src/v2/iam.ts), y compris
 * la rotation du refresh token avec détection de réutilisation et la révocation de session, et expose son état sur
 * `GET /__mock/state` pour que le test vérifie ce que le serveur web a réellement appelé.
 *
 * Ce n'est PAS un test de l'API (couverte par apps/api/test/auth-bridge) : c'est un test du WEB — NextAuth, la rotation côté
 * serveur, l'intercepteur, les pages — contre un contrat figé.
 *
 * Variables : E2E_MOCK_PORT (défaut 4010), E2E_PASSWORD (mot de passe des comptes de test, aléatoire par exécution),
 * E2E_TOTP (code TOTP accepté), E2E_ACCESS_TTL_SEC (durée du jeton d'accès, défaut 900).
 */
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

const PORT = Number(process.env.E2E_MOCK_PORT ?? 4010);
const PASSWORD = process.env.E2E_PASSWORD;
const TOTP = process.env.E2E_TOTP ?? "246810";
const TTL = Number(process.env.E2E_ACCESS_TTL_SEC ?? 900);
if (!PASSWORD) throw new Error("E2E_PASSWORD requis");

const TENANT = { id: "0192f0a4-7b1e-7c3a-8d2e-0000000000a1", slug: "ecole", name: "École Test" };
const USERS = {
  "prof@ecole.test": { id: "0192f0a4-7b1e-7c3a-8d2e-0000000000b1", roles: ["teacher"], mfa: "none" },
  "admin@ecole.test": { id: "0192f0a4-7b1e-7c3a-8d2e-0000000000b2", roles: ["admin"], mfa: "enrolled" },
  "multi@ecole.test": { id: "0192f0a4-7b1e-7c3a-8d2e-0000000000b3", roles: ["teacher", "parent"], mfa: "none" },
  "neuf@ecole.test": { id: "0192f0a4-7b1e-7c3a-8d2e-0000000000b4", roles: ["owner"], mfa: "needs-enrollment" },
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sessions = new Map(); // sid -> { email, revoked, refresh: Set, used: Set, current: string }
const steps = new Map(); // jeton d'étape -> { email, kind }
const state = { logins: 0, challenges: 0, refreshes: 0, reuses: 0, logouts: [], revokedBy: [], lastForwardedFor: null, lastUserAgent: null, refreshAuthHeaders: [] };

function accessToken(email, sid) {
  const user = USERS[email];
  const iat = Math.floor(Date.now() / 1000);
  const payload = { iss: "ecoledigitale", aud: TENANT.slug, sub: user.id, userId: user.id, scope: "tenant_user", tenantId: TENANT.id, tenantSlug: TENANT.slug, roles: user.roles, activeRole: user.roles[0], sid, iat, exp: iat + TTL, use: "access" };
  return `${b64({ alg: "HS256", typ: "at+jwt" })}.${b64(payload)}.${randomBytes(12).toString("base64url")}`;
}

function newSession(email) {
  const sid = randomUUID();
  const refresh = `rt1.${TENANT.slug}.${randomBytes(24).toString("base64url")}`;
  sessions.set(sid, { email, revoked: false, used: new Set(), current: refresh });
  return { sid, refresh };
}

function authenticated(email, sid, refresh, activeRole) {
  const user = USERS[email];
  const role = activeRole && user.roles.includes(activeRole) ? activeRole : user.roles[0];
  return {
    status: "authenticated",
    tokenType: "Bearer",
    accessToken: accessToken(email, sid),
    expiresIn: TTL,
    refreshToken: refresh,
    refreshExpiresIn: 1_209_600,
    sessionId: sid,
    user: { id: user.id, email, tenantId: TENANT.id, tenantSlug: TENANT.slug, activeRole: role, roles: [role], availableRoles: user.roles, requiresRoleSelection: user.roles.length > 1, mfaEnabled: user.mfa === "enrolled" },
    tenants: [TENANT],
  };
}

function bearerSession(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
  if (!m) return null;
  try {
    const payload = JSON.parse(Buffer.from(m[1].split(".")[1], "base64url").toString("utf8"));
    const s = sessions.get(payload.sid);
    if (!s || s.revoked || payload.exp * 1000 <= Date.now()) return null;
    return { sid: payload.sid, ...s };
  } catch {
    return null;
  }
}

const error = (res, status, code, extra = {}) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ status, code, kind: "error", message: code, ...extra }));
};
const json = (res, body, status = 200) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  const path = url.pathname;
  const body = req.method === "GET" || req.method === "DELETE" ? {} : await readBody(req);
  state.lastForwardedFor = req.headers["x-forwarded-for"] ?? state.lastForwardedFor;
  state.lastUserAgent = req.headers["user-agent"] ?? state.lastUserAgent;

  if (path === "/__mock/state") {
    return json(res, { ...state, sessions: [...sessions].map(([id, s]) => ({ id, email: s.email, revoked: s.revoked })) });
  }
  if (path === "/__mock/revoke" && req.method === "POST") {
    for (const s of sessions.values()) s.revoked = true;
    return json(res, { ok: true });
  }
  if (path === "/api/v1/health") return json(res, { ok: true });

  if (path === "/api/v1/iam/login" && req.method === "POST") {
    state.logins += 1;
    const user = USERS[String(body.email ?? "")];
    if (!user || body.password !== PASSWORD) return error(res, 401, "iam.invalid_credentials");
    if (user.mfa === "enrolled") {
      const token = `chal.${randomBytes(16).toString("base64url")}.step`;
      steps.set(token, { email: body.email, kind: "challenge" });
      return json(res, { status: "mfa_required", challengeToken: token, expiresIn: 300, methods: ["totp", "recovery_code"] });
    }
    if (user.mfa === "needs-enrollment") {
      const token = `enr.${randomBytes(16).toString("base64url")}.step`;
      steps.set(token, { email: body.email, kind: "enroll" });
      return json(res, { status: "mfa_enrollment_required", enrollmentToken: token, expiresIn: 600 });
    }
    const { sid, refresh } = newSession(body.email);
    return json(res, authenticated(body.email, sid, refresh, body.activeRole));
  }

  if (path === "/api/v1/iam/mfa/challenge" && req.method === "POST") {
    state.challenges += 1;
    const step = steps.get(String(body.challengeToken));
    if (!step || step.kind !== "challenge") return error(res, 401, "iam.mfa_challenge_invalid");
    if (body.code !== TOTP && body.recoveryCode !== "aaaa-bbbb-cccc") return error(res, 401, "iam.mfa_invalid_code");
    steps.delete(String(body.challengeToken));
    const { sid, refresh } = newSession(step.email);
    return json(res, authenticated(step.email, sid, refresh));
  }

  if (path === "/api/v1/iam/mfa/enroll" && req.method === "POST") {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (!steps.has(token)) return error(res, 401, "iam.token_invalid");
    return json(res, { otpauthUri: "otpauth://totp/EcoleDigitale:neuf%40ecole.test?secret=JBSWY3DPEHPK3PXP&issuer=EcoleDigitale", secret: "JBSWY3DPEHPK3PXP", issuer: "EcoleDigitale", accountName: "neuf@ecole.test", digits: 6, period: 30, algorithm: "SHA1" });
  }
  if (path === "/api/v1/iam/mfa/verify" && req.method === "POST") {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    const step = steps.get(token);
    if (!step || step.kind !== "enroll") return error(res, 401, "iam.mfa_challenge_invalid");
    if (body.code !== TOTP) return error(res, 401, "iam.mfa_invalid_code");
    steps.delete(token);
    USERS[step.email].mfa = "enrolled";
    const { sid, refresh } = newSession(step.email);
    return json(res, { recoveryCodes: ["aaaa-bbbb-cccc", "dddd-eeee-ffff", "gggg-hhhh-iiii"], session: authenticated(step.email, sid, refresh) });
  }

  if (path === "/api/v1/iam/refresh" && req.method === "POST") {
    state.refreshes += 1;
    state.refreshAuthHeaders.push(Boolean(req.headers.authorization));
    const token = String(body.refreshToken ?? "");
    for (const [sid, s] of sessions) {
      if (s.used.has(token)) {
        s.revoked = true; // réutilisation : toute la famille est révoquée
        state.reuses += 1;
        return error(res, 401, "iam.refresh_invalid");
      }
      if (s.current === token) {
        if (s.revoked) return error(res, 401, "iam.refresh_invalid");
        s.used.add(token);
        s.current = `rt1.${TENANT.slug}.${randomBytes(24).toString("base64url")}`;
        return json(res, { status: "refreshed", tokenType: "Bearer", accessToken: accessToken(s.email, sid), expiresIn: TTL, sessionId: sid, refreshToken: s.current, refreshExpiresIn: 1_209_600 });
      }
    }
    return error(res, 401, "iam.refresh_invalid");
  }

  if (path === "/api/v1/iam/logout" && req.method === "POST") {
    const viaAccess = bearerSession(req);
    const token = String(body.refreshToken ?? "");
    const viaRefresh = [...sessions].find(([, s]) => s.current === token || s.used.has(token));
    const sid = viaAccess?.sid ?? viaRefresh?.[0];
    if (sid) {
      sessions.get(sid).revoked = true;
      state.logouts.push(sid);
    }
    res.writeHead(204);
    return res.end();
  }

  if (path === "/api/v1/iam/switch-role" && req.method === "POST") {
    const s = bearerSession(req);
    if (!s) return error(res, 401, "iam.token_invalid");
    if (!USERS[s.email].roles.includes(body.activeRole)) return error(res, 403, "iam.forbidden");
    s.revoked = true;
    const { sid, refresh } = newSession(s.email);
    return json(res, authenticated(s.email, sid, refresh, body.activeRole));
  }

  if (path === "/api/v1/iam/sessions" && req.method === "GET") {
    const s = bearerSession(req);
    if (!s) return error(res, 401, "iam.token_invalid");
    const now = new Date().toISOString();
    return json(res, {
      sessions: [...sessions].filter(([, x]) => x.email === s.email && !x.revoked).map(([id, x]) => ({
        id, current: id === s.sid, kind: "user", activeRole: USERS[x.email].roles[0], mfaVerified: USERS[x.email].mfa === "enrolled", ip: "203.0.113.7",
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36", deviceName: null, createdAt: now, lastSeenAt: now, expiresAt: now,
      })),
    });
  }
  const del = /^\/api\/v1\/iam\/sessions\/([0-9a-f-]{36})$/.exec(path);
  if (del && req.method === "DELETE") {
    const s = bearerSession(req);
    if (!s) return error(res, 401, "iam.token_invalid");
    const target = sessions.get(del[1]);
    if (!target || target.email !== s.email) return error(res, 403, "iam.forbidden");
    target.revoked = true;
    state.logouts.push(del[1]);
    res.writeHead(204);
    return res.end();
  }
  // Passerelle IAM -> legacy : le compte LEGACY du jeton (identifiant distinct de l'identité IAM).
  if (path === "/api/v1/auth/whoami") {
    const s = bearerSession(req);
    if (!s) return error(res, 401, "TOKEN_INVALID");
    const user = USERS[s.email];
    return json(res, { id: user.id.replace(/-0000000000b/, "-0000000001b"), email: s.email, tenantId: TENANT.id, tenantSlug: TENANT.slug, activeRole: user.roles[0], roles: [user.roles[0]], availableRoles: user.roles, authSource: "iam" });
  }
  if (path === "/api/v1/iam/me") {
    const s = bearerSession(req);
    if (!s) return error(res, 401, "iam.token_invalid");
    return json(res, { userId: USERS[s.email].id, tenantId: TENANT.id, tenantSlug: TENANT.slug, activeRole: USERS[s.email].roles[0], roles: USERS[s.email].roles, sessionId: s.sid, mfa: false, impersonatedBy: null });
  }

  return error(res, 404, "mock.not_found");
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-iam] http://127.0.0.1:${PORT}`));
