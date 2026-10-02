"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PeopleStudentSummaryDto } from "@ecoledigitale/contracts/v2/people";
import { childSectionHref } from "@/platform/portal/menus";
import { ChildScope } from "@/platform/portal/ChildScope";
import { useMyChildren } from "@/platform/v2/people";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { AnnouncementsEntry, FamilySnapshot } from "../../_family/FamilySnapshot";
import { childLinks } from "./links";

/**
 * Accueil du parent : un bloc par enfant lié (l'API ne renvoie QUE les enfants dont le compte est tuteur vivant avec accès au portail),
 * avec les repères du moment (moyenne publiée, absences, scolarité restante, prochaines séances). Aucun enfant : message explicatif.
 */
export function ParentHome() {
  const t = useTranslations("v2Portal.parent.home");
  const tStatus = useTranslations("v2Students.status");
  const children = useMyChildren();
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {children.isPending ? <LoadingBlock /> : null}
      {children.isError ? <ErrorBlock error={children.error} onRetry={() => void children.refetch()} /> : null}
      {children.data && children.data.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <ul className="space-y-8" aria-label={t("listLabel")}>
        {(children.data ?? []).map((c) => (
          <li key={c.id}>
            <section aria-labelledby={`child-${c.id}`} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 id={`child-${c.id}`} className="text-xl font-semibold">
                    {c.displayName}
                  </h2>
                  <p className="text-sm text-muted-foreground">{c.currentEnrollment?.classroomName ?? t("notEnrolled")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge label={tStatus(c.status)} tone={c.status === "ACTIVE" ? "success" : "neutral"} />
                  <Link href={childSectionHref(c.id, "")} className={buttonClass.secondary}>
                    {t("open")}
                    <span className="sr-only"> — {c.displayName}</span>
                  </Link>
                </div>
              </div>
              <FamilySnapshot subject={{ kind: "child", id: c.id }} links={childLinks(c.id)} />
            </section>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tableau de bord d'un enfant : repères du moment + annonces. */
export function ChildDashboard({ childId }: { childId: string }) {
  return (
    <ChildScope childId={childId}>
      {(child) => <ChildDashboardBody child={child} />}
    </ChildScope>
  );
}

function ChildDashboardBody({ child }: { child: PeopleStudentSummaryDto }) {
  const t = useTranslations("v2Portal.parent.dashboard");
  return (
    <div className="space-y-6">
      <PageHeader title={child.displayName} description={child.currentEnrollment?.classroomName ?? t("notEnrolled")} />
      <FamilySnapshot subject={{ kind: "child", id: child.id }} links={childLinks(child.id)} />
      <AnnouncementsEntry />
    </div>
  );
}
