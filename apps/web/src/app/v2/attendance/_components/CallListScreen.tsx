"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useAttendanceSessions } from "@/platform/v2/attendance";
import { todayCivil } from "@/platform/v2/dates";
import { useClassroomDirectory } from "@/platform/v2/directory";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { useMyClasses } from "@/platform/v2/people";
import { useMyToday } from "@/platform/v2/scheduling";
import type { HalfDay } from "@/platform/offline/attendance-outbox";
import { useOutboxManager, useOutboxStatus } from "@/platform/offline/OutboxProvider";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { partQuery } from "./call-utils";
import { useCallScope, type CallScopeKind } from "./call-scope";
import { OfflineIndicator } from "./OfflineIndicator";

/** « Mes séances à faire » : les séances du jour de l'enseignant, l'appel journalier de ses classes, la file hors ligne. */
export function CallListScreen({ basePath = "/v2/attendance/call" }: { basePath?: string } = {}) {
  const t = useTranslations("v2Attendance.callList");
  const tSession = useTranslations("v2Attendance.call.session");
  const tHalf = useTranslations("v2AttendanceHalfDays");
  const format = useFormatter();
  const canRead = usePermission("schedule.own.read");
  const today = useMyToday(canRead.allowed);
  const date = today.data?.date ?? todayCivil();
  const sessions = useAttendanceSessions({ date, limit: 200 });
  const myClasses = useMyClasses();
  const classrooms = useClassroomDirectory();

  const callScope = useCallScope();
  // Politique d'appel du cycle : on ne propose pas un type d'appel que l'API refuserait (409 `attendance.call_scope_not_allowed`).
  // Niveau inconnu (classe hors « mes classes », API ancienne) : tout est proposé, l'API tranche.
  const levelOfClass = new Map<string, string>();
  for (const c of myClasses.data ?? []) if (typeof c.educationLevelCode === "string" && c.educationLevelCode !== "") levelOfClass.set(c.classroomId, c.educationLevelCode);
  const allows = (classroomId: string | null, scope: CallScopeKind) => {
    const level = classroomId ? levelOfClass.get(classroomId) : undefined;
    return level === undefined ? true : callScope.allows(level, scope);
  };

  const sessionOfOccurrence = new Map<string, NonNullable<typeof sessions.data>["items"][number]>();
  for (const s of sessions.data?.items ?? []) if (s.occurrenceId) sessionOfOccurrence.set(s.occurrenceId, s);
  const dailySessions = (sessions.data?.items ?? []).filter((s) => s.scope === "DAILY");
  const todayOccurrences = (today.data?.items ?? []).filter((o) => allows(o.classroomId, "SESSION"));
  const dailyClasses = (myClasses.data ?? []).filter((c) => allows(c.classroomId, "DAILY"));
  const sessionCallHidden = (today.data?.items ?? []).length > 0 && todayOccurrences.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <OfflineIndicator />

      <section aria-labelledby="today-title" className="space-y-3">
        <h2 id="today-title" className="text-lg font-semibold">
          {t("todayTitle")}
        </h2>
        {!canRead.allowed && !canRead.isLoading ? (
          <Notice kind="info">{t("noScheduleAccess")}</Notice>
        ) : today.isPending ? (
          <LoadingBlock />
        ) : today.isError ? (
          <ErrorBlock error={today.error} onRetry={() => void today.refetch()} />
        ) : sessionCallHidden ? (
          <Notice kind="info">{t("sessionCallNotAllowed")}</Notice>
        ) : todayOccurrences.length === 0 ? (
          <EmptyBlock title={t("emptyToday")} description={t("emptyTodayHint")} />
        ) : (
          <ul className="space-y-2">
            {todayOccurrences.map((o) => {
              const s = sessionOfOccurrence.get(o.id);
              const time = `${format.dateTime(new Date(o.startsAt), { timeStyle: "short" })} – ${format.dateTime(new Date(o.endsAt), { timeStyle: "short" })}`;
              return (
                <li key={o.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-card/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{time}</p>
                    <p className="truncate text-sm">
                      {o.title ?? t("untitled")} · {classrooms.name(o.classroomId)}
                    </p>
                    <p className="mt-1">
                      <StatusBadge label={s ? tSession(s.status) : t("notDone")} tone={s ? (s.status === "OPEN" ? "info" : s.status === "CANCELLED" ? "neutral" : "success") : "warning"} />
                    </p>
                  </div>
                  <Link href={`${basePath}/occurrence/${o.id}`} className={buttonClass.primary}>
                    {s && s.status !== "OPEN" ? t("view") : t("doCall")}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {dailyClasses.length > 0 || (myClasses.data ?? []).length === 0 ? (
      <section aria-labelledby="daily-title" className="space-y-3">
        <h2 id="daily-title" className="text-lg font-semibold">
          {t("dailyTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("dailyHint")}</p>
        {dailyClasses.length > 0 ? (
          <ul className="space-y-2">
            {dailyClasses.map((c) => {
              // Cycle à deux appels par jour (primaire, Q-P17) : une ligne par demi-journée, chacune avec son état ; sinon une seule ligne.
              const parts = callScope.halfDays(levelOfClass.get(c.classroomId));
              if (parts.length > 0) {
                return (
                  <li key={c.classroomId} className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{classrooms.name(c.classroomId)}</p>
                      <p className="text-xs text-muted-foreground">{tHalf("listHint")}</p>
                    </div>
                    <ul className="space-y-2">
                      {parts.map((part) => {
                        const done = dailySessions.find((s) => s.classroomId === c.classroomId && s.dayPart === part);
                        return (
                          <li key={part} className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <span className="text-sm">{tHalf(`parts.${part}`)}</span>{" "}
                              {done ? <StatusBadge label={tSession(done.status)} tone={done.status === "OPEN" ? "info" : "success"} /> : null}
                            </div>
                            <Link href={`${basePath}/daily/${c.classroomId}?date=${date}${partQuery(part)}`} className={buttonClass.secondary}>
                              {tHalf(`doCall.${part}`)}
                              <span className="sr-only"> — {classrooms.name(c.classroomId)}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              }
              const done = dailySessions.find((s) => s.classroomId === c.classroomId);
              return (
                <li key={c.classroomId} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-card/40 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{classrooms.name(c.classroomId)}</p>
                    {done ? <StatusBadge label={tSession(done.status)} tone={done.status === "OPEN" ? "info" : "success"} /> : null}
                  </div>
                  <Link href={`${basePath}/daily/${c.classroomId}?date=${date}`} className={buttonClass.secondary}>
                    {t("dailyCall")}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        <Can permission="attendance.manage">
          <OtherCall date={date} />
        </Can>
      </section>
      ) : (
        <Can permission="attendance.manage">
          <section aria-labelledby="daily-title" className="space-y-3">
            <h2 id="daily-title" className="text-lg font-semibold">
              {t("dailyTitle")}
            </h2>
            <OtherCall date={date} />
          </section>
        </Can>
      )}

      <OutboxList basePath={basePath} />
    </div>
  );
}

/** Direction : ouvrir l'appel journalier de n'importe quelle classe, à une date donnée. */
function OtherCall({ date }: { date: string }) {
  const t = useTranslations("v2Attendance.callList");
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [day, setDay] = useState(date);
  const tHalf = useTranslations("v2AttendanceHalfDays");
  // La direction ouvre l'appel de n'importe quelle classe : la demi-journée se choisit (vide = journée entière, cycle à appel unique).
  const [part, setPart] = useState<"" | HalfDay>("");
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-card/40 p-3 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-end">
      <FormField label={t("otherClass")}>{(c) => <SelectAsync {...c} value={classroom} onChange={setClassroom} useOptions={useClassroomOptions} placeholder={t("chooseClass")} />}</FormField>
      <FormField label={t("otherDate")}>{(c) => <TextControl {...c} type="date" value={day} onChange={setDay} />}</FormField>
      <FormField label={tHalf("otherPart")} hint={tHalf("otherPartHint")}>
        {(c) => (
          <NativeSelect
            {...c}
            value={part}
            onChange={(v) => setPart(v === "MORNING" || v === "AFTERNOON" ? v : "")}
            options={[
              { value: "", label: tHalf("otherPartFull") },
              { value: "MORNING", label: tHalf("parts.MORNING") },
              { value: "AFTERNOON", label: tHalf("parts.AFTERNOON") },
            ]}
          />
        )}
      </FormField>
      {classroom && day ? (
        <Link href={`/v2/attendance/call/daily/${classroom.value}?date=${day}${partQuery(part === "" ? undefined : part)}`} className={buttonClass.primary}>
          {t("open")}
        </Link>
      ) : (
        <span aria-disabled="true" className={`${buttonClass.primary} pointer-events-none opacity-50`}>
          {t("open")}
        </span>
      )}
    </div>
  );
}

/** Appels saisis sur cet appareil (identifiants seulement) : état d'envoi, reprise, abandon. */
function OutboxList({ basePath }: { basePath: string }) {
  const t = useTranslations("v2Attendance.callList.outbox");
  const dateFmt = useDateFormat();
  const manager = useOutboxManager();
  const status = useOutboxStatus();
  if (status.calls.length === 0) return null;
  return (
    <section aria-labelledby="outbox-title" className="space-y-3">
      <h2 id="outbox-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <ul className="space-y-2">
        {status.calls.map((c) => {
          const count = Object.keys(c.records).length;
          const href = c.target.kind === "occurrence" ? `${basePath}/occurrence/${c.target.occurrenceId}` : `${basePath}/daily/${c.target.classroomId}?date=${c.target.date}${partQuery(c.target.dayPart)}`;
          return (
            <li key={c.key} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-card/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="font-medium">{c.label ?? t("untitled", { date: dateFmt.civil(c.date) })}</p>
                <p className="text-muted-foreground">
                  {t(`state.${c.state}`)}
                  {count > 0 ? ` · ${t("records", { count })}` : ""}
                  {c.conflicts.length > 0 ? ` · ${t("conflicts", { count: c.conflicts.length })}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={href} className={buttonClass.secondary}>
                  {t("open")}
                </Link>
                {count > 0 || c.submit ? (
                  <button type="button" className={buttonClass.ghost} onClick={() => void manager.discard(c.target)}>
                    {t("discard")}
                  </button>
                ) : (
                  <button type="button" className={buttonClass.ghost} onClick={() => void manager.dismiss(c.target)}>
                    {t("remove")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
