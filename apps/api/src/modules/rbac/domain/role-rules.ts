/**
 * Règles pures de gestion des rôles : clés, anti-escalade de privilèges.
 */
import { can, type AuthorizationContext } from "./permission-set";
import type { ScopeTarget } from "./scope";
import { ROLE_KEY_RE } from "./system-roles";

/** `Directeur des études` → `directeur_des_etudes` (accents retirés, snake_case, 2..63 caractères). */
export function slugifyRoleKey(label: string): string {
  let key = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (key === "") key = "role";
  if (!/^[a-z]/.test(key)) key = `role_${key}`;
  if (key.length < 2) key = `${key}_role`;
  key = key.slice(0, 62).replace(/_+$/g, "");
  return ROLE_KEY_RE.test(key) ? key : "role";
}

/** Première clé libre parmi `base`, `base_2`, `base_3`… */
export function uniqueRoleKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i += 1) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new RangeError("Aucune clé de rôle libre.");
}

/**
 * Anti-escalade : permissions de `permissions` que l'acteur ne détient pas lui-même
 * sur `scope` (MFA comprise pour les sensibles). Un acteur ne peut accorder que ce
 * qu'il possède — sinon `rbac.role.manage` / `rbac.assignment.manage` seraient des
 * passe-droits vers `*`.
 */
export function missingPermissions(
  actor: AuthorizationContext,
  permissions: Iterable<string>,
  scope: ScopeTarget,
): string[] {
  const missing: string[] = [];
  for (const p of permissions) if (!can(actor, p, scope)) missing.push(p);
  return missing.sort();
}

/** Différence d'ensembles de permissions : `{ added, removed }` (triés). */
export function diffPermissions(
  before: Iterable<string>,
  after: Iterable<string>,
): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: [...a].filter((p) => !b.has(p)).sort(),
    removed: [...b].filter((p) => !a.has(p)).sort(),
  };
}
