"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PeopleStudentSummaryDto } from "@ecoledigitale/contracts/v2/people";
import { usePermission } from "@/platform/access";
import { todayCivil } from "@/platform/v2/dates";
import { useStudents } from "@/platform/v2/people";
import { useTeachingContext, type MyClass } from "@/platform/v2/teaching";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useCallScope } from "../../attendance/_components/call-scope";
import { teacherHref } from "./hrefs";

/** Libellé des matières d'une classe pour l'enseignant (ses affectations ; « toutes les matières » pour un généraliste). */
function subjectsOf(c: MyClass, all: string): string[] {
  if (c.assignments.some((a) => a.coversAllSubjects)) return [all];
  return [...new Set(c.assignments.map((a) => a.nodeLabel).filter((n): n is string => Boolean(n)))];
}

/** « Mes classes » : uniquement les classes où l'enseignant est affecté aujourd'hui (l'API ne renvoie rien d'autre). */
export function TeacherClasses() {
  const t = useTranslations("v2Portal.teacher.classes");
  const tRoles = useTranslations("v2Staff.roles");
  const ctx = useTeachingContext();
  const canTake = usePermission("attendance.take").allowed;
  const callScope = useCallScope();
  const canCallClass = (c: MyClass) => canTake && (typeof c.educationLevelCode !== "string" || c.educationLevelCode === "" || callScope.allows(c.educationLevelCode, "DAILY"));
  const canGrade = usePermission("assessment.read").allowed;
  const tHalf = useTranslations("v2AttendanceHalfDays");
  const halfDaysOf = (c: MyClass) => (typeof c.educationLevelCode === "string" && c.educationLevelCode !== "" ? callScope.halfDays(c.educationLevelCode) : []);
  const today = todayCivil();
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {ctx.isLoading ? <LoadingBlock /> : null}
      {ctx.error ? <ErrorBlock error={ctx.error} onRetry={ctx.refetch} /> : null}
      {!ctx.isLoading && !ctx.error && ctx.classes.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("listLabel")}>
        {ctx.classes.map((c) => {
          const name = c.classroomName ?? t("unnamed");
          const subjects = subjectsOf(c, t("allSubjects"));
          const roles = [...new Set(c.assignments.map((a) => a.roleCode))];
          return (
            <li key={c.classroomId} className="flex flex-col justify-between gap-3 rounded-lg border p-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">{name}</h2>
                {c.classroomCode ? <p className="text-xs text-muted-foreground">{c.classroomCode}</p> : null}
                <p className="flex flex-wrap gap-1">
                  {roles.map((r) => (
                    <StatusBadge key={r} label={tRoles(r as never)} tone="info" />
                  ))}
                </p>
                {subjects.length > 0 ? <p className="text-sm text-muted-foreground">{subjects.join(", ")}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={teacherHref.classroom(c.classroomId)} className={buttonClass.secondary}>
                  {t("students")}
                  <span className="sr-only"> — {name}</span>
                </Link>
                {canGrade ? (
                  <Link href={teacherHref.assessments(c.classroomId)} className={buttonClass.secondary}>
                    {t("assessments")}
                    <span className="sr-only"> — {name}</span>
                  </Link>
                ) : null}
                {canCallClass(c) ? (
                  halfDaysOf(c).length > 0 ? (
                    // Deux appels par jour (primaire) : un lien par demi-journée.
                    halfDaysOf(c).map((part) => (
                      <Link key={part} href={teacherHref.dailyCall(c.classroomId, today, part)} className={buttonClass.secondary}>
                        {tHalf(`doCall.${part}`)}
                        <span className="sr-only"> — {name}</span>
                      </Link>
                    ))
                  ) : (
                    <Link href={teacherHref.dailyCall(c.classroomId, today)} className={buttonClass.secondary}>
                      {t("call")}
                      <span className="sr-only"> — {name}</span>
                    </Link>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Élèves d'UNE classe de l'enseignant. Garde côté écran : une classe qui n'est pas dans « mes classes » est refusée avant toute
 * lecture ; l'API reste la barrière (fiche réduite, 404 hors périmètre).
 */
export function TeacherClassDetail({ classroomId }: { classroomId: string }) {
  const t = useTranslations("v2Portal.teacher.classes.detail");
  const ctx = useTeachingContext();
  const linked = ctx.has(classroomId);
  if (ctx.isLoading) return <LoadingBlock />;
  if (ctx.error) return <ErrorBlock error={ctx.error} onRetry={ctx.refetch} />;
  if (!linked) {
    return (
      <div className="space-y-4">
        <Notice kind="warning">{t("notYours")}</Notice>
        <Link href="/v2/teacher/classes" className={buttonClass.secondary}>
          {t("back")}
        </Link>
      </div>
    );
  }
  return <Roster classroomId={classroomId} name={ctx.classroomName(classroomId) ?? t("unnamed")} />;
}

function Roster({ classroomId, name }: { classroomId: string; name: string }) {
  const t = useTranslations("v2Portal.teacher.classes.detail");
  const tStatus = useTranslations("v2Students.status");
  const canGrade = usePermission("assessment.read").allowed;
  const ctx = useTeachingContext();
  const callScope = useCallScope();
  const level = ctx.classes.find((c) => c.classroomId === classroomId)?.educationLevelCode;
  // Politique d'appel du cycle : pas d'appel journalier là où la politique l'interdit (niveau inconnu : l'API tranche).
  const canCall = usePermission("attendance.take").allowed && (typeof level !== "string" || level === "" || callScope.allows(level, "DAILY"));
  const query = useStudents({ classroomId, limit: 200 });
  const rows = query.data?.items ?? [];
  const columns: DataTableColumn<PeopleStudentSummaryDto>[] = [
    {
      id: "name",
      header: t("columns.name"),
      rowHeader: true,
      cell: (s) => (
        <Link href={`/v2/students/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {s.displayName}
        </Link>
      ),
    },
    { id: "number", header: t("columns.number"), cell: (s) => <span className="tabular-nums">{s.studentNumber}</span>, className: "hidden sm:table-cell" },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusBadge label={tStatus(s.status)} tone={s.status === "ACTIVE" ? "success" : "neutral"} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title={name}
        description={query.data ? t("count", { count: query.data.total }) : undefined}
        actions={
          <>
            <Link href="/v2/teacher/classes" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            {canGrade ? (
              <Link href={teacherHref.assessments(classroomId)} className={buttonClass.secondary}>
                {t("assessments")}
              </Link>
            ) : null}
            {canCall ? (
              <Link href={teacherHref.dailyCall(classroomId, todayCivil())} className={buttonClass.primary}>
                {t("call")}
              </Link>
            ) : null}
          </>
        }
      />
      <DataTable
        caption={t("caption", { name })}
        columns={columns}
        rows={rows}
        getRowId={(s) => s.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {query.data && query.data.total > rows.length ? <Notice kind="info">{t("truncated", { shown: rows.length, total: query.data.total })}</Notice> : null}
    </div>
  );
}
