"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMyEntitlements, useMyPermissions } from "@/platform/access";
import { useNavigation } from "@/platform/navigation/useNavigation";
import { buildV2Menu } from "../menu";
import { useTenantProfile } from "../tenancy/hooks";
import { Shell } from "./Shell";

/**
 * Coquille des écrans d'administration d'un tenant (`/v2/settings|access|audit`).
 *
 * Menu : `GET /api/v1/rbac/me/navigation` (portail `admin`), complété par les entrées v2 que l'API ne porte pas encore
 * et que l'utilisateur a le droit de voir (voir `buildV2Menu`). Le thème de marque (`--brand-*`) est posé globalement
 * par `TenantTheme` ; on y ajoute ici le nom et le logo de l'établissement.
 */
export function TenantAdminShell({ children, activePath }: { children: ReactNode; activePath?: string | null }) {
  const t = useTranslations("admin.shell");
  const nav = useNavigation({ portal: "admin" });
  const permissions = useMyPermissions();
  const entitlements = useMyEntitlements();
  const profile = useTenantProfile();

  const items = useMemo(
    () =>
      buildV2Menu({
        apiItems: nav.items,
        permissions: permissions.data?.permissions ?? null,
        features: entitlements.data?.features ?? null,
        labelOf: (key) => t(`menu.${key}` as never),
      }),
    [nav.items, permissions.data, entitlements.data, t],
  );

  const name = profile.data?.tradeName ?? profile.data?.legalName ?? t("tenantAdmin");
  const logo = profile.data?.branding.logoUrl;

  return (
    <Shell
      items={items}
      isLoading={nav.isLoading || permissions.isPending}
      navUnavailable={nav.isUnavailable && items.length === 0}
      navLabel={t("navLabel")}
      activePath={activePath}
      title={
        <span className="flex items-center gap-2">
          {logo && /^https:\/\/|^\/(?!\/)/.test(logo) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-7 w-7 rounded object-contain" />
          ) : null}
          <span className="truncate">{name}</span>
        </span>
      }
    >
      {children}
    </Shell>
  );
}
