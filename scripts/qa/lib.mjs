/**
 * Bibliotheque du balayage QA de la demonstration locale (voir scripts/qa/demo-sweep.mjs).
 * Aucun secret ici : les identifiants sont lus a l'execution depuis `.demo/credentials.json` (ignore par le VCS).
 */
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Remonte l'arborescence jusqu'a trouver `rel` (le worktree vit sous le depot principal, qui porte `.demo/` et `node_modules`). */
export function findUp(rel, start = here) {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const repoRoot = resolve(here, "..", "..");

function credentialsFile() {
  return process.env.ED_DEMO_CREDENTIALS_JSON ?? findUp(join(".demo", "credentials.json"));
}

export function loadCredentials() {
  const file = credentialsFile();
  if (!file) throw new Error("`.demo/credentials.json` introuvable (la demonstration est-elle lancee ? ED_DEMO_CREDENTIALS_JSON)");
  return { file, ...JSON.parse(readFileSync(file, "utf8")) };
}

export function demoDir() {
  const file = credentialsFile();
  return file ? dirname(file) : join(repoRoot, ".demo");
}

/** Charge Playwright depuis le depot (ou le depot principal quand on tourne dans un worktree sans node_modules). */
export function loadPlaywright() {
  const roots = [process.env.ED_QA_NODE_MODULES, findUp("node_modules"), join(repoRoot, "node_modules")].filter(Boolean);
  for (const nm of roots) {
    for (const pkg of ["playwright", "@playwright/test"]) {
      try {
        return createRequire(join(nm, "noop.js"))(pkg);
      } catch {
        /* suivant */
      }
    }
  }
  throw new Error("Playwright introuvable (pnpm install ? ED_QA_NODE_MODULES)");
}

/** TOTP RFC 6238 (SHA-1, 6 chiffres, pas de 30 s), secret en base32. */
export function totpAt(secretBase32, atMs = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretBase32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const h = createHmac("sha1", bytes).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export const API = process.env.DEMO_API_URL ?? "http://127.0.0.1:4100";
export const WEB_PORT = process.env.DEMO_WEB_PORT ?? "3100";

export function tenantOrigin(slug) {
  return `http://${slug}.localhost:${WEB_PORT}`;
}

export async function apiCall(method, path, token, body) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* corps non JSON */
  }
  return { status: res.status, body: parsed };
}

/** Connexion API (client "mobile" : jeton porteur) ; gere la MFA avec le pas TOTP courant puis suivants (anti-rejeu). */
export async function apiLogin(account) {
  const first = await apiCall("POST", "/api/v1/iam/login", undefined, { email: account.email, password: account.password, tenantSlug: account.tenant, client: "mobile" });
  if (first.body?.status === "authenticated") return first.body.accessToken;
  if (first.body?.status === "mfa_required" && account.totpSecret) {
    for (const delta of [0, 30_000, 60_000]) {
      const r = await apiCall("POST", "/api/v1/iam/mfa/challenge", undefined, { challengeToken: first.body.challengeToken, code: totpAt(account.totpSecret, Date.now() + delta), client: "mobile" });
      if (r.status === 200 && r.body?.accessToken) return r.body.accessToken;
    }
  }
  return null;
}
