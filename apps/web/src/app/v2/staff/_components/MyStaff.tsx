"use client";

import { useTranslations } from "next-intl";
import { useMyClasses, useMyStaff } from "@/platform/v2/people";
import { useDateFormat } from "@/platform/ui/format";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ClassroomLabel } from "../../enrollments/_components/labels";
import { staffTone } from "./StaffScreen";

/** Espace de l'enseignant : sa fiche et les classes où il est affecté (données de `/people/me/*`, limitées à son compte). */
export function MyStaffScreen() {
  const t = useTranslations("v2Staff.me");
  const tStatus = useTranslations("v2Staff.status");
  const tRoles = useTranslations("v2Staff.roles");
  const date = useDateFormat();
  const me = useMyStaff();
  const classes = useMyClasses();

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {me.isPending && me.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {me.isError ? <ErrorBlock error={me.error} onRetry={() => void me.refetch()} /> : null}
      {me.data ? (
        <section aria-labelledby="me-profile" className="rounded-lg border p-4">
          <h2 id="me-profile" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
            {me.data.displayName} <StatusBadge label={tStatus(me.data.status)} tone={staffTone(me.data.status)} />
          </h2>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("number")}</dt>
              <dd>{me.data.staffNumber}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("jobTitle")}</dt>
              <dd>{me.data.jobTitle ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("hiredOn")}</dt>
              <dd>{me.data.hiredOn ? date.civil(me.data.hiredOn) : "—"}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      <section aria-labelledby="me-classes" className="space-y-2">
        <h2 id="me-classes" className="text-lg font-semibold">
          {t("classes")}
        </h2>
        {classes.isPending && classes.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {classes.isError ? <ErrorBlock error={classes.error} onRetry={() => void classes.refetch()} /> : null}
        {classes.data && classes.data.length === 0 ? <EmptyBlock title={t("noClasses")} /> : null}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("classes")}>
          {(classes.data ?? []).map((c) => (
            <li key={c.classroomId} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                <ClassroomLabel classroomId={c.classroomId} link={false} />
              </p>
              <p className="text-muted-foreground">{[...new Set(c.assignments.map((a) => tRoles(a.roleCode)))].join(", ")}</p>
              <p className="text-xs text-muted-foreground">{c.assignments.some((a) => a.coversAllSubjects) ? t("allSubjects") : t("subjects", { count: c.assignments.length })}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
