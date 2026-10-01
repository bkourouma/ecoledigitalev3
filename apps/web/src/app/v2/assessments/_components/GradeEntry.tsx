"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { assessRevisionRequestBodySchema } from "@ecoledigitale/contracts/v2/assess";
import { ApiError } from "@/platform/api/errors";
import { usePermission } from "@/platform/access";
import { useAssessmentTypes, useAssessSettings, useGradeHistory, useGradeSheet, usePeriodLock, useRequestAddition, useRequestRevision, useSaveGrades, type GradeSheet } from "@/platform/v2/assess";
import { useNodeLabels } from "./shared";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { ErrorBlock, LoadingBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useClassroom } from "@/platform/v2/academic";
import { applyPaste, buildBatch, isDirty, issueOf, mergeSaved, nextIndex, parseCell, progressOf, rowFromGrade, rowFromPending, STATUS_CODE, type CellContext, type EntryStatus, type GridRow } from "./grid-model";
import { toneOfStatus, useStudentLabel, useStudentNames } from "./shared";
import { WorkflowBar } from "./WorkflowBar";

type SaveState = "idle" | "saving" | "saved" | "retry" | "conflict" | "rejected";

const STATUS_OPTIONS: EntryStatus[] = ["ENTERED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED", "EXEMPT", "NOT_GRADED"];

function newKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `lot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Statut de la liste déroulante d'une ligne, dérivé du texte de la cellule. */
function statusOfText(text: string, hasBase: boolean, ctx: CellContext): EntryStatus | "" {
  const p = parseCell(text, ctx);
  if (p.kind === "score" || p.kind === "invalid") return "ENTERED";
  if (p.kind === "status") return p.status;
  return hasBase ? "NOT_GRADED" : "";
}

export function GradeEntryScreen({ assessmentId }: { assessmentId: string }) {
  const t = useTranslations("v2Assess.grid");
  const tCommon = useTranslations("v2Assess.common");
  const sheet = useGradeSheet(assessmentId);
  return (
    <div>
      <QueryBoundary query={sheet}>
        {sheet.data ? <GradeSheetView key={assessmentId} sheet={sheet.data} onReload={() => sheet.refetch()} isReloading={sheet.isFetching} /> : <LoadingBlock label={tCommon("loading")} />}
      </QueryBoundary>
      <p className="mt-6 text-sm">
        <Link href={`/v2/assessments/${assessmentId}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {t("backToAssessment")}
        </Link>
      </p>
    </div>
  );
}

function GradeSheetView({ sheet, onReload, isReloading }: { sheet: GradeSheet; onReload: () => unknown; isReloading: boolean }) {
  const t = useTranslations("v2Assess.grid");
  const tStatus = useTranslations("v2Assess.status");
  const tEntry = useTranslations("v2Assess.entryStatus");
  const date = useDateFormat();
  const assessment = sheet.assessment;
  const settings = useAssessSettings();
  const types = useAssessmentTypes();
  const classroom = useClassroom(assessment.classroomId);
  const nodeLabels = useNodeLabels(assessment.classroomId);
  const lock = usePeriodLock(assessment.classroomId, assessment.academicPeriodId);
  const { names, truncated } = useStudentNames(assessment.classroomId);
  const studentLabel = useStudentLabel(names);
  const canEnter = usePermission("grade.enter");
  const canRevise = usePermission("grade.revise.request");
  const canHistory = usePermission("grade.revise.approve");
  const canHistory2 = usePermission("grade.validate");
  const flash = useFlash();

  const ctx: CellContext = useMemo(() => ({ scaleMax: assessment.scaleMax, maxDecimals: settings.data?.maxScoreDecimals ?? 3 }), [assessment.scaleMax, settings.data?.maxScoreDecimals]);

  const [rows, setRows] = useState<GridRow[]>(() => [...sheet.grades.map(rowFromGrade), ...sheet.pending.map(rowFromPending)]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<unknown>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastResult, setLastResult] = useState<{ created: number; updated: number; unchanged: number; replayed: boolean } | null>(null);
  const [autoSave, setAutoSave] = useState(true);
  const [online, setOnline] = useState(true);
  const [pasteInfo, setPasteInfo] = useState<{ applied: number; skipped: number; mode: "keyed" | "positional" } | null>(null);
  const [reviseRow, setReviseRow] = useState<GridRow | null>(null);
  const [historyRow, setHistoryRow] = useState<GridRow | null>(null);
  const save = useSaveGrades();
  const pendingRef = useRef<{ key: string; entries: ReturnType<typeof buildBatch>["entries"]; sentTexts: Map<string, string> } | null>(null);
  const savingRef = useRef(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const editable = canEnter.allowed && assessment.status === "DRAFT";
  const published = assessment.status === "PUBLISHED";

  // Ordre d'affichage : alphabétique par nom (les index des lignes ne changent jamais en cours de saisie).
  const order = useMemo(() => {
    const label = (r: GridRow) => names.get(r.studentId)?.name ?? `~${r.studentId}`;
    return rows.map((_, i) => i).sort((a, b) => label(rows[a]!).localeCompare(label(rows[b]!), "fr", { sensitivity: "base" }));
  }, [rows, names]);

  const progress = useMemo(() => progressOf(rows, ctx), [rows, ctx]);
  const dirtyCount = progress.dirty;

  // ----- enregistrement ---------------------------------------------------------------------------------------
  const doSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    const current = rowsRef.current;
    let batch = pendingRef.current;
    if (!batch) {
      const built = buildBatch(current, ctx);
      if (built.invalid.length > 0) {
        setSaveState("rejected");
        setSaveError(null);
        const first = built.invalid[0]!;
        inputs.current.get(first)?.focus();
        return false;
      }
      if (built.entries.length === 0) {
        setSaveState((s) => (s === "saving" ? "idle" : s));
        return true;
      }
      batch = { key: newKey(), entries: built.entries, sentTexts: new Map(current.map((r) => [r.enrollmentId, r.text])) };
      pendingRef.current = batch;
    }
    savingRef.current = true;
    setSaveState("saving");
    setSaveError(null);
    try {
      const result = await save.mutateAsync({ assessmentId: assessment.id, entries: batch.entries, idempotencyKey: batch.key });
      setRows((prev) => mergeSaved(prev, result.grades, batch!.sentTexts));
      pendingRef.current = null;
      setLastSavedAt(new Date());
      setLastResult({ created: result.created, updated: result.updated, unchanged: result.unchanged, replayed: result.replayed });
      setSaveState("saved");
      return true;
    } catch (e) {
      setSaveError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        // Refus définitif du lot (tout ou rien) : il ne sera pas rejoué tel quel ; les erreurs de ligne sont affichées.
        const sent = batch.entries;
        pendingRef.current = null;
        const issues = apiErrorToFieldErrors(e);
        setRows((prev) =>
          prev.map((r) => {
            const idx = sent.findIndex((x) => x.enrollmentId === r.enrollmentId);
            if (idx < 0) return r;
            const hit = Object.entries(issues).find(([k]) => k.startsWith(`entries.${idx}.`) || k === `entries.${idx}`);
            return hit ? { ...r, apiError: hit[1] } : r;
          }),
        );
        setSaveState(e.status === 409 ? "conflict" : "rejected");
      } else {
        // Réseau, délai, erreur serveur : on garde le MÊME lot (même clé) pour le rejouer sans doublon.
        setSaveState("retry");
      }
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [assessment.id, ctx, save]);

  // Enregistrement automatique après une pause de saisie (sauf lignes invalides ou hors ligne).
  useEffect(() => {
    if (!editable || !autoSave || !online) return;
    if (dirtyCount === 0 && !pendingRef.current) return;
    if (progress.invalid > 0 || savingRef.current) return;
    const handle = setTimeout(() => void doSave(), 6000);
    return () => clearTimeout(handle);
  }, [rows, editable, autoSave, online, dirtyCount, progress.invalid, doSave]);

  // Réseau : suivi de l'état en ligne ; reprise de l'envoi au retour de la connexion.
  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const on = () => {
      setOnline(true);
      if (editable && (pendingRef.current || rowsRef.current.length)) void doSave();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [editable, doSave]);

  // Avertit avant de quitter avec des saisies non enregistrées.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  // ----- édition ----------------------------------------------------------------------------------------------
  function setText(enrollmentId: string, text: string) {
    setRows((prev) => prev.map((r) => (r.enrollmentId === enrollmentId ? { ...r, text, apiError: null } : r)));
    setPasteInfo(null);
    if (saveState === "saved") setSaveState("idle");
  }

  function setComment(enrollmentId: string, comment: string) {
    setRows((prev) => prev.map((r) => (r.enrollmentId === enrollmentId ? { ...r, comment } : r)));
  }

  function focusAt(displayIndex: number) {
    const target = rows[order[displayIndex]!];
    if (target) inputs.current.get(target.enrollmentId)?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, displayIndex: number) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void doSave();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      focusAt(nextIndex(displayIndex, 1, order.length));
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      focusAt(nextIndex(displayIndex, -1, order.length));
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, displayIndex: number) {
    const data = e.clipboardData.getData("text");
    // Une seule cellule : comportement natif. Plusieurs cellules (tableur) : remplissage de la grille.
    if (!/[\t\n\r]/.test(data.replace(/[\r\n]+$/, ""))) return;
    e.preventDefault();
    const ordered = order.map((i) => rows[i]!);
    const out = applyPaste(ordered, displayIndex, data, (r) => names.get(r.studentId)?.number ?? null);
    const byId = new Map(out.rows.map((r) => [r.enrollmentId, r]));
    setRows((prev) => prev.map((r) => byId.get(r.enrollmentId) ?? r));
    setPasteInfo({ applied: out.applied, skipped: out.skipped, mode: out.mode });
  }

  function onStatusChange(row: GridRow, status: EntryStatus | "") {
    if (status === "ENTERED" || status === "") {
      setText(row.enrollmentId, "");
      inputs.current.get(row.enrollmentId)?.focus();
    } else {
      setText(row.enrollmentId, STATUS_CODE[status]);
    }
  }

  function reload() {
    if (dirtyCount > 0 && !window.confirm(t("confirmReload"))) return;
    pendingRef.current = null;
    void Promise.resolve(onReload()).then((res) => {
      const data = (res as { data?: GradeSheet } | undefined)?.data;
      if (data) {
        setRows([...data.grades.map(rowFromGrade), ...data.pending.map(rowFromPending)]);
        setSaveState("idle");
        setSaveError(null);
      }
    });
  }

  const typeLabel = types.data?.find((x) => x.id === assessment.typeId)?.label ?? assessment.typeCode ?? "";
  const lockedSession = lock.data && !lock.data.releasedAt && lock.data.lockedSessions.includes(assessment.sessionNo);

  return (
    <div>
      <PageHeader
        title={assessment.title}
        description={[classroom.data?.name, nodeLabels.get(assessment.curriculumNodeId), typeLabel].filter(Boolean).join(" · ")}
        actions={
          <>
            <StatusBadge label={tStatus(assessment.status)} tone={toneOfStatus(assessment.status)} />
            <StatusBadge label={t("scale", { max: assessment.scaleMax.replace(".", ",") })} tone="neutral" />
            {assessment.sessionNo === 2 ? <StatusBadge label={t("session2")} tone="info" /> : null}
          </>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">{t("assessedOn", { date: date.civil(assessment.assessedOn) })}</p>

      <div className="space-y-4">
        {flash.node}
        {assessment.returnComment && assessment.status === "DRAFT" ? <Notice kind="warning">{t("returned", { comment: assessment.returnComment })}</Notice> : null}
        {lockedSession ? <Notice kind="warning">{t("periodLocked")}</Notice> : null}
        {!editable && assessment.status === "DRAFT" && !canEnter.isLoading ? <Notice kind="info">{t("readOnlyNoRight")}</Notice> : null}
        {!editable && assessment.status !== "DRAFT" && assessment.status !== "CANCELLED" ? <Notice kind="info">{published ? t("readOnlyPublished") : t("readOnlyWorkflow")}</Notice> : null}
        {assessment.status === "CANCELLED" ? <Notice kind="warning">{t("cancelled", { reason: assessment.cancelReason ?? "" })}</Notice> : null}
        {truncated ? <Notice kind="info">{t("namesTruncated")}</Notice> : null}
        {!online && editable ? <Notice kind="warning">{t("offline")}</Notice> : null}

        <WorkflowBar assessment={assessment} unsaved={dirtyCount > 0 || pendingRef.current !== null} onSaveRequest={() => doSave()} onMessage={flash.show} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="status" aria-live="polite" className="text-sm" data-testid="save-indicator">
            <SaveIndicator state={saveState} dirty={dirtyCount} invalid={progress.invalid} at={lastSavedAt} result={lastResult} />
          </div>
          {editable ? (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} className="h-4 w-4 accent-primary" />
                {t("autoSave")}
              </label>
              <button type="button" className={buttonClass.secondary} onClick={reload} disabled={isReloading}>
                {t("reload")}
              </button>
              <button type="button" className={buttonClass.primary} onClick={() => void doSave()} disabled={save.isPending || (dirtyCount === 0 && !pendingRef.current)}>
                {saveState === "retry" ? t("retrySave") : t("save")}
              </button>
            </div>
          ) : null}
        </div>

        {saveState === "conflict" ? (
          <Notice kind="error">
            <p>{t("conflict")}</p>
            <button type="button" className={`${buttonClass.secondary} mt-2`} onClick={reload}>
              {t("reload")}
            </button>
          </Notice>
        ) : null}
        {saveError && saveState !== "conflict" ? <ErrorBlock error={saveError} /> : null}
        {pasteInfo ? <Notice kind={pasteInfo.skipped > 0 ? "warning" : "info"}>{t(pasteInfo.mode === "keyed" ? "pasteKeyed" : "pastePositional", { applied: pasteInfo.applied, skipped: pasteInfo.skipped })}</Notice> : null}

        {editable ? (
          <details className="rounded-md border bg-muted/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium">{t("helpTitle")}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{t("helpKeys")}</li>
              <li>{t("helpCodes")}</li>
              <li>{t("helpPaste")}</li>
              <li>{t("helpZero")}</li>
            </ul>
          </details>
        ) : null}

        <p className="text-sm text-muted-foreground" data-testid="progress">
          {t("progress", { entered: progress.entered, total: progress.total })}
          {progress.unexcused + progress.excused + progress.exempt > 0 ? ` · ${t("progressStates", { absent: progress.unexcused + progress.excused, exempt: progress.exempt })}` : ""}
        </p>

        {rows.length === 0 ? (
          <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div role="region" aria-label={t("tableCaption")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t("tableCaption")}</caption>
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {t("columns.student")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("columns.score", { max: assessment.scaleMax.replace(".", ",") })}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t("columns.state")}
                  </th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">
                    {t("columns.comment")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">{t("columns.row")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.map((rowIndex, displayIndex) => {
                  const row = rows[rowIndex]!;
                  const name = studentLabel(row.studentId);
                  const number = names.get(row.studentId)?.number;
                  const issue = issueOf(row, ctx);
                  const dirty = isDirty(row, ctx);
                  const errId = `err-${row.enrollmentId}`;
                  const message = row.apiError ?? (issue ? t(`issue.${issue}`, { max: assessment.scaleMax.replace(".", ","), decimals: ctx.maxDecimals }) : null);
                  const current = statusOfText(row.text, row.base !== null, ctx);
                  return (
                    <tr key={row.enrollmentId} className="border-t align-top">
                      <th scope="row" className="min-w-[8rem] px-3 py-2 text-left font-medium">
                        <span className="block">{name}</span>
                        {number ? <span className="block text-xs font-normal text-muted-foreground">{number}</span> : null}
                      </th>
                      <td className="px-3 py-2">
                        <input
                          ref={(el) => {
                            if (el) inputs.current.set(row.enrollmentId, el);
                            else inputs.current.delete(row.enrollmentId);
                          }}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={row.text}
                          readOnly={!editable}
                          aria-label={t("scoreOf", { name })}
                          aria-invalid={message ? true : undefined}
                          aria-describedby={message ? errId : undefined}
                          onChange={(e) => setText(row.enrollmentId, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, displayIndex)}
                          onPaste={(e) => onPaste(e, displayIndex)}
                          onFocus={(e) => e.currentTarget.select()}
                          className="h-11 w-24 rounded-md border border-input bg-background px-2 text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive read-only:bg-muted/40 sm:h-10"
                        />
                        {message ? (
                          <p id={errId} role="alert" className="mt-1 max-w-[12rem] text-xs font-medium text-destructive">
                            {message}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <NativeSelect
                          aria-label={t("stateOf", { name })}
                          value={current}
                          disabled={!editable}
                          onChange={(v) => onStatusChange(row, v as EntryStatus | "")}
                          placeholder={current === "" ? t("noEntry") : undefined}
                          options={STATUS_OPTIONS.map((s) => ({ value: s, label: tEntry(s) }))}
                          className="w-40"
                        />
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <input
                          type="text"
                          value={row.comment}
                          readOnly={!editable}
                          maxLength={500}
                          aria-label={t("commentOf", { name })}
                          onChange={(e) => setComment(row.enrollmentId, e.target.value)}
                          className="h-10 w-full min-w-[8rem] rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:bg-muted/40"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {editable ? <RowMark dirty={dirty} saved={row.base !== null && !dirty} error={Boolean(message)} /> : null}
                        {published && row.base ? (
                          <span className="flex flex-wrap justify-end gap-1">
                            {canRevise.allowed ? (
                              <button type="button" className={buttonClass.ghost} onClick={() => setReviseRow(row)} aria-label={t("reviseOf", { name })}>
                                {t("revise")}
                              </button>
                            ) : null}
                            {canHistory.allowed || canHistory2.allowed ? (
                              <button type="button" className={buttonClass.ghost} onClick={() => setHistoryRow(row)} aria-label={t("historyOf", { name })}>
                                {t("history")}
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                        {published && !row.base && canRevise.allowed ? (
                          <button type="button" className={buttonClass.ghost} onClick={() => setReviseRow(row)} aria-label={t("addOf", { name })}>
                            {t("add")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviseRow ? (
        <RevisionDialog
          assessmentId={assessment.id}
          row={reviseRow}
          name={studentLabel(reviseRow.studentId)}
          ctx={ctx}
          onClose={() => setReviseRow(null)}
          onDone={() => {
            flash.show(t("revisionRequested"));
            setReviseRow(null);
          }}
        />
      ) : null}
      {historyRow ? <GradeHistoryDialog row={historyRow} name={studentLabel(historyRow.studentId)} onClose={() => setHistoryRow(null)} /> : null}
    </div>
  );
}

function RowMark({ dirty, saved, error }: { dirty: boolean; saved: boolean; error: boolean }) {
  const t = useTranslations("v2Assess.grid");
  if (error) return <span className="text-xs font-medium text-destructive">{t("rowError")}</span>;
  if (dirty) return <span className="text-xs font-medium text-amber-700">{t("rowDirty")}</span>;
  if (saved) return <span className="text-xs text-emerald-700">{t("rowSaved")}</span>;
  return null;
}

function SaveIndicator({ state, dirty, invalid, at, result }: { state: SaveState; dirty: number; invalid: number; at: Date | null; result: { created: number; updated: number; unchanged: number; replayed: boolean } | null }) {
  const t = useTranslations("v2Assess.grid");
  const date = useDateFormat();
  if (state === "saving") return <span>{t("saving")}</span>;
  if (state === "retry") return <span className="font-medium text-amber-700">{t("retryPending")}</span>;
  if (state === "conflict") return <span className="font-medium text-destructive">{t("conflictShort")}</span>;
  if (invalid > 0) return <span className="font-medium text-destructive">{t("invalidRows", { count: invalid })}</span>;
  if (state === "rejected") return <span className="font-medium text-destructive">{t("rejected")}</span>;
  if (dirty > 0) return <span className="font-medium text-amber-700">{t("unsaved", { count: dirty })}</span>;
  if (state === "saved" && at && result) {
    return (
      <span className="text-emerald-700">
        {t("saved", { time: date.instant(at.toISOString()), created: result.created, updated: result.updated, unchanged: result.unchanged })}
        {result.replayed ? ` ${t("replayed")}` : ""}
      </span>
    );
  }
  return <span className="text-muted-foreground">{t("upToDate")}</span>;
}

// ---------------------------------------------------------------------------
// Demande de correction d'une note publiée
// ---------------------------------------------------------------------------

function RevisionDialog({ assessmentId, row, name, ctx, onClose, onDone }: { assessmentId: string; row: GridRow; name: string; ctx: CellContext; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Assess.revise");
  const tEntry = useTranslations("v2Assess.entryStatus");
  const revise = useRequestRevision();
  const add = useRequestAddition();
  const [text, setText] = useState(row.text);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const isAddition = row.base === null;
  const mutation = isAddition ? add : revise;
  const parsed = parseCell(text, ctx);

  async function submit() {
    if (parsed.kind === "empty" || parsed.kind === "invalid") return setErrors({ newScore: t(parsed.kind === "empty" ? "valueRequired" : "valueInvalid", { max: ctx.scaleMax.replace(".", ",") }) });
    const value = parsed.kind === "score" ? { newScore: parsed.value } : { newEntryStatus: parsed.status };
    const body = { ...value, reason };
    const v = validateWith(assessRevisionRequestBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      if (isAddition) await add.mutateAsync({ assessmentId, body: { enrollmentId: row.enrollmentId, ...value, reason } });
      else await revise.mutateAsync({ gradeId: row.gradeId ?? row.enrollmentId, body });
      onDone();
    } catch {
      /* l'erreur est affichée par la boîte de dialogue */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t(isAddition ? "addTitle" : "title", { name })} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={mutation.isPending} error={mutation.error}>
      {!isAddition ? (
        <p className="text-sm">
          {t("current", { value: row.base!.entryStatus === "ENTERED" ? (row.base!.score ?? "").replace(".", ",") : tEntry(row.base!.entryStatus) })}
        </p>
      ) : null}
      <FormField label={t("newValue")} required error={errors.newScore ?? errors.newEntryStatus} hint={t("newValueHint", { max: ctx.scaleMax.replace(".", ",") })}>
        {(c) => <TextControl {...c} value={text} onChange={setText} inputMode="decimal" />}
      </FormField>
      <FormField label={t("reason")} required error={errors.reason} hint={t("reasonHint")}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

function GradeHistoryDialog({ row, name, onClose }: { row: GridRow; name: string; onClose: () => void }) {
  const t = useTranslations("v2Assess.history");
  const tEntry = useTranslations("v2Assess.entryStatus");
  const tRev = useTranslations("v2Assess.revisionStatus");
  const tStatus = useTranslations("v2Assess.status");
  const date = useDateFormat();
  const gradeId = row.gradeId;
  const history = useGradeHistory(gradeId);
  const show = (status: string | null, score: string | null) => (status === "ENTERED" ? (score ?? "").replace(".", ",") : status ? tEntry(status as EntryStatus) : "—");
  return (
    <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("title", { name })} className="sm:max-w-2xl">
      <QueryBoundary query={history}>
        {history.data ? (
          <div className="space-y-4 text-sm">
            <p>{t("current", { value: show(history.data.current.entryStatus, history.data.current.score) })}</p>
            <section aria-labelledby="trail-title">
              <h3 id="trail-title" className="font-semibold">
                {t("trail")}
              </h3>
              <ol className="mt-1 space-y-1">
                {history.data.assessmentStatusTrail.map((s, i) => (
                  <li key={i}>
                    {tStatus(s.status)} — {date.instant(s.at)}
                  </li>
                ))}
              </ol>
            </section>
            <section aria-labelledby="rev-title">
              <h3 id="rev-title" className="font-semibold">
                {t("revisions")}
              </h3>
              {history.data.revisions.length === 0 ? (
                <p className="text-muted-foreground">{t("noRevision")}</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {history.data.revisions.map((r) => (
                    <li key={r.id} className="rounded-md border p-2">
                      <p className="font-medium">
                        {show(r.oldEntryStatus, r.oldScore)} → {show(r.newEntryStatus, r.newScore)} <StatusBadge label={tRev(r.status)} tone={toneOfStatus(r.status)} />
                      </p>
                      <p className="text-muted-foreground">{t("by", { name: r.requestedByName, date: date.instant(r.requestedAt) })}</p>
                      <p>{r.reason}</p>
                      {r.decidedByName ? <p className="text-muted-foreground">{t("decidedBy", { name: r.decidedByName, date: date.instant(r.decidedAt) })}{r.decisionComment ? ` — ${r.decisionComment}` : ""}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </QueryBoundary>
    </ModalDialog>
  );
}
