/**
 * Navigation dérivée des permissions (fin des menus codés en dur et de
 * `admin_role_menus`). Fonction PURE : manifestes + droits + entitlements → menus
 * visibles, par portail.
 *
 * Une entrée est visible si ET SEULEMENT SI
 *   1. l'utilisateur détient `menu.permission` quelque part (périmètre `any`,
 *      MFA incluse pour une permission sensible) ;
 *   2. la `feature` du menu, si elle existe, est activée pour le tenant.
 */
import type { MenuDef, ModuleManifest } from "@ecoledigitale/kernel";
import { ANY_SCOPE } from "./scope";
import { can, type AuthorizationContext } from "./permission-set";

export type Portal = MenuDef["portal"];
export const PORTALS: readonly Portal[] = ["admin", "teacher", "parent", "student", "owner", "super-admin"];

/** Vue des entitlements du tenant (plan/pack/overrides) — port, implémenté par le module entitlements. */
export interface Entitlements {
  isEnabled(featureKey: string): boolean;
}

/** Entitlements à partir d'un ensemble de clés activées. */
export function entitlementsFromKeys(keys: Iterable<string>): Entitlements {
  const set = new Set(keys);
  return { isEnabled: (f) => set.has(f) };
}

/**
 * Entitlements par défaut quand le module n'est pas branché : seules les
 * features des modules `CORE` (« toujours disponibles ») sont actives.
 */
export function coreOnlyEntitlements(manifests: readonly ModuleManifest[]): Entitlements {
  const enabled = new Set<string>();
  for (const m of manifests) {
    for (const f of m.features) if (f.packs.includes("CORE")) enabled.add(f.key);
  }
  return entitlementsFromKeys(enabled);
}

export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly portal: Portal;
  readonly icon?: string;
  readonly order: number;
  readonly moduleKey: string;
  readonly permission: string;
  readonly feature?: string;
}

export interface Navigation {
  readonly portals: Readonly<Record<Portal, readonly NavItem[]>>;
  /** Portails ayant au moins une entrée (pour proposer un sélecteur de portail). */
  readonly availablePortals: readonly Portal[];
}

const DEFAULT_ORDER = 1000;

function compareItems(a: NavItem, b: NavItem): number {
  return a.order - b.order || a.label.localeCompare(b.label, "fr") || a.key.localeCompare(b.key);
}

export function buildNavigation(
  manifests: readonly ModuleManifest[],
  auth: AuthorizationContext,
  entitlements: Entitlements,
): Navigation {
  const portals = Object.fromEntries(PORTALS.map((p) => [p, [] as NavItem[]])) as Record<Portal, NavItem[]>;
  const seen = new Set<string>();

  for (const manifest of manifests) {
    for (const menu of manifest.menus) {
      if (seen.has(menu.key)) continue; // clé de menu dupliquée : première déclaration gagnante (déterministe par ordre des manifestes)
      if (!can(auth, menu.permission, ANY_SCOPE)) continue;
      if (menu.feature && !entitlements.isEnabled(menu.feature)) continue;
      const bucket = portals[menu.portal];
      if (!bucket) continue; // portail inconnu d'une version future : ignoré plutôt que affiché
      seen.add(menu.key);
      bucket.push(
        Object.freeze({
          key: menu.key,
          label: menu.label,
          href: menu.href,
          portal: menu.portal,
          order: menu.order ?? DEFAULT_ORDER,
          moduleKey: manifest.key,
          permission: menu.permission,
          ...(menu.icon ? { icon: menu.icon } : {}),
          ...(menu.feature ? { feature: menu.feature } : {}),
        }),
      );
    }
  }

  for (const p of PORTALS) portals[p].sort(compareItems);
  return Object.freeze({
    portals: Object.freeze(portals),
    availablePortals: Object.freeze(PORTALS.filter((p) => portals[p].length > 0)),
  });
}
