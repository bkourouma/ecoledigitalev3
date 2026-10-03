"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { purgeOfflineDataBestEffort } from "@/platform/offline/purge";
import { useTranslations } from "next-intl";
import { useMyEntitlements, useMyPermissions } from "@/platform/access";
import { Shell } from "@/platform/admin/shell/Shell";
import { useTenantBranding } from "@/platform/theme/TenantTheme";
import { isAuthV2 } from "@/platform/auth/iam-config";
import { buildPortalMenu, type PortalKey } from "./menus";

/**
 * Coquille des portails famille et enseignant : barre du haut (établissement, compte, déconnexion), menu latéral (tiroir
 * sur mobile) filtré par permissions et fonctionnalités. Les gardes serveur des layouts et l'API restent les barrières.
 */
export function PortalShell({ portal, children, activePath }: { portal: PortalKey; children: ReactNode; activePath?: string | null }) {
  const t = useTranslations("v2Portal.shell");
  const tMenu = useTranslations(`v2Portal.menu.${portal}`);
  const permissions = useMyPermissions();
  const entitlements = useMyEntitlements();
  // Marque minimale (tout membre authentifié) : le profil complet exige `tenancy.institution.read` (403 pour parent, élève…).
  const branding = useTenantBranding();

  const items = useMemo(
    () =>
      buildPortalMenu({
        portal,
        permissions: permissions.data?.permissions ?? null,
        features: entitlements.data?.features ?? null,
        labelOf: (key) => tMenu(key as never),
      }),
    [portal, permissions.data, entitlements.data, tMenu],
  );

  const name = branding.data?.name ?? t("brand");
  const accountHref = isAuthV2() ? "/v2/account/security" : null;

  return (
    <Shell
      items={items}
      isLoading={permissions.isPending}
      navUnavailable={permissions.isError}
      navLabel={t(`navLabel.${portal}`)}
      activePath={activePath}
      title={
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate">{name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{t(`portal.${portal}`)}</span>
        </span>
      }
      headerRight={
        <>
          {accountHref ? (
            <Link href={accountHref} className="hidden h-11 items-center rounded-md px-3 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 sm:inline-flex">
              {t("account")}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void purgeOfflineDataBestEffort().then(() => signOut({ callbackUrl: "/login" }))}
            className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("signOut")}</span>
            <span className="sr-only sm:hidden">{t("signOut")}</span>
          </button>
        </>
      }
    >
      {children}
    </Shell>
  );
}
