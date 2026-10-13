/**
 * Technical accounts — SERVER ONLY.
 *
 * Never import this file from a client component: it handles credentials.
 * The login page reaches it through `/api/technical-accounts`, which answers
 * only when `technicalAccountsEnabled()` is true.
 *
 * Mirrors the server provisioning logic so the login page can display the
 * technical accounts that exist for a given tenant.
 *
 * Keep in sync with `apps/api/src/services/tenant-provisioning.service.ts`:
 *   - getTechnicalAccountEmail(roleKey, slug) => `${roleKey}@${slug}.local`
 *   - mot de passe commun                     => TECHNICAL_ACCOUNT_PASSWORD (la même
 *     variable d'environnement côté API et côté web ; aucune valeur par défaut)
 *   - global roles seeded in migration 0055_unified_multitenancy.sql
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { TechnicalAccount } from "./technical-accounts";

/** Global/system roles that get a technical account on every tenant. */
const SYSTEM_ROLES: { key: string; label: string }[] = [
  { key: "admin", label: "Administrateur" },
  { key: "owner", label: "Propriétaire" },
  { key: "teacher", label: "Enseignant" },
  { key: "student", label: "Étudiant" },
  { key: "parent", label: "Parent" },
];

type AccountOverride = { email: string; password: string };

/**
 * Mot de passe commun des comptes techniques, lu dans l'environnement du
 * serveur. Aucune valeur par défaut dans le code : s'il n'est pas défini, le
 * panneau liste les comptes sans mot de passe (à saisir à la main).
 */
function sharedTechnicalPassword(): string {
  return process.env.TECHNICAL_ACCOUNT_PASSWORD?.trim() ?? "";
}

/**
 * Surcharges de comptes réels par tenant + rôle : affichés (et utilisés au clic)
 * à la place du compte technique générique sur la page de connexion.
 *
 * Lues dans `TECHNICAL_ACCOUNT_OVERRIDES` (JSON, côté serveur uniquement), par
 * exemple :
 *   {"mon-tenant":{"teacher":{"email":"prenom.nom@exemple.test","password":"..."}}}
 * Aucun identifiant de ce type n'est versionné dans le dépôt.
 */
function readAccountOverrides(): Record<string, Record<string, AccountOverride>> {
  const raw = process.env.TECHNICAL_ACCOUNT_OVERRIDES?.trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, Record<string, AccountOverride>>)
      : {};
  } catch {
    console.error("TECHNICAL_ACCOUNT_OVERRIDES n'est pas un JSON valide : ignoré.");
    return {};
  }
}

/**
 * Le panneau « Comptes par tenant » remplit le formulaire de connexion, mot de
 * passe compris : sur un environnement accessible au public, il ouvre la
 * session administrateur à n'importe quel visiteur.
 *
 * Il n'est donc affiché que :
 *   - si `SHOW_TECHNICAL_ACCOUNTS=true` (activation explicite) ;
 *   - ou, faute de réglage, hors production (`next dev`).
 * `SHOW_TECHNICAL_ACCOUNTS=false` le coupe partout, y compris en développement.
 *
 * Variable lue à l'exécution, côté serveur : pas besoin de reconstruire l'image
 * pour la changer, et elle n'est jamais incluse dans le bundle client.
 */
export function technicalAccountsEnabled(): boolean {
  const flag = process.env.SHOW_TECHNICAL_ACCOUNTS?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * Build the list of technical accounts that the server provisions for a tenant.
 */
export function buildTechnicalAccounts(tenantSlug: string): TechnicalAccount[] {
  const overrides = readAccountOverrides()[tenantSlug] ?? {};
  const sharedPassword = sharedTechnicalPassword();
  return SYSTEM_ROLES.map((role) => {
    const ov = overrides[role.key];
    const email = ov?.email ?? `${role.key}@${tenantSlug}.local`;
    const password = ov?.password ?? sharedPassword;
    return { email, password, role: role.key, name: email };
  });
}

/* -------------------------------------------------------------------------- */
/* Comptes de test locaux (DEV_CREDENTIALS_FILE)                              */
/* -------------------------------------------------------------------------- */

/** Libellés français des rôles du jeu de démonstration (`scripts/demo/lib/guide.mjs`). */
const DEV_ROLE_LABELS: Record<string, string> = {
  proprietaire: "Propriétaire",
  directeur: "Directeur",
  directeur_etudes: "Directeur des études",
  responsable_pedagogique: "Responsable pédagogique",
  secretariat: "Secrétariat",
  econome: "Économe",
  enseignant: "Enseignant",
  instituteur: "Instituteur",
  educateur: "Éducateur (vie scolaire)",
  responsable_examens: "Responsable des examens",
  admissions_officer: "Chargé d'admissions",
  instituteur_maternelle: "Instituteur de la maternelle",
  instituteur_grande_section: "Instituteur · Grande Section A",
  instituteur_cp1: "Instituteur · CP1 A",
  instituteur_ce1: "Instituteur · CE1 A",
  instituteur_cm2: "Instituteur · CM2 A",
  parent: "Parent (tuteur)",
  eleve: "Élève",
  admin: "Administrateur",
  owner: "Propriétaire",
  teacher: "Enseignant",
  student: "Étudiant",
};

export function devRoleLabel(role: string): string {
  const known = DEV_ROLE_LABELS[role];
  if (known) return known;
  const spaced = role.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : role;
}

type DevCredentialRow = { tenant: string; role: string; email: string; password: string; totpSecret?: string };

function readDevCredentialRows(): DevCredentialRow[] | null {
  const file = process.env.DEV_CREDENTIALS_FILE?.trim();
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { accounts?: unknown };
    if (!parsed || !Array.isArray(parsed.accounts)) return null;
    const rows: DevCredentialRow[] = [];
    for (const raw of parsed.accounts) {
      const a = raw as Record<string, unknown> | null;
      if (!a || typeof a.email !== "string" || !a.email.trim()) continue;
      rows.push({
        tenant: typeof a.tenant === "string" ? a.tenant : "",
        role: typeof a.role === "string" ? a.role : "",
        email: a.email.trim(),
        password: typeof a.password === "string" ? a.password : "",
        ...(typeof a.totpSecret === "string" && a.totpSecret.trim() ? { totpSecret: a.totpSecret.trim() } : {}),
      });
    }
    return rows;
  } catch {
    // Fichier absent, illisible ou mal formé : retour au comportement par défaut (jamais d'erreur affichée).
    return null;
  }
}

/**
 * Comptes du fichier `DEV_CREDENTIALS_FILE` (même forme que `.demo/credentials.json`), ou `null` si la variable est
 * absente / le fichier illisible / vide. Le secret TOTP n'est JAMAIS inclus : il reste côté serveur.
 */
export function buildDevCredentialAccounts(): TechnicalAccount[] | null {
  const rows = readDevCredentialRows();
  if (!rows || rows.length === 0) return null;
  return rows.map((r) => ({
    email: r.email,
    password: r.password,
    role: r.role,
    name: r.email,
    tenant: r.tenant,
    label: devRoleLabel(r.role),
    mfa: Boolean(r.totpSecret),
  }));
}

/** Secret TOTP (base32) d'un compte du fichier, ou `null`. Réservé à la route `/api/technical-accounts/totp`. */
export function findDevTotpSecret(email: string): string | null {
  const wanted = email.trim().toLowerCase();
  const row = readDevCredentialRows()?.find((r) => r.email.toLowerCase() === wanted && r.totpSecret);
  return row?.totpSecret ?? null;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** TOTP RFC 6238 : SHA-1, 6 chiffres, pas de 30 s. */
export function totpAt(secret: string, timeMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const code = ((mac[o] & 0x7f) << 24) | ((mac[o + 1] & 0xff) << 16) | ((mac[o + 2] & 0xff) << 8) | (mac[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpSecondsLeft(timeMs: number = Date.now()): number {
  return 30 - (Math.floor(timeMs / 1000) % 30);
}
