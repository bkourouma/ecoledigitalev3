"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ExamCandidateDto, ExamSessionDetailDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { useDebounced } from "@/platform/ui/useDebounced";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { useCandidatesFromClassroom, useEvaluateAll, useExamCandidates, useRegisterBatch } from "@/platform/v2/examinations";
import { BatchReport, eligibilityTone, outcomeTone, registrationTone, SessionScope, StatusPill, useExamLabels } from "./shared";

const REGISTRATIONS = ["DRAFT", "PRE_REGISTERED", "REGISTERED", "WITHDRAWN"] as const;
const ELIGIBILITIES = ["NOT_EVALUATED", "ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"] as const;

function Panel({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.candidates");
  const labels = useExamLabels();
  const [registration, setRegistration] = useState("");
  const [eligibility, setEligibility] = useState("");
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 300);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const list = useExamCandidates(session.id, { ...(registration ? { registrationStatus: registration } : {}), ...(eligibility ? { eligibilityStatus: eligibility } : {}), ...(debounced.trim() ? { q: debounced.trim() } : {}), page, pageSize: 50 });
  const fromClassroom = useCandidatesFromClassroom(session.id);
  const evaluateAll = useEvaluateAll(session.id);
  const registerBatch = useRegisterBatch(session.id);

  const rows = list.data?.items ?? [];
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const columns: DataTableColumn<ExamCandidateDto>[] = [
    {
      id: "select",
      header: <span className="sr-only">{t("columns.select")}</span>,
      cell: (c) => <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={t("selectOne", { name: c.displayName ?? c.studentId })} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />,
    },
    { id: "name", header: t("columns.name"), rowHeader: true, cell: (c) => <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/v2/examinations/candidates/${c.id}`}>{c.displayName ?? c.studentId}</Link> },
    { id: "number", header: t("columns.number"), cell: (c) => c.candidateNumber ?? "—", className: "hidden sm:table-cell" },
    { id: "track", header: t("columns.track"), cell: (c) => c.trackCode ?? "—", className: "hidden md:table-cell" },
    { id: "registration", header: t("columns.registration"), cell: (c) => <StatusPill label={labels.registration(c.registrationStatus)} tone={registrationTone(c.registrationStatus)} /> },
    { id: "eligibility", header: t("columns.eligibility"), cell: (c) => <StatusPill label={labels.eligibility(c.eligibilityStatus)} tone={eligibilityTone(c.eligibilityStatus)} />, className: "hidden sm:table-cell" },
    { id: "pieces", header: t("columns.pieces"), cell: (c) => (c.missingPieces.length === 0 ? t("complete") : t("missingPieces", { count: c.missingPieces.length })), className: "hidden md:table-cell" },
    { id: "outcome", header: t("columns.outcome"), cell: (c) => <StatusPill label={labels.outcome(c.outcome)} tone={outcomeTone(c.outcome)} />, className: "hidden lg:table-cell" },
  ];

  async function addClassroom() {
    if (!classroom) return;
    try {
      await fromClassroom.mutateAsync({ classroomId: classroom.value });
    } catch {
      /* erreur affichée */
    }
  }

  return (
    <div className="space-y-4">
      <Can permission="exam.candidate.manage">
        <section aria-labelledby="add-title" className="space-y-3 rounded-md border p-4">
          <h2 id="add-title" className="text-base font-semibold">{t("add.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("add.hint")}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FormField label={t("add.classroom")} className="sm:w-80">
              {(c) => <SelectAsync {...c} value={classroom} onChange={setClassroom} useOptions={useClassroomOptions} placeholder={t("add.choose")} />}
            </FormField>
            <button type="button" className={buttonClass.primary} disabled={!classroom || fromClassroom.isPending} onClick={() => void addClassroom()}>{t("add.submit")}</button>
          </div>
          {fromClassroom.isError ? <ErrorBlock error={fromClassroom.error} /> : null}
          {fromClassroom.data ? <BatchReport summary={t("add.report", { created: fromClassroom.data.created, skipped: fromClassroom.data.skipped.length })} failures={fromClassroom.data.failed.map((f) => ({ id: f.studentId, message: f.message, code: f.code }))} /> : null}
        </section>
      </Can>

      <div className="flex flex-wrap gap-2">
        <Can permission="exam.eligibility.evaluate">
          <button type="button" className={buttonClass.secondary} disabled={evaluateAll.isPending} onClick={() => evaluateAll.mutate()}>{t("evaluateAll")}</button>
        </Can>
        <Can permission="exam.candidate.manage">
          <button type="button" className={buttonClass.secondary} disabled={selected.size === 0 || registerBatch.isPending} onClick={() => registerBatch.mutate({ candidateIds: [...selected] }, { onSuccess: () => setSelected(new Set()) })}>
            {t("registerSelected", { count: selected.size })}
          </button>
        </Can>
        <button type="button" className={buttonClass.ghost} onClick={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} disabled={rows.length === 0}>
          {allOnPage ? t("unselectPage") : t("selectPage")}
        </button>
      </div>
      {evaluateAll.isError ? <ErrorBlock error={evaluateAll.error} /> : null}
      {evaluateAll.data ? <BatchReport summary={t("evaluateReport", { count: evaluateAll.data.evaluated })} failures={evaluateAll.data.failed.map((f) => ({ id: f.candidateId, message: f.message, code: f.code }))} /> : null}
      {registerBatch.isError ? <ErrorBlock error={registerBatch.error} /> : null}
      {registerBatch.data ? <BatchReport summary={t("registerReport", { count: registerBatch.data.registered.length })} failures={registerBatch.data.failed.map((f) => ({ id: f.candidateId, message: f.message, code: f.code }))} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("filters.search")}>{(c) => <TextControl {...c} type="search" value={q} onChange={(v) => { setQ(v); setPage(1); }} />}</FormField>
        <FormField label={t("filters.registration")}>{(c) => <NativeSelect {...c} value={registration} placeholder={t("filters.all")} options={REGISTRATIONS.map((s) => ({ value: s, label: labels.registration(s) }))} onChange={(v) => { setRegistration(v); setPage(1); }} />}</FormField>
        <FormField label={t("filters.eligibility")}>{(c) => <NativeSelect {...c} value={eligibility} placeholder={t("filters.all")} options={ELIGIBILITIES.map((s) => ({ value: s, label: labels.eligibility(s) }))} onChange={(v) => { setEligibility(v); setPage(1); }} />}</FormField>
      </div>
      {session.demoRules ? <Notice kind="info">{t("demoNote")}</Notice> : null}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={rows}
        getRowId={(c) => c.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={{ page, pageSize: 50, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
    </div>
  );
}

/** Candidats d'une session : ce sont les ÉLÈVES de l'établissement (aucun candidat libre) ; l'éligibilité vient de la règle. */
export function CandidatesScreen() {
  const t = useTranslations("v2Examinations.candidates");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SessionScope>{(session) => <Panel session={session} />}</SessionScope>
    </div>
  );
}
