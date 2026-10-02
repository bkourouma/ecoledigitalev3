"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { examResultRevisionBodySchema, examScoreRevisionBodySchema, type ExamRevisionRequestDto, type ExamSessionDetailDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDateFormat } from "@/platform/ui/format";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useApproveRevision, useExamResults, useRejectRevision, useRequestResultRevision, useRequestScoreRevision, useRevisionRequests, useScoreMatrix } from "@/platform/v2/examinations";
import { SessionScope, StatusPill, useExamLabels } from "./shared";

const RESULT_CODES = ["ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"] as const;
const SCORE_STATUSES = ["ENTERED", "ABSENT", "EXCUSED", "MALPRACTICE"] as const;

const revisionTone = (s: string) => (s === "APPROVED" ? "success" : s === "REJECTED" ? "danger" : "warning");

function Values({ title, values }: { title: string; values: Record<string, unknown> }) {
  const t = useTranslations("v2Examinations.corrections.field");
  const labels = useExamLabels();
  const entries = Object.entries(values);
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {entries.length === 0 ? <p>—</p> : (
        <ul className="text-sm">
          {entries.map(([k, v]) => {
            const text = v === null || v === undefined ? "—" : String(v);
            const shown = k === "resultCode" ? labels.resultCode(text) : k === "status" ? labels.scoreStatus(text) : text.replace(".", ",");
            return <li key={k}>{t.has(k as never) ? t(k as never) : k} : {shown}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

function NewRequest({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.corrections.new");
  const labels = useExamLabels();
  const flash = useFlash();
  const results = useExamResults(session.id, { pageSize: 500 });
  const matrix = useScoreMatrix(session.id);
  const requestResult = useRequestResultRevision();
  const requestScore = useRequestScoreRevision();
  const [target, setTarget] = useState<"RESULT" | "SCORE">("RESULT");
  const [form, setForm] = useState({ resultId: "", candidateId: "", paperId: "", code: "ADMITTED", average: "", status: "ENTERED", score: "", reason: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const scoreId = matrix.data?.rows.find((r) => r.candidateId === form.candidateId)?.scores[form.paperId]?.id ?? null;

  async function submit() {
    flash.show(null);
    try {
      if (target === "RESULT") {
        const parsed = validateWith(examResultRevisionBodySchema, { resultCode: form.code, average: form.average.trim() ? form.average.trim().replace(",", ".") : null, reason: form.reason });
        if (!form.resultId) return setErrors({ resultId: t("pickResult") });
        if (!parsed.ok) return setErrors(parsed.errors);
        setErrors({});
        await requestResult.mutateAsync({ resultId: form.resultId, resultCode: parsed.data.resultCode, average: parsed.data.average ?? null, reason: parsed.data.reason });
      } else {
        const parsed = validateWith(examScoreRevisionBodySchema, { status: form.status, score: form.status === "ENTERED" ? form.score.trim().replace(",", ".") : null, reason: form.reason });
        if (!scoreId) return setErrors({ paperId: t("pickScore") });
        if (!parsed.ok) return setErrors(parsed.errors);
        setErrors({});
        await requestScore.mutateAsync({ scoreId, status: parsed.data.status, score: parsed.data.score ?? null, reason: parsed.data.reason });
      }
      setForm((f) => ({ ...f, reason: "", average: "", score: "" }));
      flash.show(t("sent"));
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }
  const failure = target === "RESULT" ? requestResult : requestScore;

  return (
    <Can permission="exam.result.enter">
      <section aria-labelledby="new-title" className="space-y-3 rounded-md border p-4">
        <h2 id="new-title" className="text-base font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
        <FormField label={t("target")} className="max-w-xs">{(c) => <NativeSelect {...c} value={target} options={[{ value: "RESULT", label: t("targetResult") }, { value: "SCORE", label: t("targetScore") }]} onChange={(v) => { setTarget(v as "RESULT" | "SCORE"); setErrors({}); }} />}</FormField>
        {target === "RESULT" ? (
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label={t("result")} required error={errors.resultId ?? null}>{(c) => <NativeSelect {...c} value={form.resultId} placeholder={t("choose")} options={(results.data?.items ?? []).map((r) => ({ value: r.id, label: `${r.displayName ?? r.candidateNumber ?? r.candidateId} — ${labels.resultCode(r.resultCode)}` }))} onChange={set("resultId")} />}</FormField>
            <FormField label={t("code")} required error={errors.resultCode ?? null}>{(c) => <NativeSelect {...c} value={form.code} options={RESULT_CODES.map((r) => ({ value: r, label: labels.resultCode(r) }))} onChange={set("code")} />}</FormField>
            <FormField label={t("average")} error={errors.average ?? null}>{(c) => <TextControl {...c} inputMode="decimal" value={form.average} onChange={set("average")} />}</FormField>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-4">
            <FormField label={t("candidate")} required>{(c) => <NativeSelect {...c} value={form.candidateId} placeholder={t("choose")} options={(matrix.data?.rows ?? []).map((r) => ({ value: r.candidateId, label: r.displayName ?? r.candidateNumber ?? r.candidateId }))} onChange={set("candidateId")} />}</FormField>
            <FormField label={t("paper")} required error={errors.paperId ?? null}>{(c) => <NativeSelect {...c} value={form.paperId} placeholder={t("choose")} options={(matrix.data?.papers ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${p.label}` }))} onChange={set("paperId")} />}</FormField>
            <FormField label={t("status")} required error={errors.status ?? null}>{(c) => <NativeSelect {...c} value={form.status} options={SCORE_STATUSES.map((s) => ({ value: s, label: labels.scoreStatus(s) }))} onChange={set("status")} />}</FormField>
            <FormField label={t("score")} error={errors.score ?? null}>{(c) => <TextControl {...c} inputMode="decimal" disabled={form.status !== "ENTERED"} value={form.score} onChange={set("score")} />}</FormField>
          </div>
        )}
        <FormField label={t("reason")} required hint={t("reasonHint")} error={errors.reason ?? null}>{(c) => <TextAreaControl {...c} value={form.reason} onChange={set("reason")} maxLength={500} />}</FormField>
        <button type="button" className={buttonClass.primary} disabled={failure.isPending} onClick={() => void submit()}>{t("submit")}</button>
        {flash.node}
        {failure.isError && Object.keys(errors).length === 0 ? <ErrorBlock error={failure.error} /> : null}
      </section>
    </Can>
  );
}

function RequestCard({ r }: { r: ExamRevisionRequestDto }) {
  const t = useTranslations("v2Examinations.corrections.card");
  const labels = useExamLabels();
  const date = useDateFormat();
  const approve = useApproveRevision();
  const reject = useRejectRevision();
  const [rejecting, setRejecting] = useState(false);
  return (
    <li className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{r.targetKind === "RESULT" ? t("result") : t("score")} — {r.candidateNumber ?? "—"}</h3>
        <StatusPill label={labels.revisionStatus(r.status)} tone={revisionTone(r.status)} />
        <span className="text-xs text-muted-foreground">{date.instant(r.requestedAt)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Values title={t("current")} values={r.current} />
        <Values title={t("proposed")} values={r.proposed} />
      </div>
      <p className="text-sm"><span className="font-medium">{t("reason")}</span> {r.reason}</p>
      {r.decisionNote ? <p className="text-sm"><span className="font-medium">{t("note")}</span> {r.decisionNote}</p> : null}
      {r.status === "PENDING" ? (
        <Can permission="exam.result.revise">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.primary} disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>{t("approve")}</button>
            <button type="button" className={buttonClass.secondary} onClick={() => setRejecting(true)}>{t("reject")}</button>
          </div>
          <p className="text-xs text-muted-foreground">{t("fourEyes")}</p>
        </Can>
      ) : null}
      {approve.isError ? <ErrorBlock error={approve.error} /> : null}
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t("rejectDialog.title")}
        reasonLabel={t("rejectDialog.note")}
        confirmLabel={t("rejectDialog.confirm")}
        destructive
        isPending={reject.isPending}
        error={reject.error}
        onConfirm={async (note) => {
          try {
            await reject.mutateAsync({ id: r.id, note });
            setRejecting(false);
          } catch {
            /* erreur affichée dans la fenêtre */
          }
        }}
      />
    </li>
  );
}

function Panel({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.corrections");
  const [status, setStatus] = useState<"" | "PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const list = useRevisionRequests(session.id, status === "" ? undefined : status);
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-4">
      <Notice kind="info">{t("notice")}</Notice>
      <NewRequest session={session} />
      <FormField label={t("filter")} className="max-w-xs">
        {(c) => <NativeSelect {...c} value={status} placeholder={t("all")} options={[{ value: "PENDING", label: t("pending") }, { value: "APPROVED", label: t("approved") }, { value: "REJECTED", label: t("rejected") }]} onChange={(v) => setStatus(v as typeof status)} />}
      </FormField>
      {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : <ul className="space-y-3" aria-label={t("listLabel")}>{items.map((r) => <RequestCard key={r.id} r={r} />)}</ul>}
    </div>
  );
}

/** Corrections après résultats : demande motivée, approuvée par une AUTRE personne ; tout reste dans l'historique. */
export function CorrectionsScreen() {
  const t = useTranslations("v2Examinations.corrections");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SessionScope>{(session) => <Panel session={session} />}</SessionScope>
    </div>
  );
}
