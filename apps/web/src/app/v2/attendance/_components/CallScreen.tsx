"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useFeature, usePermission } from "@/platform/access";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { callKey } from "@/platform/offline/attendance-outbox";
import { useOutboxManager, useOutboxStatus } from "@/platform/offline/OutboxProvider";
import { useJustificationReasons, useMarkRecords, useMarkWithJustification, useOpenAttendanceSession, useAttendanceSession, useStatusDefinitions, useSubmitAttendanceSession } from "@/platform/v2/attendance";
import { useClassroomDirectory } from "@/platform/v2/directory";
import { omit } from "@/platform/v2/omit";
import { useDateFormat } from "@/platform/ui/format";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { OfflineIndicator } from "./OfflineIndicator";
import { buildRows, countByStatus, DEFAULT_STATUS, pendingEntries, sessionOpenBody, statusTone, SYSTEM_STUDENT_STATUSES, targetOf, type CallRow, type DraftMark } from "./call-utils";
import { CallOutcomeBanner } from "./CallOutcomeBanner";
import { StatusPicker, type StatusOption } from "./StatusPicker";

/**
 * L'appel en deux gestes : la liste s'ouvre avec tout le monde présent ; on touche les exceptions ; on soumet.
 *
 * Hors ligne : la liste nominative reste EN MÉMOIRE de la page (jamais écrite sur l'appareil) ; les pointages sont
 * écrits dans la file locale (identifiants seulement) et envoyés par lot, avec clés d'idempotence, dès que le
 * réseau revient. L'écran doit avoir été ouvert en ligne (une navigation hors ligne ne peut pas charger la liste).
 */
export function CallScreen({ kind, id, date }: { kind: "occurrence" | "daily"; id: string; date: string }) {
  const t = useTranslations("v2Attendance.call");
  const tStatus = useTranslations("v2Attendance.status");
  const dateFmt = useDateFormat();
  const target = useMemo(() => targetOf(kind, id, date), [kind, id, date]);
  const key = callKey(target);

  const offlineFeature = useFeature("attendance.offline");
  const canJustify = usePermission("attendance.justification.decide").allowed;
  const manager = useOutboxManager();
  const outbox = useOutboxStatus();
  const classrooms = useClassroomDirectory();

  const open = useOpenAttendanceSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const started = useRef(false);
  const openMutate = open.mutate;
  const startOpen = useCallback(() => {
    openMutate(sessionOpenBody(target), { onSuccess: (r) => setSessionId(r.session.id) });
  }, [openMutate, target]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startOpen();
  }, [startOpen]);

  const detail = useAttendanceSession(sessionId);
  const definitions = useStatusDefinitions();
  const reasons = useJustificationReasons(canJustify);
  const markRecords = useMarkRecords();
  const submitSession = useSubmitAttendanceSession();
  const markJustified = useMarkWithJustification();

  const [drafts, setDrafts] = useState<Record<string, DraftMark>>({});
  const [hydrated, setHydrated] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [justify, setJustify] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const queueMode = offlineFeature.allowed;
  const modeReady = !offlineFeature.isLoading;
  const myCall = outbox.calls.find((c) => c.key === key) ?? null;

  // Reprise d'un appel en cours sur cet appareil (pointages encore dans la file locale).
  useEffect(() => {
    if (hydrated || !modeReady || !outbox.ready) return;
    if (myCall) {
      setDrafts(Object.fromEntries(Object.values(myCall.records).map((r) => [r.studentId, { statusCode: r.statusCode, ...(r.minutesLate ? { minutesLate: r.minutesLate } : {}) }])));
    }
    setHydrated(true);
  }, [hydrated, modeReady, outbox.ready, myCall]);

  // Après un envoi réussi, on relit l'état serveur (les saisies confirmées deviennent « enregistrées »).
  const refetchDetail = detail.refetch;
  const lastSync = outbox.lastSyncAt;
  useEffect(() => {
    if (lastSync && sessionId) void refetchDetail();
  }, [lastSync, sessionId, refetchDetail]);

  const session = detail.data?.session ?? null;
  const rows = useMemo<CallRow[]>(() => {
    if (!detail.data) return [];
    const queued = new Set(myCall ? Object.keys(myCall.records) : []);
    return buildRows(detail.data, drafts).map((r) => (queueMode ? { ...r, pending: queued.has(r.studentId) } : r));
  }, [detail.data, drafts, myCall, queueMode]);
  const counts = useMemo(() => countByStatus(rows), [rows]);

  const label = useMemo(() => (session ? `${classrooms.name(session.classroomId)} · ${dateFmt.civil(session.sessionDate)}` : null), [session, classrooms, dateFmt]);
  const editable = detail.data?.editable ?? false;
  const isOpenSession = session?.status === "OPEN";

  const options: StatusOption[] = useMemo(() => {
    const defs = (definitions.data ?? []).filter((d) => d.subjectKind === "STUDENT" && d.active && !d.isJustified).sort((a, b) => a.sortOrder - b.sortOrder);
    if (defs.length > 0) return defs.map((d) => ({ code: d.code, label: d.label }));
    return SYSTEM_STUDENT_STATUSES.filter((c) => c !== "EXCUSED").map((c) => ({ code: c, label: tStatus(c) }));
  }, [definitions.data, tStatus]);

  const statusLabel = useCallback(
    (code: string): string => {
      const def = (definitions.data ?? []).find((d) => d.subjectKind === "STUDENT" && d.code === code);
      if (def) return def.label;
      return (SYSTEM_STUDENT_STATUSES as readonly string[]).includes(code) ? tStatus(code) : code;
    },
    [definitions.data, tStatus],
  );

  const setMark = useCallback(
    (studentId: string, statusCode: string, minutesLate?: number) => {
      setFeedback(null);
      setDrafts((d) => ({ ...d, [studentId]: { statusCode, ...(minutesLate ? { minutesLate } : {}) } }));
      if (queueMode) {
        manager
          .mark({ target, label, date: session?.sessionDate ?? date, studentId, statusCode, minutesLate })
          .catch(() => setFeedback({ kind: "error", text: t("localSaveFailed") }));
      }
    },
    [queueMode, manager, target, label, session, date, t],
  );

  function toggle(row: CallRow) {
    setMark(row.studentId, row.shown === DEFAULT_STATUS ? "ABSENT" : DEFAULT_STATUS);
  }

  async function submit() {
    if (!session) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (queueMode) {
        if (isOpenSession) {
          const summary = await manager.submit({ target, label, date: session.sessionDate, defaultStatus: DEFAULT_STATUS });
          if (summary === null) setFeedback({ kind: "info", text: t("queuedOffline") });
          else if (summary.failure) setFeedback({ kind: "info", text: t("queuedFailure") });
          else setFeedback({ kind: "success", text: t("submitted") });
        } else {
          const summary = await manager.syncNow();
          setFeedback(summary.failure ? { kind: "info", text: t("queuedFailure") } : { kind: "success", text: t("corrected") });
        }
      } else {
        const entries = pendingEntries(rows);
        if (entries.length > 0) await markRecords.mutateAsync({ sessionId: session.id, entries });
        if (isOpenSession) {
          const r = await submitSession.mutateAsync({ sessionId: session.id, allPresent: true });
          setFeedback({ kind: "success", text: t("submittedCounts", { absent: r.absentCount, late: r.lateCount }) });
        } else {
          setFeedback({ kind: "success", text: t("corrected") });
        }
        setDrafts({});
        await detail.refetch();
      }
    } catch (e) {
      setFeedback({ kind: "error", text: e instanceof ApiError ? e.message : t("submitFailed") });
    } finally {
      setBusy(false);
    }
  }

  // ----- États d'ouverture -----------------------------------------------------------------------------------------

  const header = (
    <PageHeader
      title={t("title")}
      description={label ?? (kind === "daily" ? t("dailyDescription") : t("sessionDescription"))}
      actions={
        <Link href="/v2/attendance/call" className={buttonClass.secondary}>
          {t("back")}
        </Link>
      }
    />
  );

  // Hors ligne à l'ouverture : la requête d'ouverture est suspendue (reprise automatique au retour du réseau) ou a échoué.
  const networkError = open.error instanceof ApiError && (open.error.code === ClientErrorCode.NETWORK || open.error.code === ClientErrorCode.TIMEOUT);
  if (!sessionId && (open.isError || open.isPaused || !outbox.online)) {
    const offline = !open.isError || networkError;
    return (
      <div className="space-y-4">
        {header}
        <OfflineIndicator />
        {offline ? <Notice kind="warning">{t("noRosterOffline")}</Notice> : <ErrorBlock error={open.error} />}
        {open.isError ? (
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={() => {
              open.reset();
              startOpen();
            }}
          >
            {t("retry")}
          </button>
        ) : null}
        <CallOutcomeBanner target={target} names={new Map()} />
      </div>
    );
  }
  if (!sessionId || detail.isPending || !modeReady || !hydrated) {
    return (
      <div className="space-y-4">
        {header}
        <OfflineIndicator />
        {detail.isError ? <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} /> : <LoadingBlock label={t("loading")} />}
      </div>
    );
  }
  if (detail.isError || !detail.data || !session) {
    return (
      <div className="space-y-4">
        {header}
        <OfflineIndicator />
        <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const names = new Map(rows.map((r) => [r.studentId, r.displayName ?? t("studentFallback", { id: r.studentId.slice(-4) })]));
  const pendingCount = rows.filter((r) => r.pending).length;
  const nameOf = (r: CallRow) => names.get(r.studentId) ?? "";
  const pickerRow = rows.find((r) => r.studentId === picker) ?? null;
  const submitDisabled = busy || !editable || (!isOpenSession && pendingCount === 0);

  return (
    <div className="space-y-4 pb-28">
      {header}
      <OfflineIndicator />
      <CallOutcomeBanner target={target} names={names} />
      {feedback ? <Notice kind={feedback.kind === "error" ? "error" : feedback.kind === "success" ? "success" : "info"}>{feedback.text}</Notice> : null}
      {!editable ? <Notice kind="warning">{session.status === "VALIDATED" ? t("lockedValidated") : session.status === "CANCELLED" ? t("lockedCancelled") : t("lockedWindow")}</Notice> : null}

      <section aria-label={t("summary")} className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge label={t(`session.${session.status}`)} tone={session.status === "OPEN" ? "info" : session.status === "CANCELLED" ? "neutral" : "success"} />
        {Object.entries(counts)
          .sort(([a], [b]) => (a === DEFAULT_STATUS ? -1 : b === DEFAULT_STATUS ? 1 : a.localeCompare(b)))
          .map(([code, n]) => (
            <span key={code} className="rounded-full border px-2.5 py-0.5">
              {statusLabel(code)} : <strong>{n}</strong>
            </span>
          ))}
        {isOpenSession ? <span className="text-muted-foreground">{t("defaultHint")}</span> : null}
      </section>

      {rows.length === 0 ? (
        <Notice kind="info">{t("emptyRoster")}</Notice>
      ) : (
        <ul aria-label={t("listLabel")} className="divide-y rounded-md border">
          {rows.map((row) => {
            const name = nameOf(row);
            return (
              <li key={row.studentId} className="flex items-stretch">
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => toggle(row)}
                  aria-label={t("rowToggle", { name, status: statusLabel(row.shown) })}
                  className="flex min-h-[3.25rem] min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    {!row.inRoster ? <span className="block text-xs text-muted-foreground">{t("outOfRoster")}</span> : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn(row.isDefault && "opacity-70")}>
                      <StatusBadge label={statusLabel(row.shown) + (row.shown === "LATE" && (row.draft?.minutesLate ?? row.serverMinutesLate) ? ` ${row.draft?.minutesLate ?? row.serverMinutesLate} min` : "")} tone={statusTone(row.shown)} />
                    </span>
                    {row.serverExcused ? <span className="text-xs text-blue-800">{t("excused")}</span> : null}
                    {row.pending ? <span className="text-xs text-amber-800">{t("pendingRow")}</span> : null}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => setPicker(row.studentId)}
                  aria-label={t("rowOther", { name })}
                  className="inline-flex w-12 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground" aria-live="polite">
            {pendingCount > 0 ? t("pendingSummary", { count: pendingCount }) : isOpenSession ? t("nothingChanged") : t("alreadySubmitted")}
          </p>
          <button type="button" disabled={submitDisabled} onClick={() => void submit()} className={cn(buttonClass.primary, "min-w-[10rem]")}>
            {busy ? t("saving") : isOpenSession ? t("submit") : t("saveCorrections")}
          </button>
        </div>
      </div>

      {pickerRow ? (
        <StatusPicker
          open
          onOpenChange={(o) => !o && setPicker(null)}
          studentName={nameOf(pickerRow)}
          options={options}
          current={pickerRow.shown === "EXCUSED" ? DEFAULT_STATUS : pickerRow.shown}
          currentMinutes={pickerRow.draft?.minutesLate ?? pickerRow.serverMinutesLate}
          canJustify={canJustify && outbox.online}
          onPick={(code, minutes) => setMark(pickerRow.studentId, code, minutes)}
          onJustify={() => setJustify(pickerRow.studentId)}
        />
      ) : null}

      {justify ? (
        <JustifyDialog
          studentName={names.get(justify) ?? ""}
          reasons={(reasons.data ?? []).filter((r) => r.active)}
          isPending={markJustified.isPending}
          error={markJustified.error}
          onClose={() => {
            setJustify(null);
            markJustified.reset();
          }}
          onSubmit={(reasonCode, comment) =>
            markJustified.mutate(
              { sessionId: session.id, studentId: justify, reasonCode, ...(comment ? { comment } : {}) },
              {
                onSuccess: () => {
                  setJustify(null);
                  setDrafts((d) => omit(d, justify));
                  setFeedback({ kind: "success", text: t("justifiedDone") });
                  void detail.refetch();
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

function JustifyDialog({
  studentName,
  reasons,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  studentName: string;
  reasons: ReadonlyArray<{ code: string; label: string }>;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (reasonCode: string, comment: string) => void;
}) {
  const t = useTranslations("v2Attendance.call.justify");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { name: studentName })}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={isPending}
      error={error}
      onSubmit={() => {
        setTouched(true);
        if (reason) onSubmit(reason, comment.trim());
      }}
    >
      <FormField label={t("reason")} required error={touched && !reason ? t("reasonRequired") : null}>
        {(c) => <NativeSelect {...c} value={reason} onChange={setReason} placeholder={t("choose")} options={reasons.map((r) => ({ value: r.code, label: r.label }))} />}
      </FormField>
      <FormField label={t("comment")}>{(c) => <TextAreaControl {...c} value={comment} onChange={setComment} maxLength={1000} />}</FormField>
    </FormDialog>
  );
}
