"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMyEntitlements, useMyPermissions } from "@/platform/access";
import { useNavigation } from "@/platform/navigation/useNavigation";
import { AccountMenu, SignOutButton } from "@/platform/shell/AccountMenu";
import { Breadcrumbs } from "@/platform/shell/Breadcrumbs";
import { useShellBranding } from "@/platform/shell/branding";
import { ShellMenuProvider } from "@/platform/shell/context";
import { moduleLabel } from "@/platform/shell/labels";
import { ModuleSwitcher } from "@/platform/shell/ModuleSwitcher";
import { activeModuleKey, buildBreadcrumb, buildManagementEntries, groupByModule, moduleKeyOf } from "@/platform/shell/modules";
import { buildV2Menu } from "../menu";
import { Shell } from "./Shell";

/** Page d'accueil de gestion (raccourcis par module). */
export const MANAGEMENT_HOME = "/v2/home";

/**
 * Coque de GESTION des écrans `/v2` (propriétaire, direction, économat, secrétariat, études, examens, admissions, éducateur...).
 *
 * Menu : `GET /api/v1/rbac/me/navigation` (portails `admin` et `owner`, déjà filtré par permissions et fonctionnalités),
 * complété par les entrées v2 que l'API ne porte pas encore et que l'utilisateur a le droit de voir (voir `buildV2Menu`), sans
 * entrée sans écran ni doublon (voir `buildManagementEntries`). Regroupé par module, avec changement de module, fil d'Ariane,
 * compte (rôle, établissement, sécurité) et déconnexion. Le nom et le logo de l'établissement viennent de la marque lisible par
 * tout membre (voir `useShellBranding`) ; le thème de marque (`--brand-*`) est posé globalement par `TenantTheme`.
 *
 * Choisie par `AppShell` selon le rôle de la session (jamais selon l'URL) ; les portails famille et enseignant ont `PortalShell`.
 */
export function TenantAdminShell({ children, activePath }: { children: ReactNode; activePath?: string | null }) {
  const t = useTranslations("admin.shell");
  const tShell = useTranslations("v2Shell");
  const tModules = useTranslations("v2Shell.modules");
  const nav = useNavigation({});
  const permissions = useMyPermissions();
  const entitlements = useMyEntitlements();
  const branding = useShellBranding();
  const pathname = usePathname();
  const currentPath = activePath ?? pathname;

  const items = useMemo(
    () =>
      buildManagementEntries({
        apiItems: buildV2Menu({
          apiItems: nav.items,
          permissions: permissions.data?.permissions ?? null,
          features: entitlements.data?.features ?? null,
          labelOf: (key) => t(`menu.${key}` as never),
        }),
      }),
    [nav.items, permissions.data, entitlements.data, t],
  );
  const modules = useMemo(() => groupByModule(items), [items]);
  const labelOf = useCallback((key: string) => moduleLabel(tModules, key), [tModules]);
  const grouping = useMemo(() => ({ moduleOf: moduleKeyOf, labelOf }), [labelOf]);
  const crumbs = useMemo(
    () => buildBreadcrumb({ items, pathname: currentPath, homeLabel: tShell("home"), homeHref: MANAGEMENT_HOME, moduleLabelOf: labelOf, detailLabel: tShell("detail") }),
    [items, currentPath, tShell, labelOf],
  );

  const name = branding.name ?? t("tenantAdmin");
  const loading = nav.isLoading || permissions.isPending;

  return (
    <ShellMenuProvider value={{ kind: "management", items, isLoading: loading }}>
      <Shell
        items={items}
        isLoading={loading}
        navUnavailable={nav.isUnavailable && items.length === 0}
        navLabel={t("navLabel")}
        activePath={activePath}
        grouping={grouping}
        wide
        breadcrumb={<Breadcrumbs crumbs={crumbs} />}
        title={
          <span className="flex items-center gap-2">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
            ) : null}
            <span className="truncate">{name}</span>
          </span>
        }
        headerCenter={<ModuleSwitcher modules={modules} activeKey={activeModuleKey(items, currentPath)} />}
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
