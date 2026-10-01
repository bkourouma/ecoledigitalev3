/**
 * Gardes serveur branchés sur NextAuth (`getServerSession`) et `next/navigation`.
 * À importer UNIQUEMENT depuis des layouts / pages / server components (jamais depuis un composant client).
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { resolveRequestTenant } from "@/platform/tenant/server";
import { MyPermissionsSchema, PERMISSIONS_ENDPOINT } from "@/platform/access/types";
import { createGuards } from "./guards";
import type { SessionLike } from "./policies";

/** En-tête posé par `middleware.ts` : chemin de la requête (les layouts n'y ont pas accès autrement). */
export const PATHNAME_HEADER = "x-pathname";

function apiBaseUrl(): string {
  // Même règle que lib/auth-options.ts.
  return process.env.API_INTERNAL_URL || process.env.API_URL || "http://localhost:4000";
}

export async function fetchPermissions(session: SessionLike): Promise<readonly string[] | null> {
  const token = typeof session.jwtToken === "string" ? session.jwtToken : null;
  if (!token) return null;
  const tenant = resolveRequestTenant(null, {
    tenantSlug: typeof session.tenantSlug === "string" ? session.tenantSlug : null,
    tenantId: typeof session.tenantId === "string" ? session.tenantId : null,
  });
  if (!tenant) return null;
  try {
    const response = await fetch(`${apiBaseUrl()}${PERMISSIONS_ENDPOINT}`, {
      headers: { Authorization: `Bearer ${token}`, "X-Tenant": tenant.key, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const parsed = MyPermissionsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.permissions : null;
  } catch {
    return null;
  }
}

export const { requireSession, requireRole, requireAccess, requirePermission } = createGuards<SessionLike>({
  getSession: () => getServerSession(authOptions) as Promise<SessionLike | null>,
  redirect: (path) => redirect(path),
  getPathname: async () => (await headers()).get(PATHNAME_HEADER),
  fetchPermissions,
});

export { FORBIDDEN_PATH, LOGIN_PATH, SELECT_ROLE_PATH } from "./guards";
