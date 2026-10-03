import type { ReactNode } from "react";
import { fetchPermissions, requireSession } from "@/platform/auth/server";
import { TenantAdminShell } from "@/platform/admin/shell/TenantAdminShell";
import { PortalShell } from "@/platform/portal/PortalShell";
import { activeRoleKey, isKnownRole, resolveShellKind, type ShellKind } from "./resolve-shell";

/**
 * Coque de navigation d'un écran `/v2` d'un établissement (SERVEUR : à poser dans le `layout.tsx` de chaque module).
 *
 * Choisie d'après la SESSION, jamais d'après l'URL :
 *   - gestion (propriétaire, direction, économat, secrétariat, études, examens, admissions, éducateur...) -> `TenantAdminShell` ;
 *   - parent / élève / enseignant (instituteur) -> `PortalShell` du portail correspondant.
 * Un écran partagé (ex. `/v2/finance/me/*`, `/v2/examinations/family`, `/v2/schoollife/saisie`) a donc la coque de celui qui le
 * consulte. Session obligatoire (sinon `/login`) ; la permission de chaque écran reste vérifiée par sa page, l'API par-dessus.
 *
 * Une seule coque par page : seul le layout de premier niveau d'un module la pose (test statique `shell-coverage.test.ts`).
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const kind = await shellKindOfSession(session);
  return kind.kind === "portal" ? <PortalShell portal={kind.portal}>{children}</PortalShell> : <TenantAdminShell>{children}</TenantAdminShell>;
}

/** Rôle actif connu : décidé sans appel réseau ; rôle inconnu : les permissions tranchent (indisponibles -> gestion). */
async function shellKindOfSession(session: Parameters<typeof fetchPermissions>[0]): Promise<ShellKind> {
  const input = { activeRole: session.activeRole, roles: session.roles };
  if (isKnownRole(activeRoleKey(input))) return resolveShellKind(input);
  return resolveShellKind(input, await fetchPermissions(session).catch(() => null));
}
