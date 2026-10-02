"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PeopleStudentSummaryDto } from "@ecoledigitale/contracts/v2/people";
import { useMyEntitlements, useMyPermissions } from "@/platform/access";
import { cn } from "@/lib/utils";
import { useMyChildren } from "@/platform/v2/people";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { NativeSelect } from "@/platform/ui/FormField";
import { childSectionHref, switchChildPath, visibleChildSections } from "./menus";

/**
 * Garde de tutelle côté écran : tant que l'API des personnes n'a pas confirmé que `childId` est l'un des enfants LIÉS au compte
 * (lien vivant avec accès au portail), AUCUNE lecture de données de cet enfant n'est lancée. Hors de cette liste : message
 * explicite (jamais de page vide ni de données d'un autre élève). Les lectures qui suivent restent revérifiées par chaque module.
 */
export function ChildScope({ childId, children }: { childId: string; children: (child: PeopleStudentSummaryDto) => ReactNode }) {
  const t = useTranslations("v2Portal.child");
  const tCommon = useTranslations("common");
  const list = useMyChildren();
  // Établissement inconnu : la requête est suspendue (aucune lecture sans tenant), on le dit au lieu d'attendre sans fin.
  if (list.isPending && list.fetchStatus === "idle") return <Notice kind="warning">{tCommon("tenantUnknown")}</Notice>;
  if (list.isPending) return <LoadingBlock />;
  if (list.isError) return <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />;
  const child = list.data.find((c) => c.id === childId);
  if (!child) {
    return (
      <div className="space-y-4">
        <Notice kind="warning">{t("notLinked")}</Notice>
        <Link href="/v2/parent" className={buttonClass.secondary}>
          {t("backToChildren")}
        </Link>
      </div>
    );
  }
  return <>{children(child)}</>;
}

/**
 * En-tête commun des pages d'un enfant : sélecteur d'enfant (plusieurs enfants) et onglets des sections accessibles.
 * Les onglets suivent les permissions du parent ; l'API reste la barrière.
 */
export function ChildHeader({ childId }: { childId: string }) {
  const t = useTranslations("v2Portal.child");
  const tSec = useTranslations("v2Portal.child.sections");
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const list = useMyChildren();
  const permissions = useMyPermissions();
  const entitlements = useMyEntitlements();
  const children = list.data ?? [];
  const sections = visibleChildSections(permissions.data?.permissions ?? null, entitlements.data?.features ?? null);
  const linked = children.some((c) => c.id === childId);
  const current = pathname.replace(/\/+$/, "");

  return (
    <div className="mb-6 space-y-3">
      {children.length > 1 ? (
        <div className="max-w-sm">
          <label htmlFor="portal-child-select" className="mb-1 block text-sm font-medium">
            {t("switcherLabel")}
          </label>
          <NativeSelect
            id="portal-child-select"
            value={linked ? childId : ""}
            onChange={(next) => next && next !== childId && router.push(switchChildPath(pathname, next))}
            placeholder={linked ? undefined : t("switcherPlaceholder")}
            options={children.map((c) => ({ value: c.id, label: c.currentEnrollment?.classroomName ? `${c.displayName} — ${c.currentEnrollment.classroomName}` : c.displayName }))}
          />
        </div>
      ) : null}
      {linked ? (
        <nav aria-label={t("tabsLabel")} className="overflow-x-auto border-b">
          <ul className="flex min-w-max gap-1">
            {sections.map((s) => {
              const href = childSectionHref(childId, s.segment);
              const active = s.segment === "" ? current === href : current === href || current.startsWith(`${href}/`);
              return (
                <li key={s.key}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10",
                      active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tSec(s.labelKey as never)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
