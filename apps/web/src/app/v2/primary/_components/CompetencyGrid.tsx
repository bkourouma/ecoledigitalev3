"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { primaryReviseBodySchema, type PrimaryAssessmentDto, type PrimaryCompetencySheetDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { ApiError } from "@/platform/api/errors";
import { FormField, NativeSelect, TextAreaControl, AntSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { newIdempotencyKey } from "@/platform/ui/idempotency";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { validateWith, type FieldErrors } from "@/platform/ui/validation";
import {
  useBulkRecordCompetencies,
  usePrimaryAssessmentRevisions,
  usePrimaryCompetencySummary,
  useRevisePrimaryAssessment,
  useValidatePrimaryCompetencies,
} from "@/platform/v2/primary";
import {
  baseMapOf,
  buildBatches,
  buildModel,
  cellKey,
  cellOf,
  dirtyKeys,
  fillUnassessed,
  issuesToCells,
  lineIssuesOf,
  mergeSaved,
  progressOf,
  rebase,
  setLevel,
  type Batch,
  type BaseMap,
  type CellView,
  type Drafts,
  type GridCompetency,
  type GridLevel,
  type GridModel,
  type GridStudent,
} from "./competency-grid-model";
import { ConfirmActionDialog, PrimaryError } from "./shared";
import { SummaryCounts } from "./SummaryCounts";

/** Pause de saisie avant l'enregistrement différé du lot (ms). */
export const AUTOSAVE_DELAY_MS = 5000;

type SaveState = "idle" | "saving" | "saved" | "retry" | "conflict" | "frozen" | "locked" | "rejected";

type ViewMode = "card" | "table";

interface Bundle {
  model: GridModel;
  base: BaseMap;
  drafts: Drafts;
  errors: Record<string, string>;
  editable: boolean;
  canRevise: boolean;
  onPick: (key: string, levelId: string | null) => void;
  onRevise: (assessment: PrimaryAssessmentDto, studentName: string, competency: GridCompetency) => void;
}

const studentName = (s: GridStudent, fallback: (id: string) => string): string => s.displayName ?? fallback(s.studentId);

// ---------------------------------------------------------------------------
// Espace de saisie
// ---------------------------------------------------------------------------

/**
 * Grille élèves × compétences d'une classe et d'une période.
 *
 * - une compétence non saisie reste « non évaluée » (jamais 0, jamais un niveau par défaut) ;
 * - enregistrement DIFFÉRÉ par lot (≤ 500 lignes, tout ou rien) avec UNE clé d'idempotence par lot : après un échec réseau le MÊME
 *   lot est rejoué avec la même clé ; aucune saisie ne s'efface après un échec ;
 * - 409 : « version de ligne » -> rechargement SANS écraser les saisies ; « validée » ; « période verrouillée » ;
 * - lecture seule si la période est verrouillée ou si le droit de saisie manque ; lignes validées figées (révision motivée).
 */
export function GridWorkspace({ sheet, onReload, onDirtyChange }: { sheet: PrimaryCompetencySheetDto; onReload: () => Promise<PrimaryCompetencySheetDto | undefined>; onDirtyChange?: (dirty: number) => void }) {
  const t = useTranslations("v2PrimaryCompetencies");
  const tCommon = useTranslations("v2PrimaryCommon");
  const dateFmt = useDateFormat();
  const recordPermission = usePermission("primary.competency.record");
  const canRecord = recordPermission.allowed;
  const canValidate = usePermission("primary.competency.validate").allowed;
  const canRevise = usePermission("primary.competency.revise").allowed;
  const model = useMemo(() => buildModel(sheet), [sheet]);
  const framework = sheet.framework;

  const [base, setBase] = useState<BaseMap>(() => baseMapOf(sheet.assessments));
  const [drafts, setDrafts] = useState<Drafts>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<unknown>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [autoSave, setAutoSave] = useState(true);
  const [lockedByApi, setLockedByApi] = useState(false);
  const [droppedValidated, setDroppedValidated] = useState(0);
  const [view, setView] = useState<ViewMode>("card");
  const [studentIndex, setStudentIndex] = useState(0);
  const [fillLevel, setFillLevel] = useState("");
  const [fillScope, setFillScope] = useState<"class" | "student">("class");
  const [confirmValidate, setConfirmValidate] = useState(false);
  const [validateNote, setValidateNote] = useState<{ validated: number; missing: number } | null>(null);
  const [revising, setRevising] = useState<{ assessment: PrimaryAssessmentDto; student: string; competency: GridCompetency } | null>(null);
  const [online, setOnline] = useState(true);

  const baseRef = useRef(base);
  const draftsRef = useRef(drafts);
  const pendingRef = useRef<{ batches: Array<Batch & { key: string }>; index: number } | null>(null);
  const savingRef = useRef(false);

  const bulk = useBulkRecordCompetencies();
  const validate = useValidatePrimaryCompetencies();

  const commit = useCallback((nextBase: BaseMap, nextDrafts: Drafts) => {
    baseRef.current = nextBase;
    draftsRef.current = nextDrafts;
    setBase(nextBase);
    setDrafts(nextDrafts);
  }, []);

  const readOnly = sheet.locked || lockedByApi;
  const editable = canRecord && !readOnly && model !== null;
  const dirty = useMemo(() => dirtyKeys(base, drafts), [base, drafts]);
  const progress = useMemo(() => (model ? progressOf(model, base, drafts) : null), [model, base, drafts]);

  useEffect(() => {
    onDirtyChange?.(dirty.length);
  }, [dirty.length, onDirtyChange]);

  // Avertit avant de quitter avec des saisies en attente (fermeture d'onglet, rechargement, navigation du navigateur).
  useEffect(() => {
    if (dirty.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty.length]);

  // ----- enregistrement ----------------------------------------------------------------------------------------------

  const doSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current || !model || !framework) return false;
    let plan = pendingRef.current;
    if (!plan) {
      const batches = buildBatches(model, baseRef.current, draftsRef.current);
      if (batches.length === 0) return true;
      // UNE clé par lot, conservée tant que le lot n'a pas abouti : le rejeu après un échec réseau reprend la même.
      plan = { batches: batches.map((b) => ({ ...b, key: newIdempotencyKey("comp") })), index: 0 };
      pendingRef.current = plan;
    }
    savingRef.current = true;
    setSaveState("saving");
    setSaveError(null);
    setErrors({});
    try {
      while (plan.index < plan.batches.length) {
        const batch = plan.batches[plan.index]!;
        const result = await bulk.mutateAsync({
          body: { classroomId: sheet.classroomId, periodId: sheet.periodId, frameworkId: framework.id, lines: batch.lines },
          idempotencyKey: batch.key,
        });
        const merged = mergeSaved(baseRef.current, draftsRef.current, result.assessments);
        commit(merged.base, merged.drafts);
        plan.index += 1;
      }
      pendingRef.current = null;
      setLastSavedAt(new Date().toISOString());
      setSaveState("saved");
      return true;
    } catch (e) {
      setSaveError(e);
      const retryable = !(e instanceof ApiError) || e.status === 0 || e.status === 429 || e.status >= 500;
      if (retryable) {
        // Réseau, délai, erreur serveur : on garde le MÊME lot (même clé) pour le rejouer sans doublon ; rien ne s'efface.
        setSaveState("retry");
      } else {
        const failed = plan.batches[plan.index]!;
        pendingRef.current = null;
        setErrors(issuesToCells(lineIssuesOf(e), failed));
        const code = e instanceof ApiError ? e.code : "";
        if (code.endsWith("row_version_conflict")) setSaveState("conflict");
        else if (code.endsWith("validated_frozen")) setSaveState("frozen");
        else if (code.endsWith("period_locked")) {
          setLockedByApi(true);
          setSaveState("locked");
        } else setSaveState("rejected");
      }
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [model, framework, bulk, sheet.classroomId, sheet.periodId, commit]);

  // Enregistrement différé : après une pause de saisie (jamais hors ligne, jamais quand une erreur attend une décision).
  useEffect(() => {
    if (!editable || !autoSave || !online) return;
    if (dirty.length === 0 && !pendingRef.current) return;
    if (saveState === "conflict" || saveState === "frozen" || saveState === "rejected" || saveState === "locked" || savingRef.current) return;
    const handle = setTimeout(() => void doSave(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(handle);
  }, [editable, autoSave, online, dirty.length, drafts, saveState, doSave]);

  // Réseau : suivi de l'état en ligne ; reprise de l'envoi du même lot au retour de la connexion.
  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const on = () => {
      setOnline(true);
      if (pendingRef.current) void doSave();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [doSave]);

  // ----- édition -----------------------------------------------------------------------------------------------------

  const onPick = useCallback(
    (key: string, levelId: string | null) => {
      const cell = cellOf(key, baseRef.current, draftsRef.current);
      // Retoucher le niveau déjà choisi : annule la saisie en attente ; une valeur enregistrée ne se « décoche » pas (pas de suppression).
      const next = levelId !== null && cell.levelId === levelId ? (cell.status === "pending" ? null : undefined) : levelId;
      if (next === undefined) return;
      commit(baseRef.current, setLevel(draftsRef.current, baseRef.current, key, next));
      setErrors((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setSaveState((s) => (s === "saved" ? "idle" : s));
    },
    [commit],
  );

  function applyFill() {
    if (!model || !fillLevel) return;
    const scope = fillScope === "student" && model.students[studentIndex] ? { enrollmentId: model.students[studentIndex]!.enrollmentId } : {};
    commit(baseRef.current, fillUnassessed(model, baseRef.current, draftsRef.current, fillLevel, scope));
    setSaveState((s) => (s === "saved" ? "idle" : s));
  }

  function discardDrafts() {
    pendingRef.current = null;
    setErrors({});
    commit(baseRef.current, {});
    setSaveState("idle");
    setSaveError(null);
  }

  /** Recharge la grille SANS écraser les saisies en attente (les lignes devenues validées sont annoncées, jamais perdues en silence). */
  async function reloadKeepingDrafts() {
    const fresh = await onReload();
    if (!fresh) return;
    const nextBase = baseMapOf(fresh.assessments);
    const r = rebase(nextBase, draftsRef.current);
    pendingRef.current = null;
    commit(nextBase, r.drafts);
    setDroppedValidated(r.droppedValidated.length);
    setErrors({});
    setSaveError(null);
    setSaveState("idle");
    if (!fresh.locked) setLockedByApi(false);
  }

  async function runValidate() {
    if (!framework) return;
    try {
      const r = await validate.mutateAsync({ classroomId: sheet.classroomId, periodId: sheet.periodId, frameworkId: framework.id });
      setValidateNote({ validated: r.validated, missing: r.missing });
      setConfirmValidate(false);
      await reloadKeepingDrafts();
    } catch {
      /* l'erreur est affichée dans la fenêtre (validate.error) */
    }
  }

  // ----- rendu -------------------------------------------------------------------------------------------------------

  if (!model || !framework || !progress) return <Notice kind="info">{t("noFramework")}</Notice>;

  const fallbackName = (id: string) => tCommon("studentFallback", { id: id.slice(-4) });
  const student = model.students[Math.min(studentIndex, Math.max(0, model.students.length - 1))];
  const bundle: Bundle = {
    model,
    base,
    drafts,
    errors,
    editable,
    canRevise: canRevise && sheet.locked === false,
    onPick,
    onRevise: (assessment, name, competency) => setRevising({ assessment, student: name, competency }),
  };
  const pendingText = t("counters.pending", { count: dirty.length });
  const canValidateNow = canValidate && !readOnly && dirty.length === 0 && progress.saved > progress.validated;

  return (
    <div className="space-y-4 pb-28">
      {sheet.locked ? <Notice kind="warning">{t("lockedSheet")}</Notice> : lockedByApi ? <Notice kind="warning">{t("lockedByApi")}</Notice> : null}
      {!canRecord && !recordPermission.isLoading && !readOnly ? <Notice kind="info">{t("readOnlyNoRight")}</Notice> : null}
      {model.students.length === 0 ? <Notice kind="info">{t("noStudents")}</Notice> : null}
      {droppedValidated > 0 ? <Notice kind="warning">{t("droppedValidated", { count: droppedValidated })}</Notice> : null}
      {validateNote ? <Notice kind="success">{t("validated", { validated: validateNote.validated, missing: validateNote.missing })}</Notice> : null}

      <SaveStateNotice state={saveState} error={saveError} online={online} onRetry={() => void doSave()} onReload={() => void reloadKeepingDrafts()} />

      <section aria-label={t("counters.label")} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p role="status" aria-live="polite" className="text-sm font-medium" data-testid="completeness">
          {t("counters.recorded", { recorded: progress.recorded, expected: progress.expected })}
          {" · "}
          {pendingText}
          {" · "}
          {t("counters.validated", { count: progress.validated })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("counters.unassessedHint", { count: progress.unassessed })}</p>
      </section>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("view.label")}>
        <button type="button" aria-pressed={view === "card"} onClick={() => setView("card")} className={view === "card" ? buttonClass.primary : buttonClass.secondary}>
          {t("view.card")}
        </button>
        <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")} className={view === "table" ? buttonClass.primary : buttonClass.secondary}>
          {t("view.table")}
        </button>
        <StatusBadge label={framework.sourceKind === "placeholder" ? t("frameworkPlaceholder", { label: framework.label }) : framework.label} tone={framework.sourceKind === "placeholder" ? "warning" : "neutral"} />
      </div>

      {editable ? (
        <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <legend className="px-1 text-sm font-medium">{t("fill.legend")}</legend>
          <p className="text-xs text-muted-foreground">{t("fill.hint")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t("fill.level")}>
              {(c) => <NativeSelect {...c} value={fillLevel} onChange={setFillLevel} placeholder={t("fill.chooseLevel")} options={model.levels.map((l) => ({ value: l.id, label: `${l.code} — ${l.label}` }))} />}
            </FormField>
            {view === "card" ? (
              <FormField label={t("fill.scope")}>
                {(c) => (
                  <NativeSelect
                    {...c}
                    value={fillScope}
                    onChange={(v) => setFillScope(v === "student" ? "student" : "class")}
                    options={[
                      { value: "class", label: t("fill.scopeClass") },
                      { value: "student", label: t("fill.scopeStudent") },
                    ]}
                  />
                )}
              </FormField>
            ) : null}
            <div className="flex items-end gap-2">
              <button type="button" className={buttonClass.secondary} disabled={!fillLevel} onClick={applyFill}>
                {t("fill.apply")}
              </button>
            </div>
          </div>
          {dirty.length > 0 ? (
            <button type="button" className={buttonClass.ghost} onClick={discardDrafts}>
              {t("discard", { count: dirty.length })}
            </button>
          ) : null}
        </fieldset>
      ) : null}

      {view === "card" && student ? (
        <StudentCard bundle={bundle} student={student} index={studentIndex} onIndex={setStudentIndex} fallbackName={fallbackName} />
      ) : view === "table" ? (
        <GridTable bundle={bundle} fallbackName={fallbackName} />
      ) : null}

      <SummaryPanel model={model} periodId={sheet.periodId} fallbackName={fallbackName} />

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground" aria-live="polite" data-testid="save-status">
            {saveState === "saving"
              ? t("save.saving")
              : dirty.length > 0
                ? t("save.pending", { count: dirty.length })
                : lastSavedAt
                  ? t("save.savedAt", { time: dateFmt.instant(lastSavedAt) })
                  : t("save.nothing")}
          </p>
          {editable ? (
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} className="h-4 w-4 accent-primary" />
              {t("save.auto")}
            </label>
          ) : null}
          {canValidate ? (
            <button type="button" className={buttonClass.secondary} disabled={!canValidateNow} onClick={() => setConfirmValidate(true)} title={dirty.length > 0 ? t("validate.needsSave") : undefined}>
              {t("validate.button")}
            </button>
          ) : null}
          {editable ? (
            <button type="button" className={buttonClass.primary} disabled={saveState === "saving" || (dirty.length === 0 && !pendingRef.current)} onClick={() => void doSave()}>
              {saveState === "saving" ? t("save.saving") : t("save.button")}
            </button>
          ) : null}
        </div>
      </div>

      <ConfirmActionDialog
        open={confirmValidate}
        onOpenChange={(o) => {
          setConfirmValidate(o);
          if (!o) validate.reset();
        }}
        title={t("validate.title")}
        description={t("validate.description")}
        confirmLabel={t("validate.confirm")}
        isPending={validate.isPending}
        error={validate.error}
        onConfirm={() => void runValidate()}
      >
        <p className="text-sm">{t("validate.missing", { count: progress.unassessed })}</p>
      </ConfirmActionDialog>

      {revising ? (
        <ReviseDialog
          assessment={revising.assessment}
          studentLabel={revising.student}
          competency={revising.competency}
          levels={model.levels}
          onClose={() => setRevising(null)}
          onRevised={(a) => {
            commit(new Map(baseRef.current).set(cellKey(a.enrollmentId, a.competencyId), a), draftsRef.current);
            setRevising(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Messages d'état de l'enregistrement
// ---------------------------------------------------------------------------

function SaveStateNotice({ state, error, online, onRetry, onReload }: { state: SaveState; error: unknown; online: boolean; onRetry: () => void; onReload: () => void }) {
  const t = useTranslations("v2PrimaryCompetencies");
  return (
    <div className="space-y-2">
      {!online ? <Notice kind="warning">{t("save.offline")}</Notice> : null}
      {state === "retry" ? (
        <div className="space-y-2">
          <Notice kind="warning">{t("save.retry")}</Notice>
          <button type="button" className={buttonClass.secondary} onClick={onRetry}>
            {t("save.retryNow")}
          </button>
        </div>
      ) : null}
      {state === "conflict" || state === "frozen" ? (
        <div className="space-y-2">
          <PrimaryError error={error} />
          <p className="text-sm">{state === "conflict" ? t("save.conflictHint") : t("save.frozenHint")}</p>
          <button type="button" className={buttonClass.secondary} onClick={onReload}>
            {t("save.reloadKeep")}
          </button>
        </div>
      ) : null}
      {state === "locked" || state === "rejected" ? (
        <div className="space-y-2">
          <PrimaryError error={error} />
          {state === "rejected" ? <p className="text-sm">{t("save.rejectedHint")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiche élève (mobile d'abord) : un élève à la fois
// ---------------------------------------------------------------------------

function cellStatusLabel(t: (key: string) => string, cell: CellView): string {
  switch (cell.status) {
    case "validated":
      return t("cell.validated");
    case "saved":
      return t("cell.saved");
    case "pending":
      return t("cell.pending");
    default:
      return t("cell.unassessed");
  }
}

function StudentCard({ bundle, student, index, onIndex, fallbackName }: { bundle: Bundle; student: GridStudent; index: number; onIndex: (i: number) => void; fallbackName: (id: string) => string }) {
  const t = useTranslations("v2PrimaryCompetencies");
  const { model, base, drafts, errors, editable, canRevise, onPick, onRevise } = bundle;
  const name = studentName(student, fallbackName);
  const p = progressOf(model, base, drafts, { enrollmentId: student.enrollmentId });
  const last = model.students.length - 1;
  return (
    <section aria-label={t("card.label")} className="space-y-4 rounded-2xl border border-white/10 bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass.secondary} disabled={index <= 0} onClick={() => onIndex(index - 1)} aria-label={t("card.previous")}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <FormField label={t("card.student")}>
            {(c) => <NativeSelect {...c} value={student.enrollmentId} onChange={(v) => onIndex(Math.max(0, model.students.findIndex((s) => s.enrollmentId === v)))} options={model.students.map((s) => ({ value: s.enrollmentId, label: studentName(s, fallbackName) }))} />}
          </FormField>
        </div>
        <button type="button" className={buttonClass.secondary} disabled={index >= last} onClick={() => onIndex(index + 1)} aria-label={t("card.next")}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div>
        <h2 className="text-lg font-semibold">{name}</h2>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("card.progress", { recorded: p.recorded, expected: p.expected, position: index + 1, total: model.students.length })}
          {student.isRepeating ? ` · ${t("card.repeating")}` : ""}
        </p>
      </div>
      {model.domains.map((domain) => (
        <fieldset key={domain.id} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <legend className="px-1 text-sm font-semibold">{`${domain.code} — ${domain.label}`}</legend>
          {domain.competencies.map((competency) => {
            const key = cellKey(student.enrollmentId, competency.id);
            const cell = cellOf(key, base, drafts);
            const labelId = `cmp-${student.enrollmentId}-${competency.id}`;
            return (
              <div key={competency.id} role="group" aria-labelledby={labelId} className="space-y-2 border-b pb-3 last:border-0 last:pb-0">
                <p id={labelId} className="text-sm font-medium">
                  <span className="text-muted-foreground">{competency.code}</span> {competency.label}
                </p>
                {competency.description ? <p className="text-xs text-muted-foreground">{competency.description}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {model.levels.map((level) => {
                    const selected = cell.levelId === level.id;
                    return (
                      <button
                        key={level.id}
                        type="button"
                        aria-pressed={selected}
                        aria-label={t("card.levelButton", { code: level.code, label: level.label, competency: competency.label })}
                        disabled={!editable || cell.status === "validated"}
                        onClick={() => onPick(key, level.id)}
                        className={
                          "inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-md border px-3 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 " +
                          (selected ? "border-primary bg-primary/10 font-semibold" : "border-input bg-background hover:bg-accent")
                        }
                      >
                        {selected ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                        <span className="font-semibold">{level.code}</span>
                        <span className="text-xs">{level.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge label={cellStatusLabel(t, cell)} tone={cell.status === "validated" ? "success" : cell.status === "pending" ? "warning" : cell.status === "saved" ? "info" : "neutral"} />
                  {cell.status === "validated" && canRevise && cell.assessment ? (
                    <button type="button" className={buttonClass.ghost} onClick={() => onRevise(cell.assessment!, name, competency)}>
                      {t("cell.revise")}
                    </button>
                  ) : null}
                </div>
                {errors[key] ? (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {errors[key]}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tableau (grand écran)
// ---------------------------------------------------------------------------

function GridTable({ bundle, fallbackName }: { bundle: Bundle; fallbackName: (id: string) => string }) {
  const t = useTranslations("v2PrimaryCompetencies");
  const { model, base, drafts, errors, editable, canRevise, onPick, onRevise } = bundle;
  return (
    <section aria-label={t("table.label")} className="space-y-2">
      <details className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
        <summary className="min-h-[2.75rem] cursor-pointer py-2 font-medium">{t("table.legend")}</summary>
        <dl className="mt-2 grid gap-1 sm:grid-cols-2">
          {model.competencies.map((c) => (
            <div key={c.id} className="flex gap-2">
              <dt className="font-semibold">{c.code}</dt>
              <dd>{c.label}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className="max-h-[70vh] overflow-auto rounded-md border" role="region" tabIndex={0} aria-label={t("table.scrollRegion")}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("table.caption")}</caption>
          <thead>
            <tr className="bg-muted/40">
              <th scope="col" rowSpan={2} className="sticky left-0 z-10 min-w-[10rem] border-b bg-muted px-3 py-2 text-left font-medium">
                {t("table.student")}
              </th>
              {model.domains.map((d) => (
                <th key={d.id} scope="colgroup" colSpan={Math.max(1, d.competencies.length)} className="border-b border-l px-3 py-2 text-center font-semibold">
                  {`${d.code} — ${d.label}`}
                </th>
              ))}
            </tr>
            <tr className="bg-muted/40">
              {model.competencies.map((c) => (
                <th key={c.id} scope="col" title={c.label} className="min-w-[8rem] border-b border-l px-2 py-1 text-center text-xs font-medium">
                  {c.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.students.map((s) => {
              const name = studentName(s, fallbackName);
              return (
                <tr key={s.enrollmentId} className="border-b last:border-0">
                  <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-1 text-left font-medium">
                    {name}
                  </th>
                  {model.competencies.map((c) => {
                    const key = cellKey(s.enrollmentId, c.id);
                    const cell = cellOf(key, base, drafts);
                    const level = model.levels.find((l) => l.id === cell.levelId) ?? null;
                    const err = errors[key];
                    return (
                      <td key={c.id} className="border-l px-1 py-1 align-top">
                        {cell.status === "validated" ? (
                          <div className="flex flex-col items-start gap-1 px-1">
                            <span className="text-xs font-semibold">{level ? `${level.code} · ${t("cell.validated")}` : t("cell.validated")}</span>
                            {canRevise && cell.assessment ? (
                              <button type="button" className={buttonClass.ghost} aria-label={t("table.reviseCell", { student: name, competency: c.label })} onClick={() => onRevise(cell.assessment!, name, c)}>
                                {t("cell.revise")}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <AntSelect
                            aria-label={t("table.cellLabel", { student: name, competency: c.label })}
                            aria-invalid={err ? true : undefined}
                            disabled={!editable}
                            value={cell.levelId ?? ""}
                            onChange={(e) => onPick(key, e.target.value === "" ? null : e.target.value)}
                            className={"h-10 w-full rounded-md border bg-background px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 " + (cell.status === "pending" ? "border-amber-500 font-semibold" : "border-input")}
                          >
                            <option value="" disabled={cell.assessment !== null}>
                              {t("cell.unassessed")}
                            </option>
                            {model.levels.map((l: GridLevel) => (
                              <option key={l.id} value={l.id}>
                                {`${l.code} — ${l.label}`}
                              </option>
                            ))}
                          </AntSelect>
                        )}
                        {cell.status === "pending" ? <span className="block px-1 text-[11px] text-amber-300">{t("cell.pending")}</span> : null}
                        {err ? (
                          <span role="alert" className="block px-1 text-[11px] font-medium text-destructive">
                            {err}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Synthèse par compteurs
// ---------------------------------------------------------------------------

function SummaryPanel({ model, periodId, fallbackName }: { model: GridModel; periodId: string; fallbackName: (id: string) => string }) {
  const t = useTranslations("v2PrimaryCompetencies");
  const [open, setOpen] = useState(false);
  const [enrollmentId, setEnrollmentId] = useState("");
  const summary = usePrimaryCompetencySummary(open && enrollmentId ? enrollmentId : null, [periodId]);
  if (model.students.length === 0) return null;
  return (
    <section aria-label={t("summary.label")} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <h2 className="text-base font-semibold">{t("summary.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("summary.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("summary.student")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={enrollmentId}
              onChange={(v) => {
                setEnrollmentId(v);
                setOpen(v !== "");
              }}
              placeholder={t("summary.choose")}
              options={model.students.map((s) => ({ value: s.enrollmentId, label: studentName(s, fallbackName) }))}
            />
          )}
        </FormField>
      </div>
      {open && enrollmentId ? (
        summary.isPending ? (
          <LoadingBlock />
        ) : summary.isError ? (
          <PrimaryError error={summary.error} />
        ) : (
          <SummaryCounts data={summary.data} />
        )
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Révision d'une ligne validée (droit SENSIBLE)
// ---------------------------------------------------------------------------

function ReviseDialog({
  assessment,
  studentLabel,
  competency,
  levels,
  onClose,
  onRevised,
}: {
  assessment: PrimaryAssessmentDto;
  studentLabel: string;
  competency: GridCompetency;
  levels: ReadonlyArray<GridLevel>;
  onClose: () => void;
  onRevised: (assessment: PrimaryAssessmentDto) => void;
}) {
  const t = useTranslations("v2PrimaryCompetencies.revise");
  const dateFmt = useDateFormat();
  const revise = useRevisePrimaryAssessment();
  const history = usePrimaryAssessmentRevisions(assessment.id);
  const [toLevel, setToLevel] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const current = levels.find((l) => l.id === assessment.ratingLevelId);
  const levelCode = (id: string) => levels.find((l) => l.id === id)?.code ?? id.slice(0, 4);

  async function submit() {
    // Contrôle de FORME (motif de 10 caractères) avec le schéma du contrat ; l'API reste la barrière.
    const v = validateWith(primaryReviseBodySchema, { toRatingLevelId: toLevel, reason });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const r = await revise.mutateAsync({ assessmentId: assessment.id, ...v.data });
      onRevised(r.assessment);
    } catch {
      /* l'erreur est affichée par FormDialog */
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description", { student: studentLabel, competency: competency.label, level: current ? `${current.code} — ${current.label}` : "—" })}
      submitLabel={t("submit")}
      onSubmit={() => void submit()}
      isPending={revise.isPending}
      error={revise.error}
    >
      <FormField label={t("newLevel")} required error={errors.toRatingLevelId}>
        {(c) => <NativeSelect {...c} value={toLevel} onChange={setToLevel} placeholder={t("chooseLevel")} options={levels.filter((l) => l.id !== assessment.ratingLevelId).map((l) => ({ value: l.id, label: `${l.code} — ${l.label}` }))} />}
      </FormField>
      <FormField label={t("reason")} required hint={t("reasonHint")} error={errors.reason}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={1000} />}
      </FormField>
      <div>
        <h3 className="text-sm font-semibold">{t("history")}</h3>
        {history.isPending ? (
          <LoadingBlock />
        ) : history.isError ? (
          <PrimaryError error={history.error} />
        ) : history.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {history.data.map((h) => (
              <li key={h.id}>
                {t("historyLine", { from: levelCode(h.fromLevelId), to: levelCode(h.toLevelId), date: dateFmt.instant(h.createdAt), reason: h.reason })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormDialog>
  );
}
