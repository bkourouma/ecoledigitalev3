/**
 * Menu global de la coque de gestion (fonctions PURES) : filtrage des entrées de l'API, regroupement par module, fil d'Ariane.
 *
 * Source de vérité : `GET /api/v1/rbac/me/navigation` (déjà filtré par permissions et fonctionnalités du tenant). Le web ne décide
 * rien : il retire seulement ce qui ne mène nulle part (entrée sans écran v2), les doublons de destination et les portails
 * famille/enseignant (qui ont leur propre coque).
 */

import { mapToV2Href } from "@/platform/admin/menu";
import { findActiveMenuKey, sortMenuItems, type MenuItem, type MenuPortal } from "@/platform/navigation/types";

/** Portails de l'API qui relèvent de la coque de gestion (les autres ont `PortalShell`). */
export const MANAGEMENT_PORTALS: readonly MenuPortal[] = ["admin", "owner"];

/** Module d'une entrée : préfixe de sa clé (`finance.invoices` -> `finance`) ; les entrées locales `v2.*` ont leur table. */
const LOCAL_MODULE: Readonly<Record<string, string>> = Object.freeze({ "v2.settings": "tenancy", "v2.access.roles": "rbac", "v2.access.assignments": "rbac", "v2.audit": "audit" });

export function moduleKeyOf(item: Pick<MenuItem, "key">): string {
  const local = LOCAL_MODULE[item.key];
  if (local) return local;
  const head = item.key.split(".")[0] ?? item.key;
  return head === "v2" ? "tenancy" : head;
}

/** Modules connus de l'API et libellés (clé i18n `v2Shell.modules.<clé>`) ; un module inconnu s'affiche avec sa clé lisible. */
export const KNOWN_MODULES: readonly string[] = [
  "analytics",
  "admissions",
  "academic",
  "people",
  "scheduling",
  "attendance",
  "assess",
  "results",
  "reportcards",
  "councils",
  "schoollife",
  "examinations",
  "primary",
  "higher",
  "stateassign",
  "finance",
  "payroll",
  "documents",
  "messaging",
  "notifications",
  "imports",
  "rules",
  "iam",
  "rbac",
  "tenancy",
  "audit",
];

export interface ManagementMenuInput {
  apiItems: readonly MenuItem[];
  /** Entrées locales (v2) que l'API ne porte pas encore, déjà filtrées par permission (voir `buildV2Menu`). */
  localItems?: readonly MenuItem[];
}

/** Entrées de gestion : portails admin + owner, réécrites vers /v2, sans entrée sans écran, sans doublon de destination. */
export function buildManagementEntries({ apiItems, localItems = [] }: ManagementMenuInput): MenuItem[] {
  const out: MenuItem[] = [];
  const seen = new Set<string>();
  const candidates = sortMenuItems([
    ...apiItems.filter((i) => (MANAGEMENT_PORTALS as readonly string[]).includes(i.portal)).map((i) => ({ ...i, href: mapToV2Href(i.href) })),
    ...localItems,
  ]);
  for (const item of candidates) {
    // Une entrée dont la route n'a pas été réécrite vers /v2 (`/admin/...`, `/owner/...`) n'a pas d'écran (aujourd'hui : `attendance.settings`,
    // `people.settings`, `scheduling.calendar`, `scheduling.validation`) : masquée tant que l'écran n'existe pas, jamais de lien mort.
    if (!item.href.startsWith("/v2/")) continue;
    const destination = item.href.split("?")[0]!;
    if (seen.has(destination) || seen.has(item.key)) continue;
    seen.add(destination);
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

export interface MenuModule {
  key: string;
  items: MenuItem[];
  /** Destination du module : sa première entrée (ordre du menu). */
  href: string;
}

/** Entrées regroupées par module, dans l'ordre de première apparition (l'ordre du menu fait foi). */
export function groupByModule(items: readonly MenuItem[]): MenuModule[] {
  const map = new Map<string, MenuModule>();
  for (const item of items) {
    const key = moduleKeyOf(item);
    const group = map.get(key) ?? { key, items: [], href: item.href };
    group.items.push(item);
    map.set(key, group);
  }
  return [...map.values()];
}

/** Module de l'entrée active du chemin courant, sinon `null`. */
export function activeModuleKey(items: readonly MenuItem[], pathname: string | null | undefined): string | null {
  const key = findActiveMenuKey(items, pathname);
  const item = key ? items.find((i) => i.key === key) : undefined;
  return item ? moduleKeyOf(item) : null;
}

export interface Crumb {
  label: string;
  /** Absent pour la page courante. */
  href?: string;
}

export interface BreadcrumbInput {
  items: readonly MenuItem[];
  pathname: string | null | undefined;
  homeLabel: string;
  homeHref: string;
  moduleLabelOf: (moduleKey: string) => string;
  /** Libellé du dernier segment quand la page est un détail (ex. « Détail ») ou n'a pas d'entrée de menu. */
  detailLabel: string;
  /** `false` : pas d'étape « module » (portails, dont le menu est plat). */
  withModule?: boolean;
}

/**
 * Fil d'Ariane : Accueil > Module > Entrée de menu > (Détail). Déduit du menu autorisé : aucune étape n'est inventée pour une
 * page hors menu (on n'affiche alors que l'accueil et la page).
 */
export function buildBreadcrumb({ items, pathname, homeLabel, homeHref, moduleLabelOf, detailLabel, withModule = true }: BreadcrumbInput): Crumb[] {
  const path = (pathname ?? "").split("?")[0] ?? "";
  const crumbs: Crumb[] = [];
  const atHome = path === homeHref || path === `${homeHref}/`;
  if (atHome) return [{ label: homeLabel }];
  crumbs.push({ label: homeLabel, href: homeHref });
  const activeKey = findActiveMenuKey(items, path);
  const active = activeKey ? items.find((i) => i.key === activeKey) : undefined;
  // Page hors menu (écran partagé, détail sans entrée) : aucune étape inventée, le fil se réduit à l'accueil (donc masqué).
  if (!active) return crumbs;
  const target = active.href.split("?")[0]!;
  const exact = path === target || path === `${target}/`;
  if (withModule) {
    const group = groupByModule(items).find((g) => g.key === moduleKeyOf(active));
    // Module à une seule entrée dont le libellé serait redondant avec l'entrée : une seule étape.
    const moduleLabel = moduleLabelOf(moduleKeyOf(active));
    if (group && moduleLabel !== active.label) crumbs.push({ label: moduleLabel, href: group.href });
  }
  crumbs.push(exact ? { label: active.label } : { label: active.label, href: active.href });
  if (!exact) crumbs.push({ label: detailLabel });
  return crumbs;
}
