"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useAttendanceSessions } from "@/platform/v2/attendance";
import { useClassroomDirectory, useRoomDirectory, useStaffDirectory } from "@/platform/v2/directory";
import { useMyToday } from "@/platform/v2/scheduling";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { OccurrenceCard } from "./OccurrenceCard";

/** Saisie des notes : entrée « Mes évaluations » du menu enseignant (manifeste du module `assess`). */
export const GRADES_ENTRY_HREF = "/teacher/evaluations";

/**
 * « Aujourd'hui » de l'enseignant : ses séances du jour dans l'ordre, l'état de l'appel de chacune et les actions
 * rapides (faire l'appel, saisir les notes quand le module d'évaluation est actif pour lui).
 */
export function TodayScreen() {
  const t = useTranslations("v2Schedule.today");
  const tSession = useTranslations("v2Attendance.call.session");
  const date = useDateFormat();
  const today = useMyToday();
  const day = today.data?.date ?? null;
  const sessions = useAttendanceSessions({ date: day ?? undefined, limit: 200 }, { enabled: day !== null });
  const canCall = usePermission("attendance.take").allowed;
  const canGrade = usePermission("grade.enter").allowed;
  const dirs = { classrooms: useClassroomDirectory(), staff: useStaffDirectory(), rooms: useRoomDirectory() };
  const sessionOf = new Map((sessions.data?.items ?? []).filter((s) => s.occurrenceId).map((s) => [s.occurrenceId as string, s]));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={day ? t("description", { date: date.civil(day) }) : t("descriptionNoDate")} />
      {today.isPending ? (
        <LoadingBlock />
      ) : today.isError ? (
        <ErrorBlock error={today.error} onRetry={() => void today.refetch()} />
      ) : today.data.items.length === 0 ? (
        <EmptyBlock title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ul className="space-y-3">
          {today.data.items.map((o) => {
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
                        <span className="sm:mr-auto">
                          {canCall ? <StatusBadge label={s ? tSession(s.status) : t("callToDo")} tone={s ? (s.status === "OPEN" ? "info" : "success") : "warning"} /> : null}
                        </span>
                        {canCall ? (
                          <Link href={`/v2/attendance/call/occurrence/${o.id}`} className={buttonClass.primary}>
                            {s && s.status !== "OPEN" ? t("seeCall") : t("doCall")}
                          </Link>
                        ) : null}
                        {canGrade ? (
                          <Link href={GRADES_ENTRY_HREF} className={buttonClass.secondary}>
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
    </div>
  );
}
