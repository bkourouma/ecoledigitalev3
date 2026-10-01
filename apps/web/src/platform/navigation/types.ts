/**
 * Contrat de `GET /api/v1/rbac/me/navigation`.
 *
 * Aligné sur `MenuDef` de `packages/kernel/src/module.ts` : `key, label, href, permission, feature?, portal,
 * icon?, order?`. L'API renvoie DÉJÀ le menu filtré (permissions de l'utilisateur + entitlements du
 * tenant) : le web n'a rien à décider, il affiche. Quand `packages/contracts/src/v2/*` publiera ce schéma,
 * remplacer cette définition par un import.
 *
 * Réponses acceptées : `{ items: MenuItem[] }` ou directement `MenuItem[]`.
 */

import { z } from "zod";

export const MENU_PORTALS = ["admin", "teacher", "parent", "student", "owner", "super-admin"] as const;
export type MenuPortal = (typeof MENU_PORTALS)[number];

export const MenuItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /** Route web cible (chemin interne). */
  href: z.string().startsWith("/"),
  permission: z.string(),
  feature: z.string().optional(),
  portal: z.enum(MENU_PORTALS),
  icon: z.string().optional(),
  order: z.number().optional(),
});
export type MenuItem = z.infer<typeof MenuItemSchema>;

/**
 * Formes acceptées : `{ items }`, un tableau nu, ou la réponse réelle du kernel
 * `{ portals: { admin: [...], teacher: [...], ... }, availablePortals }` (contrat `rbacNavigationResponseSchema`),
 * aplatie en une liste (chaque entrée porte déjà son `portal`).
 */
export const NavigationResponseSchema = z
  .union([
    z.object({ items: z.array(MenuItemSchema) }),
    z.array(MenuItemSchema),
    z.object({ portals: z.record(z.array(MenuItemSchema)) }),
  ])
  .transform((value): MenuItem[] => {
    if (Array.isArray(value)) return value;
    if ("items" in value) return value.items;
    return Object.values(value.portals).flat();
  });
export type NavigationResponse = z.output<typeof NavigationResponseSchema>;

export const NAVIGATION_ENDPOINT = "/api/v1/rbac/me/navigation";

/** Tri d'affichage : `order` croissant (absent = fin), puis libellé. */
export function sortMenuItems(items: readonly MenuItem[]): MenuItem[] {
  return [...items].sort((a, b) => {
    const byOrder = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    return byOrder !== 0 ? byOrder : a.label.localeCompare(b.label, "fr");
  });
}

/** Clé de l'entrée active : la plus spécifique (href le plus long) qui préfixe le chemin courant. */
export function findActiveMenuKey(items: readonly MenuItem[], pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  let best: MenuItem | null = null;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(item.href.endsWith("/") ? item.href : `${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}
