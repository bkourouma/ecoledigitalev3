"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserCheck, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/platform/api/errors";
import { useAttendanceSession, useMarkRecords, useOpenAttendanceSession, useSubmitAttendanceSession } from "@/platform/v2/attendance";
import { todayCivil } from "@/platform/v2/dates";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import type { HalfDay } from "@/platform/offline/attendance-outbox";
import { buildRows, DEFAULT_STATUS, pendingEntries, sessionOpenBody, type CallRow, type DraftMark } from "../../attendance/_components/call-utils";
import { PrimaryError } from "./shared";

const ABSENT = "ABSENT";
const HALF_DAYS: readonly HalfDay[] = ["MORNING", "AFTERNOON"];

/**
 * Appel journalier rapide d'une classe (séance `DAILY` de la date du jour), en deux gestes : tous présents par défaut, un geste
 * pour marquer un absent, un geste pour transmettre. Réutilise les hooks du module `attendance` et ses utilitaires purs : la
 * décision (statut par défaut, fenêtre de correction, validation) reste à l'API. Pas de file hors ligne ici (voir `/v2/attendance/call`).
 */
export function DailyCall({ classroomId, date, onClose }: { classroomId: string; date?: string; onClose?: () => void }) {
  const t = useTranslations("v2PrimaryClass.daily");
  const tPart = useTranslations("v2AttendanceHalfDays");
  const today = useMemo(() => date ?? todayCivil(), [date]);
  const open = useOpenAttendanceSession();
  // Lu dans l'état de la mutation : un rappel `onSuccess` passé à `mutate` est perdu au double montage de React en développement.
  const sessionId: string | null = open.data?.session.id ?? null;
  const started = useRef(false);
  const openMutate = open.mutate;
  // Classe à appel en deux demi-journées (matin + après-midi) : l'API répond `day_part_required`, la demi-journée est alors demandée.
  const [dayPart, setDayPart] = useState<HalfDay | undefined>(undefined);
  const start = useCallback(
    (part?: HalfDay) => {
      openMutate(sessionOpenBody({ kind: "daily", classroomId, date: today, ...(part ? { dayPart: part } : {}) }));
    },
    [openMutate, classroomId, today],
  );
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  const detail = useAttendanceSession(sessionId);
  const mark = useMarkRecords();
  const submit = useSubmitAttendanceSession();
  const [drafts, setDrafts] = useState<Record<string, DraftMark>>({});
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo<CallRow[]>(() => (detail.data ? buildRows(detail.data, drafts) : []), [detail.data, drafts]);
  const session = detail.data?.session ?? null;
  const editable = detail.data?.editable ?? false;
  const isOpenSession = session?.status === "OPEN";
  const absent = rows.filter((r) => r.shown === ABSENT).length;
  const present = rows.filter((r) => r.shown === DEFAULT_STATUS).length;
  const pending = pendingEntries(rows).length;

  function toggle(row: CallRow) {
    setFeedback(null);
    setDrafts((d) => ({ ...d, [row.studentId]: { statusCode: row.shown === DEFAULT_STATUS ? ABSENT : DEFAULT_STATUS } }));
  }

  async function send() {
    if (!session) return;
    setBusy(true);
    setFeedback(null);
    try {
      const entries = pendingEntries(rows);
      if (entries.length > 0) await mark.mutateAsync({ sessionId: session.id, entries });
      if (isOpenSession) {
        const r = await submit.mutateAsync({ sessionId: session.id, allPresent: true });
        setFeedback({ kind: "success", text: t("submitted", { absent: r.absentCount }) });
      } else {
        setFeedback({ kind: "success", text: t("corrected") });
      }
      setDrafts({});
      await detail.refetch();
    } catch (e) {
      // Rien ne s'efface : les saisies restent affichées et peuvent être renvoyées.
      setFeedback({ kind: "error", text: e instanceof ApiError ? e.message : t("failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t("label")} className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{dayPart ? `${t("title", { date: today })} · ${tPart(`parts.${dayPart}`)}` : t("title", { date: today })}</h3>
        {onClose ? (
          <button type="button" className={buttonClass.ghost} onClick={onClose}>
            {t("close")}
          </button>
        ) : null}
      </div>
      {open.isError && open.error instanceof ApiError && open.error.code === "attendance.day_part_required" ? (
        <div className="space-y-2" role="group" aria-label={t("choosePart")}>
          <p className="text-sm font-medium">{t("choosePart")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {HALF_DAYS.map((part) => (
              <button
                key={part}
                type="button"
                className={buttonClass.primary}
                onClick={() => {
                  setDayPart(part);
                  open.reset();
                  start(part);
                }}
              >
                {tPart(`doCall.${part}`)}
              </button>
            ))}
          </div>
        </div>
      ) : open.isError ? (
        <div className="space-y-2">
          <PrimaryError error={open.error} />
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={() => {
              open.reset();
              start(dayPart);
            }}
          >
            {t("retry")}
          </button>
        </div>
      ) : !sessionId || detail.isPending ? (
        <LoadingBlock label={t("loading")} />
      ) : detail.isError ? (
        <PrimaryError error={detail.error} />
      ) : (
        <>
          {!editable ? <Notice kind="warning">{t("notEditable")}</Notice> : null}
          {feedback ? <Notice kind={feedback.kind}>{feedback.text}</Notice> : null}
          <p role="status" aria-live="polite" className="text-sm font-medium" data-testid="daily-counts">
            {t("counts", { present, absent })}
          </p>
          <p className="text-xs text-muted-foreground">{isOpenSession ? t("hint") : t("alreadySubmitted")}</p>
          {rows.length === 0 ? (
            <Notice kind="info">{t("empty")}</Notice>
          ) : (
            <ul aria-label={t("list")} className="divide-y rounded-md border bg-background">
              {rows.map((row) => {
                const name = row.displayName ?? t("studentFallback", { id: row.studentId.slice(-4) });
                const isAbsent = row.shown === ABSENT;
                return (
                  <li key={row.studentId}>
                    <button
                      type="button"
                      disabled={!editable}
                      aria-pressed={isAbsent}
                      aria-label={isAbsent ? t("markPresent", { name }) : t("markAbsent", { name })}
                      onClick={() => toggle(row)}
                      className="flex min-h-[3.25rem] w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {row.pending ? <span className="text-xs text-amber-300">{t("pending")}</span> : null}
                        <StatusBadge label={isAbsent ? t("absent") : row.shown === DEFAULT_STATUS ? t("present") : row.shown} tone={isAbsent ? "danger" : "success"} />
                        {isAbsent ? <UserX className="h-4 w-4" aria-hidden="true" /> : <UserCheck className="h-4 w-4" aria-hidden="true" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className={buttonClass.primary} disabled={busy || !editable || (!isOpenSession && pending === 0)} onClick={() => void send()}>
              {busy ? t("sending") : isOpenSession ? t("submit") : t("saveCorrections")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
