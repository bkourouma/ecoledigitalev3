/**
 * Bascule par portail du menu piloté par l'API (fonctions pures).
 *
 * `NEXT_PUBLIC_PLATFORM_NAV` :
 *   absent / "0" / ""  -> désactivé partout (Sidebar legacy, aucun appel réseau) ;
 *   "1" / "true" / "all" -> activé pour tous les portails ;
 *   "admin,teacher"    -> activé uniquement pour ces portails.
 */

import { MENU_PORTALS, type MenuPortal } from "./types";

export function parsePlatformNavFlag(raw: string | null | undefined): "all" | ReadonlySet<MenuPortal> | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "0" || value === "false" || value === "off") return null;
  if (value === "1" || value === "true" || value === "all" || value === "on") return "all";
  const portals = value
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is MenuPortal => (MENU_PORTALS as readonly string[]).includes(p));
  return portals.length > 0 ? new Set(portals) : null;
}

export function isPlatformNavEnabled(raw: string | null | undefined, portal: MenuPortal | null): boolean {
  const flag = parsePlatformNavFlag(raw);
  if (flag === null || portal === null) return false;
  return flag === "all" || flag.has(portal);
}

/** Portail d'un utilisateur selon son rôle actif (sinon son premier rôle). Même table que `routeForRole`. */
export function portalForRole(role: string | null | undefined): MenuPortal | null {
  switch (String(role ?? "").toLowerCase()) {
    case "owner":
      return "owner";
    case "admin":
    case "super_admin": // même regroupement que isAdminRole() du Sidebar legacy
    case "administrateur":
      return "admin";
    case "teacher":
    case "enseignant":
      return "teacher";
    case "parent":
      return "parent";
    case "student":
    case "étudiant":
    case "etudiant":
      return "student";
    default:
      return null;
  }
}
