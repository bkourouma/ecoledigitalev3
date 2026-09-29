/**
 * Technical accounts — SERVER ONLY.
 *
 * Never import this file from a client component: it holds real credentials.
 * The login page reaches it through `/api/technical-accounts`, which answers
 * only when `technicalAccountsEnabled()` is true.
 *
 * Mirrors the server provisioning logic so the login page can display the
 * technical accounts that exist for a given tenant.
 *
 * Keep in sync with `apps/api/src/services/tenant-provisioning.service.ts`:
 *   - getTechnicalAccountEmail(roleKey, slug) => `${roleKey}@${slug}.local`
 *   - DEFAULT_TECHNICAL_PASSWORD             => "Password@2025"
 *   - global roles seeded in migration 0055_unified_multitenancy.sql
 */

import type { TechnicalAccount } from "./technical-accounts";

const DEFAULT_TECHNICAL_PASSWORD = "Password@2025";

/** Global/system roles that get a technical account on every tenant. */
const SYSTEM_ROLES: { key: string; label: string }[] = [
  { key: "admin", label: "Administrateur" },
  { key: "owner", label: "Propriétaire" },
  { key: "teacher", label: "Enseignant" },
  { key: "student", label: "Étudiant" },
  { key: "parent", label: "Parent" },
];

/**
 * Surcharges de comptes réels par tenant + rôle : affichés (et utilisés au clic)
 * à la place du compte technique générique sur la page de connexion.
 */
const ACCOUNT_OVERRIDES: Record<string, Record<string, { email: string; password: string }>> = {
  ecoledigitale: {
    // Adjoua Brou : enseignante la plus chargée de la filière Intelligence
    // Artificielle — 8 ECUE, 57 séances pointées, 244 notes saisies et 4
    // bulletins de paie versés (2021-2022 → 2025-2026).
    teacher: { email: "adjoua.brou@ecoledigitale.test", password: "qvP2KbaeV%Dr" },
    // Adama Kouassi (ETU-2026-001) : l'aîné de la fratrie Kouassi, inscrit de
    // L1IA à M2IA — bulletins, présences, paiements et diplômes complets.
    student: { email: "adama.kouassi.001@etu.ecoledigitale.ci", password: "Ed2e0674bd6d!7" },
    // Bernard Kouassi : parent des deux enfants ci-dessus (Adama + Fatou),
    // pour voir le sélecteur d'enfant côté espace parent.
    parent: { email: "bernard.kouassi.p01@parents.ecoledigitale.ci", password: "Ed90d9773611!7" },
  },
};

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
  const overrides = ACCOUNT_OVERRIDES[tenantSlug] ?? {};
  return SYSTEM_ROLES.map((role) => {
    const ov = overrides[role.key];
    const email = ov?.email ?? `${role.key}@${tenantSlug}.local`;
    const password = ov?.password ?? DEFAULT_TECHNICAL_PASSWORD;
    return { email, password, role: role.key, name: email };
  });
}
