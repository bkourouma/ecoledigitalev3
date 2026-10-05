"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { GradeSyncProvider } from "@/platform/offline/GradeSyncProvider";
import type { HalfDay } from "@/platform/offline/attendance-outbox";
import { OutboxProvider } from "@/platform/offline/OutboxProvider";
import { useAttendanceSessions } from "@/platform/v2/attendance";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { useClassroomDirectory } from "@/platform/v2/directory";
import { useMyStaff } from "@/platform/v2/people";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { CallListScreen } from "../../attendance/_components/CallListScreen";
import { CallScreen } from "../../attendance/_components/CallScreen";
import { TEACHER_CALL_BASE, TEACHER_ROOT } from "./hrefs";

/**
 * Les écrans d'appel ont besoin de la file hors ligne, la grille de notes de ses brouillons locaux : l'une et l'autre sont fournies
 * à tout le portail enseignant (la reprise d'envoi se fait donc depuis n'importe quelle page du portail, pas seulement la grille).
 */
export function TeacherProviders({ children }: { children: React.ReactNode }) {
  return (
    <OutboxProvider>
      <GradeSyncProvider>{children}</GradeSyncProvider>
    </OutboxProvider>
  );
}

type SessionRow = NonNullable<ReturnType<typeof useAttendanceSessions>["data"]>["items"][number];

/**
 * « Mes appels » : les séances à faire aujourd'hui, l'appel journalier de mes classes, la file hors ligne (pointages en attente,
 * conflits à vérifier) puis l'historique de mes appels des 30 derniers jours. Le conflit d'un pointage est arbitré par la
 * direction : l'enseignant le voit ici, sans pouvoir l'écraser.
 */
export function TeacherAttendance() {
  return (
    <div className="space-y-10">
      <CallListScreen basePath={TEACHER_CALL_BASE} />
      <CallHistory />
    </div>
  );
}

function CallHistory() {
  const t = useTranslations("v2Portal.teacher.attendance.history");
  const tSession = useTranslations("v2Attendance.call.session");
  const tPart = useTranslations("v2AttendanceHalfDays.sessionPart");
  const date = useDateFormat();
  const me = useMyStaff();
  const classrooms = useClassroomDirectory();
  const today = todayCivil();
  const staffId = me.data?.id;
  const sessions = useAttendanceSessions({ from: addDays(today, -30), to: today, staffId, limit: 50 }, { enabled: staffId !== undefined });

  const columns: DataTableColumn<SessionRow>[] = [
    { id: "date", header: t("columns.date"), rowHeader: true, cell: (s) => date.civil(s.sessionDate) },
    { id: "classroom", header: t("columns.classroom"), cell: (s) => classrooms.name(s.classroomId) },
    { id: "scope", header: t("columns.scope"), cell: (s) => (s.scope === "DAILY" ? (s.dayPart === "FULL" ? t("daily") : `${t("daily")} · ${tPart(s.dayPart)}`) : t("session")), className: "hidden sm:table-cell" },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusBadge label={tSession(s.status)} tone={s.status === "OPEN" ? "info" : s.status === "CANCELLED" ? "neutral" : "success"} /> },
    {
      id: "open",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (s) => {
        const href = s.occurrenceId ? `${TEACHER_CALL_BASE}/occurrence/${s.occurrenceId}` : `${TEACHER_CALL_BASE}/daily/${s.classroomId}?date=${s.sessionDate}${s.dayPart === "FULL" ? "" : `&part=${s.dayPart}`}`;
        return (
          <Link href={href} className={buttonClass.ghost}>
            {t("open")}
          </Link>
        );
      },
    },
  ];

  return (
    <section aria-labelledby="call-history" className="space-y-3">
      <h2 id="call-history" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={sessions.data?.items ?? []}
        getRowId={(s) => s.id}
        isLoading={(me.isPending && me.fetchStatus !== "idle") || (sessions.isPending && sessions.fetchStatus !== "idle")}
        error={me.error ?? sessions.error}
        onRetry={() => void sessions.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
    </section>
  );
}

/** Appel d'une séance ou d'une classe, dans le portail : le retour mène à « Mes appels ». */
export function TeacherCall({ kind, id, date, dayPart }: { kind: "occurrence" | "daily"; id: string; date: string; dayPart?: HalfDay }) {
  return <CallScreen kind={kind} id={id} date={date} {...(dayPart ? { dayPart } : {})} backHref={`${TEACHER_ROOT}/attendance`} />;
}
