"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useAttendanceSessions } from "@/platform/v2/attendance";
import { useClassroomDirectory } from "@/platform/v2/directory";
import { useMyToday, type OccurrenceDto } from "@/platform/v2/scheduling";
import { useTeachingContext } from "@/platform/v2/teaching";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { OccurrenceCard, type Directories } from "../../schedule/_components/OccurrenceCard";
import { teacherHref } from "./hrefs";

const unknownDirectory = { name: () => "—", find: () => null, isLoading: false };

/**
 * « Aujourd'hui » de l'enseignant : ses séances du jour dans l'ordre, l'état de l'appel de chacune et les gestes rapides —
 * Faire l'appel, Saisir les notes de la classe. Tout vient de l'API (séances de SON emploi du temps, appels de l'établissement
 * filtrés par ses droits) ; aucune règle d'horaire ni d'appel côté écran.
 */
export function TeacherToday() {
  const t = useTranslations("v2Portal.teacher.today");
  const tSession = useTranslations("v2Attendance.call.session");
  const date = useDateFormat();
  const ctx = useTeachingContext();
  const today = useMyToday();
  const day = today.data?.date ?? null;
  const canCall = usePermission("attendance.take").allowed;
  const canGrade = usePermission("grade.enter").allowed;
  const sessions = useAttendanceSessions({ date: day ?? undefined, limit: 200 }, { enabled: day !== null && canCall });
  const classrooms = useClassroomDirectory();
  const dirs: Directories = { classrooms, staff: unknownDirectory, rooms: unknownDirectory };
  const sessionOf = new Map((sessions.data?.items ?? []).filter((s) => s.occurrenceId).map((s) => [s.occurrenceId as string, s]));

  const items = (today.data?.items ?? []).map((o): OccurrenceDto => ({ ...o, title: o.title ?? ctx.nodeLabel(o.curriculumNodeId) }));
  const live = items.filter((o) => o.status !== "CANCELLED");
  const toDo = live.filter((o) => {
    const s = sessionOf.get(o.id);
    return !s || s.status === "OPEN";
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={day ? t("description", { date: date.civil(day) }) : t("descriptionNoDate")} />
      {today.isPending ? <LoadingBlock /> : null}
      {today.isError ? <ErrorBlock error={today.error} onRetry={() => void today.refetch()} /> : null}
      {today.data ? (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="rounded-lg border p-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("sessions")}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{live.length}</dd>
            </div>
            {canCall ? (
              <div className="rounded-lg border p-3">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("callsToDo")}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{sessions.isPending && sessions.fetchStatus !== "idle" ? "…" : toDo.length}</dd>
              </div>
            ) : null}
          </dl>
          {items.length === 0 ? (
            <EmptyBlock title={t("empty")} description={t("emptyHint")} />
          ) : (
            <ul className="space-y-3">
              {items.map((o) => {
                const s = sessionOf.get(o.id);
                const cancelled = o.status === "CANCELLED";
                return (
                  <li key={o.id}>
                    <OccurrenceCard
                      o={o}
                      dirs={dirs}
                      actions={
                        cancelled ? null : (
                          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                            <span className="sm:mr-auto">{canCall ? <StatusBadge label={s ? tSession(s.status) : t("callToDo")} tone={s ? (s.status === "OPEN" ? "info" : "success") : "warning"} /> : null}</span>
                            {canCall ? (
                              <Link href={teacherHref.call(o.id)} className={buttonClass.primary}>
                                {s && s.status !== "OPEN" ? t("seeCall") : t("doCall")}
                              </Link>
                            ) : null}
                            {canGrade && o.classroomId ? (
                              <Link href={teacherHref.assessments(o.classroomId)} className={buttonClass.secondary}>
                                {t("enterGrades")}
                              </Link>
                            ) : null}
                          </div>
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
