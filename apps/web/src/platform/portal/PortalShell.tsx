"use client";

import { useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMyEntitlements, useMyPermissions } from "@/platform/access";
import { Shell } from "@/platform/admin/shell/Shell";
import { AccountMenu, SignOutButton } from "@/platform/shell/AccountMenu";
import { Breadcrumbs } from "@/platform/shell/Breadcrumbs";
import { useShellBranding } from "@/platform/shell/branding";
import { ShellMenuProvider } from "@/platform/shell/context";
import { buildBreadcrumb } from "@/platform/shell/modules";
import { buildPortalMenu, PORTAL_ROOT, type PortalKey } from "./menus";

/**
 * Coque des portails famille et enseignant : barre du haut (établissement, compte, déconnexion), menu latéral (tiroir
 * sur mobile) filtré par permissions et fonctionnalités, fil d'Ariane. Les gardes serveur des layouts et l'API restent les
 * barrières. Choisie par `AppShell` selon le rôle de la session : les écrans partagés avec la gestion (finance, examens,
 * vie scolaire...) s'affichent dans cette coque quand c'est un parent, un élève ou un enseignant qui les consulte.
 */
export function PortalShell({ portal, children, activePath }: { portal: PortalKey; children: ReactNode; activePath?: string | null }) {
  const t = useTranslations("v2Portal.shell");
  const tShell = useTranslations("v2Shell");
  const tMenu = useTranslations(`v2Portal.menu.${portal}`);
  const permissions = useMyPermissions();
  const entitlements = useMyEntitlements();
  const branding = useShellBranding();
  const pathname = usePathname();
  const currentPath = activePath ?? pathname;

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
  const crumbs = useMemo(
    () =>
      buildBreadcrumb({
        items,
        pathname: currentPath,
        homeLabel: t(`portal.${portal}`),
        homeHref: PORTAL_ROOT[portal],
        moduleLabelOf: (key) => key,
        detailLabel: tShell("detail"),
        withModule: false,
      }),
    [items, currentPath, portal, t, tShell],
  );

  const name = branding.name ?? t("brand");

  return (
    <ShellMenuProvider value={{ kind: "portal", portal, items, isLoading: permissions.isPending }}>
      <Shell
        items={items}
        isLoading={permissions.isPending}
        navUnavailable={permissions.isError}
        navLabel={t(`navLabel.${portal}`)}
        activePath={activePath}
        breadcrumb={<Breadcrumbs crumbs={crumbs} />}
        title={
          <span className="flex min-w-0 items-center gap-2">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded object-contain" />
            ) : null}
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate">{name}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">{t(`portal.${portal}`)}</span>
            </span>
          </span>
        }
        headerRight={
          <>
            <AccountMenu />
            <SignOutButton />
          </>
        }
      >
        {children}
      </Shell>
    </ShellMenuProvider>
  );
}
