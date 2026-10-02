/**
 * Menu des écrans d'administration v2 (fonctions pures).
 *
 * Source de vérité : `GET /api/v1/rbac/me/navigation` (filtré par permissions et droits du tenant). Les manifestes de
 * modules pointent encore vers les routes de l'ancien back-office (`/admin/roles`…) ; `mapToV2Href` les réécrit vers
 * les routes `/v2/...`. Les entrées v2 que l'API ne renvoie pas (module sans `menus`, ex. tenancy) sont ajoutées
 * localement MAIS seulement si la permission est détenue (jamais d'entrée pour une action refusée).
 */

import { hasPermission } from "@/platform/auth/policies";
import { sortMenuItems, type MenuItem } from "@/platform/navigation/types";

/** Routes historiques des manifestes -> routes v2. */
export const LEGACY_TO_V2_HREF: Readonly<Record<string, string>> = Object.freeze({
  "/admin/roles": "/v2/access/roles",
  "/admin/roles/attributions": "/v2/access/assignments",
  "/admin/audit": "/v2/audit",
  // Finance (écrans `app/v2/finance`) et paie (`app/v2/payroll`).
  "/admin/finance/factures": "/v2/finance/invoices",
  "/admin/finance/paiements": "/v2/finance/payments",
  "/admin/finance/paiements-en-ligne": "/v2/finance/payments/online",
  "/admin/finance/caisse": "/v2/finance/cash",
  "/admin/finance/frais": "/v2/finance/fees",
  "/admin/finance/rapports": "/v2/finance/reports",
  "/admin/finance/affectes-etat": "/v2/finance/funding",
  "/admin/finance/fournisseurs": "/v2/finance/providers",
  "/admin/paie": "/v2/payroll",
  "/admin/paie/configuration": "/v2/payroll/configuration",
  "/admin/paie/historique": "/v2/payroll/history",
  "/admin/paie/rapports": "/v2/payroll/reports",
  "/owner/masse-salariale": "/v2/payroll/owner",
  "/enseignant/remuneration": "/v2/payroll/my",
  // Présences et emploi du temps (manifestes `attendance` et `scheduling`).
  "/admin/attendance": "/v2/attendance/sessions",
  "/admin/attendance/justificatifs": "/v2/attendance/justifications",
  "/admin/attendance/personnel": "/v2/attendance/staff",
  "/admin/emploi-du-temps": "/v2/schedule/timetables",
  "/admin/emploi-du-temps/salles": "/v2/schedule/rooms",
  "/admin/emploi-du-temps/remplacements": "/v2/schedule/replacements",
});

export function mapToV2Href(href: string): string {
  return LEGACY_TO_V2_HREF[href] ?? href;
}

/** Entrées v2 « de secours » : portées par l'API quand le module déclare un menu, sinon ajoutées si permises. */
export const V2_ADMIN_ENTRIES: readonly (MenuItem & { labelKey: string })[] = [
  { key: "v2.settings", labelKey: "settings", label: "settings", href: "/v2/settings", permission: "tenancy.institution.read", portal: "admin", icon: "settings", order: 800 },
  { key: "v2.access.roles", labelKey: "roles", label: "roles", href: "/v2/access/roles", permission: "rbac.role.read", portal: "admin", icon: "shield", order: 900 },
  { key: "v2.access.assignments", labelKey: "assignments", label: "assignments", href: "/v2/access/assignments", permission: "rbac.assignment.manage", portal: "admin", icon: "user-cog", order: 910 },
  { key: "v2.audit", labelKey: "audit", label: "audit", href: "/v2/audit", permission: "audit.read", feature: "audit.log", portal: "admin", icon: "shield", order: 920 },
];

export interface BuildMenuInput {
  /** Entrées renvoyées par l'API (portail admin). */
  apiItems: readonly MenuItem[];
  /** Permissions détenues (clés) ; `null` tant qu'elles ne sont pas connues. */
  permissions: readonly string[] | null;
  /** Fonctionnalités actives du tenant ; `null` si inconnues. */
  features: readonly string[] | null;
  /** Traduit le libellé d'une entrée locale (`labelKey`). */
  labelOf: (labelKey: string) => string;
}

export function buildV2Menu({ apiItems, permissions, features, labelOf }: BuildMenuInput): MenuItem[] {
  const mapped = apiItems.map((item) => ({ ...item, href: mapToV2Href(item.href) }));
  const known = new Set(mapped.map((item) => item.href));
  const extras: MenuItem[] = [];
  if (permissions) {
    for (const entry of V2_ADMIN_ENTRIES) {
      if (known.has(entry.href)) continue;
      if (!hasPermission(permissions, entry.permission)) continue;
      if (entry.feature && !(features ?? []).includes(entry.feature)) continue;
      const { labelKey, ...item } = entry;
      extras.push({ ...item, label: labelOf(labelKey) });
    }
  }
  return sortMenuItems([...mapped, ...extras]);
}

/** Menu statique de la console plateforme (opérateurs) : l'API RBAC est propre aux tenants. */
export const OPERATOR_ENTRIES: readonly { key: string; labelKey: string; href: string; icon: string }[] = [
  { key: "platform.tenants", labelKey: "tenants", href: "/v2/platform/tenants", icon: "building" },
  { key: "platform.plans", labelKey: "plans", href: "/v2/platform/plans", icon: "credit-card" },
  { key: "platform.audit", labelKey: "audit", href: "/v2/platform/audit", icon: "shield" },
];

export function buildOperatorMenu(labelOf: (labelKey: string) => string): MenuItem[] {
  return OPERATOR_ENTRIES.map((e, index) => ({
    key: e.key,
    label: labelOf(e.labelKey),
    href: e.href,
    permission: "platform.operator",
    portal: "super-admin" as const,
    icon: e.icon,
    order: index,
  }));
}
