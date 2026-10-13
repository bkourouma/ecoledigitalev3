"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { examBulkResultsBodySchema, examBulkScoresBodySchema, type ExamResultDto, type ExamScoreMatrixDto, type ExamSessionDetailDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl, AntSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { showDecimal } from "@/platform/ui/format";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useExamCandidates, useExamResults, usePublishResult, useSaveResults, useSaveScores, useScoreMatrix } from "@/platform/v2/examinations";
import { BatchReport, outcomeTone, SessionScope, StatusPill, useExamLabels } from "./shared";

const SCORE_STATUSES = ["ENTERED", "ABSENT", "EXCUSED", "MALPRACTICE"] as const;
const RESULT_CODES = ["ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"] as const;
type Cell = { status: string; score: string };

function ScoresTab({ session, matrix }: { session: ExamSessionDetailDto; matrix: ExamScoreMatrixDto }) {
  const t = useTranslations("v2Examinations.results.scores");
  const labels = useExamLabels();
  const save = useSaveScores(session.id);
  const [edits, setEdits] = useState<Record<string, Cell>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const key = (c: string, p: string) => `${c}:${p}`;
  const current = (candidateId: string, paperId: string): Cell => {
    const e = edits[key(candidateId, paperId)];
    if (e) return e;
    const s = matrix.rows.find((r) => r.candidateId === candidateId)?.scores[paperId];
    return { status: s?.status ?? "ENTERED", score: s?.score ?? "" };
  };
  const change = (candidateId: string, paperId: string, patch: Partial<Cell>) => setEdits((prev) => ({ ...prev, [key(candidateId, paperId)]: { ...current(candidateId, paperId), ...patch } }));

  async function submit() {
    const items = Object.entries(edits).flatMap(([k, cell]) => {
      const [candidateId, paperId] = k.split(":");
      if (cell.status === "ENTERED" && cell.score.trim() === "") return [];
      return [{ candidateId: candidateId!, paperId: paperId!, status: cell.status, score: cell.status === "ENTERED" ? cell.score.trim().replace(",", ".") : null }];
    });
    const parsed = validateWith(examBulkScoresBodySchema, { items });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    try {
      await save.mutateAsync(parsed.data);
      setEdits({});
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  if (matrix.rows.length === 0) return <EmptyBlock title={t("empty")} description={t("emptyHint")} />;
  const dirty = Object.keys(edits).length;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("caption")}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="bg-white/[0.04] text-left">
            <tr>
              <th scope="col" className="px-3 py-2">{t("candidate")}</th>
              {matrix.papers.map((p) => <th key={p.id} scope="col" className="px-3 py-2">{p.code}<span className="block text-xs font-normal text-muted-foreground">/{showDecimal(p.scaleMax)}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((r) => (
              <tr key={r.candidateId} className="border-t align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">{r.displayName ?? r.candidateNumber ?? r.candidateId}<span className="block text-xs font-normal text-muted-foreground">{r.candidateNumber ?? ""}</span></th>
                {matrix.papers.map((p) => {
                  const forTrack = p.trackCode === null || p.trackCode === r.trackCode;
                  const cell = current(r.candidateId, p.id);
                  const name = r.displayName ?? r.candidateNumber ?? r.candidateId;
                  return (
                    <td key={p.id} className="px-2 py-2">
                      {forTrack ? (
                        <Can permission="exam.score.enter" fallback={<span>{cell.status === "ENTERED" ? showDecimal(cell.score) : labels.scoreStatus(cell.status)}</span>}>
                          <div className="flex min-w-[8rem] gap-1">
                            <input aria-label={t("scoreOf", { name, paper: p.code })} inputMode="decimal" disabled={cell.status !== "ENTERED"} value={cell.score} onChange={(e) => change(r.candidateId, p.id, { score: e.target.value })} className="h-10 w-16 rounded-xl border border-input bg-background px-2 text-sm" />
                            <AntSelect aria-label={t("statusOf", { name, paper: p.code })} value={cell.status} onChange={(e) => change(r.candidateId, p.id, { status: e.target.value, ...(e.target.value === "ENTERED" ? {} : { score: "" }) })} className="h-10 rounded-xl border border-input bg-background px-1 text-xs">
                              {SCORE_STATUSES.map((s) => <option key={s} value={s}>{labels.scoreStatus(s)}</option>)}
                            </AntSelect>
                          </div>
                        </Can>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Can permission="exam.score.enter">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass.primary} disabled={dirty === 0 || save.isPending} onClick={() => void submit()}>{t("save", { count: dirty })}</button>
          {dirty > 0 ? <button type="button" className={buttonClass.ghost} onClick={() => setEdits({})}>{t("discard")}</button> : null}
        </div>
      </Can>
      {Object.keys(errors).length > 0 ? <Notice kind="error">{Object.values(errors)[0]}</Notice> : null}
      {save.isError && Object.keys(errors).length === 0 ? <ErrorBlock error={save.error} /> : null}
      {save.data ? <BatchReport summary={t("report", { saved: save.data.saved, unchanged: save.data.unchanged })} failures={save.data.failed.map((f) => ({ id: `${f.candidateId}-${f.paperId}`, message: f.message, code: f.code }))} /> : null}
      <p className="text-xs text-muted-foreground">{t("revisionHint")} <Link className="underline" href={`/v2/examinations/corrections?session=${session.id}`}>{t("revisionLink")}</Link></p>
    </div>
  );
}

function EnterResult({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.results.enter");
  const labels = useExamLabels();
  const candidates = useExamCandidates(session.id, { registrationStatus: "REGISTERED", pageSize: 500 });
  const save = useSaveResults(session.id);
  const [form, setForm] = useState({ candidateId: "", resultCode: "ADMITTED", average: "", rank: "", mention: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function submit() {
    const parsed = validateWith(examBulkResultsBodySchema, {
      items: [
        {
          candidateId: form.candidateId,
          resultCode: form.resultCode,
          ...(form.average.trim() ? { average: form.average.trim().replace(",", ".") } : {}),
          ...(form.rank.trim() ? { rank: Number(form.rank) } : {}),
          ...(form.mention.trim() ? { mentionCode: form.mention.trim().toUpperCase() } : {}),
        },
      ],
    });
    if (!parsed.ok) return setErrors(Object.fromEntries(Object.entries(parsed.errors).map(([k, v]) => [k.replace(/^items\.0\./, ""), v])));
    setErrors({});
    try {
      const out = await save.mutateAsync(parsed.data);
      if (out.failed.length === 0) setForm((f) => ({ ...f, candidateId: "", average: "", rank: "", mention: "" }));
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }
  return (
    <section aria-labelledby="enter-title" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 id="enter-title" className="text-base font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <div className="grid gap-3 md:grid-cols-5">
        <FormField label={t("candidate")} required error={errors.candidateId ?? null} className="md:col-span-2">{(c) => <NativeSelect {...c} value={form.candidateId} placeholder={t("choose")} options={(candidates.data?.items ?? []).map((x) => ({ value: x.id, label: `${x.displayName ?? x.studentId}${x.candidateNumber ? ` (${x.candidateNumber})` : ""}` }))} onChange={set("candidateId")} />}</FormField>
        <FormField label={t("code")} required error={errors.resultCode ?? null}>{(c) => <NativeSelect {...c} value={form.resultCode} options={RESULT_CODES.map((r) => ({ value: r, label: labels.resultCode(r) }))} onChange={set("resultCode")} />}</FormField>
        <FormField label={t("average")} error={errors.average ?? null}>{(c) => <TextControl {...c} inputMode="decimal" value={form.average} onChange={set("average")} />}</FormField>
        <FormField label={t("rank")} error={errors.rank ?? null}>{(c) => <TextControl {...c} type="number" min={1} value={form.rank} onChange={set("rank")} />}</FormField>
      </div>
      <FormField label={t("mention")} hint={t("mentionHint")} error={errors.mentionCode ?? null} className="md:max-w-xs">{(c) => <TextControl {...c} value={form.mention} onChange={set("mention")} maxLength={40} />}</FormField>
      <button type="button" className={buttonClass.primary} disabled={save.isPending} onClick={() => void submit()}>{t("submit")}</button>
      {save.isError && Object.keys(errors).length === 0 ? <ErrorBlock error={save.error} /> : null}
      {save.data ? <BatchReport summary={t("report", { saved: save.data.saved })} failures={save.data.failed.map((f) => ({ id: f.candidateId, message: f.message, code: f.code }))} /> : null}
    </section>
  );
}

function ResultsTab({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.results.list");
  const labels = useExamLabels();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const list = useExamResults(session.id, { ...(code ? { resultCode: code } : {}), ...(status ? { status: status as "DRAFT" } : {}), page, pageSize: 50 });
  const publish = usePublishResult();
  const columns: DataTableColumn<ExamResultDto>[] = [
    { id: "number", header: t("columns.number"), rowHeader: true, cell: (r) => r.candidateNumber ?? "—" },
    { id: "name", header: t("columns.name"), cell: (r) => r.displayName ?? "—" },
    { id: "code", header: t("columns.code"), cell: (r) => <StatusPill label={labels.resultCode(r.resultCode)} tone={outcomeTone(r.resultCode)} /> },
    { id: "average", header: t("columns.average"), cell: (r) => showDecimal(r.average), align: "right", className: "hidden sm:table-cell" },
    { id: "rank", header: t("columns.rank"), cell: (r) => r.rank ?? "—", align: "right", className: "hidden md:table-cell" },
    { id: "mention", header: t("columns.mention"), cell: (r) => r.mentionCode ?? "—", className: "hidden md:table-cell" },
    { id: "source", header: t("columns.source"), cell: (r) => labels.source(`result_${r.source}`), className: "hidden lg:table-cell" },
    {
      id: "status",
      header: t("columns.status"),
      cell: (r) =>
        r.status === "PUBLISHED" ? (
          <StatusPill label={t("published")} tone="success" />
        ) : (
          <span className="flex items-center gap-2">
            <StatusPill label={t("draft")} tone="neutral" />
            <Can permission="exam.result.publish">
              <button type="button" className={buttonClass.ghost} disabled={publish.isPending} aria-label={t("publishAria", { name: r.displayName ?? r.candidateNumber ?? "" })} onClick={() => publish.mutate(r.id)}>{t("publish")}</button>
            </Can>
          </span>
        ),
    },
  ];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("filters.code")}>{(c) => <NativeSelect {...c} value={code} placeholder={t("filters.all")} options={RESULT_CODES.map((r) => ({ value: r, label: labels.resultCode(r) }))} onChange={(v) => { setCode(v); setPage(1); }} />}</FormField>
        <FormField label={t("filters.status")}>{(c) => <NativeSelect {...c} value={status} placeholder={t("filters.all")} options={[{ value: "DRAFT", label: t("draft") }, { value: "PUBLISHED", label: t("published") }]} onChange={(v) => { setStatus(v); setPage(1); }} />}</FormField>
      </div>
      {publish.isError ? <ErrorBlock error={publish.error} /> : null}
      <DataTable caption={t("caption")} columns={columns} rows={list.data?.items ?? []} getRowId={(r) => r.id} isLoading={list.isPending} error={list.error} onRetry={() => void list.refetch()} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} pagination={{ page, pageSize: 50, total: list.data?.total ?? 0, onPageChange: setPage }} />
      <p className="text-xs text-muted-foreground">{t("revisionHint")} <Link className="underline" href={`/v2/examinations/corrections?session=${session.id}`}>{t("revisionLink")}</Link></p>
    </div>
  );
}

function ScoresLoader({ session }: { session: ExamSessionDetailDto }) {
  const matrix = useScoreMatrix(session.id);
  if (matrix.isPending) return <LoadingBlock />;
  if (matrix.isError) return <ErrorBlock error={matrix.error} onRetry={() => void matrix.refetch()} />;
  return <ScoresTab session={session} matrix={matrix.data} />;
}

function Panel({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.results");
  const [tab, setTab] = useState<"scores" | "results">("results");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t("tabs.label")} className="flex gap-2">
        {(["results", "scores"] as const).map((k) => (
          <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} className={tab === k ? buttonClass.primary : buttonClass.secondary} onClick={() => setTab(k)}>
            {t(`tabs.${k}` as never)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-4">
        {tab === "results" ? (
          <>
            <Can permission="exam.result.enter"><EnterResult session={session} /></Can>
            <ResultsTab session={session} />
          </>
        ) : <ScoresLoader session={session} />}
      </div>
    </div>
  );
}

/** Notes par épreuve et résultats : saisis ou importés de l'autorité, JAMAIS calculés pour un examen officiel. */
export function ResultsScreen() {
  const t = useTranslations("v2Examinations.results");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SessionScope>{(session) => <Panel session={session} />}</SessionScope>
    </div>
  );
}
