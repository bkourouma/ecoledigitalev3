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
