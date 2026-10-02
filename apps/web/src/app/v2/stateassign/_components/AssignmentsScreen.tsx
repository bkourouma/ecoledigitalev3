"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ASSIGNMENT_STATUSES, type AssignmentDto, type RecordAssignmentBody } from "@ecoledigitale/contracts/v2/stateassign";
import { usePermission } from "@/platform/access";
import { useEnrollments } from "@/platform/v2/academic";
import { useStudentOptions } from "@/platform/v2/lookups";
import { useAssignments, useRecordAssignment } from "@/platform/v2/stateassign";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { useMoney, parseAmountInput } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { Notice } from "@/platform/ui/states";
import { useDebounced } from "@/platform/ui/useDebounced";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { ASSIGNMENT_TONE, PERM, RECONCILIATION_TONE, ScopeFilters, isIsoDate, scopeQuery, type Scope } from "./stateassign-utils";

/** Enregistrer un dossier d'affectation (statut RECEIVED) : l'inscription, la référence de l'acte, les montants DÉCLARÉS (entiers). */
function RecordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("v2Stateassign.record");
  const router = useRouter();
  const mutation = useRecordAssignment();
  const [student, setStudent] = useState<SelectOption | null>(null);
  const [enrollmentId, setEnrollmentId] = useState("");
  const [reference, setReference] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [authority, setAuthority] = useState("");
  const [stateAmount, setStateAmount] = useState("");
  const [parentAmount, setParentAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const enrollments = useEnrollments(student ? { studentId: student.value, pageSize: 50 } : {});
  const apiErrors = apiErrorToFieldErrors(mutation.error);

  const amount = (text: string) => (text.trim() === "" ? { ok: true as const, amount: null } : parseAmountInput(text, { allowZero: true }));
  const state = amount(stateAmount);
  const parent = amount(parentAmount);
  const problems = {
    enrollment: enrollmentId ? null : t("errors.enrollment"),
    reference: reference.trim() ? null : t("errors.reference"),
    issuedOn: issuedOn && !isIsoDate(issuedOn) ? t("errors.date") : null,
    state: state.ok ? null : t("errors.amount"),
    parent: parent.ok ? null : t("errors.amount"),
  };
  const invalid = Object.values(problems).some(Boolean);

  function submit(): void {
    setSubmitted(true);
    if (invalid || !state.ok || !parent.ok) return;
    const body: RecordAssignmentBody = {
      enrollmentId,
      reference: reference.trim(),
      ...(issuedOn ? { issuedOn } : {}),
      ...(authority.trim() ? { issuingAuthority: authority.trim() } : {}),
      ...(state.amount !== null ? { declaredStateAmount: state.amount } : {}),
      ...(parent.amount !== null ? { declaredParentAmount: parent.amount } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    mutation.mutate(body, { onSuccess: (dto) => router.push(`/v2/stateassign/${dto.id}`) });
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={mutation.isPending} error={mutation.isError && Object.keys(apiErrors).length === 0 ? mutation.error : undefined} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("student")} required className="sm:col-span-2">
          {(c) => <SelectAsync {...c} value={student} onChange={(s) => { setStudent(s); setEnrollmentId(""); }} useOptions={useStudentOptions} placeholder={t("studentPlaceholder")} ariaLabel={t("student")} />}
        </FormField>
        <FormField label={t("enrollment")} required error={submitted ? problems.enrollment : (apiErrors.enrollmentId ?? null)} className="sm:col-span-2" hint={student ? undefined : t("enrollmentHint")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={enrollmentId}
              onChange={setEnrollmentId}
              disabled={!student}
              placeholder={t("choose")}
              options={(enrollments.data?.items ?? []).map((e) => ({ value: e.id, label: `${e.registrationNumber ?? e.id.slice(0, 8)} · ${e.status} · ${e.fundingType}` }))}
            />
          )}
        </FormField>
        <FormField label={t("reference")} required error={submitted ? problems.reference : (apiErrors.reference ?? null)}>
          {(c) => <TextControl {...c} value={reference} onChange={setReference} maxLength={120} />}
        </FormField>
        <FormField label={t("issuedOn")} hint={t("dateHint")} error={submitted ? problems.issuedOn : (apiErrors.issuedOn ?? null)}>
          {(c) => <TextControl {...c} type="date" value={issuedOn} onChange={setIssuedOn} />}
        </FormField>
        <FormField label={t("authority")} className="sm:col-span-2" hint={t("authorityHint")}>
          {(c) => <TextControl {...c} value={authority} onChange={setAuthority} maxLength={200} />}
        </FormField>
        <FormField label={t("stateAmount")} hint={t("amountHint")} error={submitted ? problems.state : (apiErrors.declaredStateAmount ?? null)}>
          {(c) => <TextControl {...c} inputMode="numeric" value={stateAmount} onChange={setStateAmount} />}
        </FormField>
        <FormField label={t("parentAmount")} hint={t("amountHint")} error={submitted ? problems.parent : (apiErrors.declaredParentAmount ?? null)}>
          {(c) => <TextControl {...c} inputMode="numeric" value={parentAmount} onChange={setParentAmount} />}
        </FormField>
        <FormField label={t("notes")} className="sm:col-span-2">
          {(c) => <TextAreaControl {...c} value={notes} onChange={setNotes} maxLength={2000} />}
        </FormField>
      </div>
      <Notice kind="info">{t("humanNote")}</Notice>
    </FormDialog>
  );
}

/** Liste des dossiers d'affectation : filtres (établissement, année, statut, recherche de référence), pagination serveur. */
export function AssignmentsScreen() {
  const t = useTranslations("v2Stateassign.list");
  const tStatus = useTranslations("v2Stateassign.status");
  const tRecon = useTranslations("v2Stateassign.reconciliation");
  const money = useMoney();
  const canRecord = usePermission(PERM.record).allowed;
  const [scope, setScope] = useState<Scope>({ institutionId: "", academicYearId: "" });
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [recordOpen, setRecordOpen] = useState(false);
  const q = useDebounced(search.trim(), 300);
  const query = useAssignments({ ...scopeQuery(scope), ...(status ? { status: status as never } : {}), ...(q ? { q } : {}), includeHistory: history, page, pageSize });

  const columns = useMemo<DataTableColumn<AssignmentDto>[]>(
    () => [
      {
        id: "reference",
        header: t("columns.reference"),
        rowHeader: true,
        cell: (a) => (
          <Link href={`/v2/stateassign/${a.id}`} className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {a.reference}
            <span className="ml-1 text-xs text-muted-foreground">v{a.version}</span>
          </Link>
        ),
      },
      { id: "student", header: t("columns.student"), cell: (a) => a.studentName ?? <span className="text-muted-foreground">{t("unknownStudent")}</span> },
      { id: "status", header: t("columns.status"), cell: (a) => <StatusBadge label={tStatus(a.status)} tone={ASSIGNMENT_TONE[a.status]} /> },
      { id: "state", header: t("columns.declaredState"), align: "right", className: "hidden md:table-cell", cell: (a) => money.of(a.declaredState) },
      { id: "parent", header: t("columns.declaredParent"), align: "right", className: "hidden md:table-cell", cell: (a) => money.of(a.declaredParent) },
      { id: "recon", header: t("columns.reconciliation"), cell: (a) => <StatusBadge label={tRecon(a.reconciliation.status)} tone={RECONCILIATION_TONE[a.reconciliation.status]} /> },
    ],
    [t, tStatus, tRecon, money],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={canRecord ? <button type="button" onClick={() => setRecordOpen(true)} className={buttonClass.primary}>{t("record")}</button> : undefined}
      />
      <ScopeFilters value={scope} onChange={(s) => { setScope(s); setPage(1); }} />
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("filters.status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={(v) => { setStatus(v); setPage(1); }} placeholder={t("filters.allStatuses")} options={ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("filters.search")}>
          {(c) => <TextControl {...c} type="search" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t("filters.searchPlaceholder")} />}
        </FormField>
        <div className="flex items-end">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={history} onChange={(e) => { setHistory(e.target.checked); setPage(1); }} className="h-4 w-4" />
            {t("filters.history")}
          </label>
        </div>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(a) => a.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={{ page, pageSize, total: query.data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
      />
      {recordOpen ? <RecordDialog open={recordOpen} onOpenChange={setRecordOpen} /> : null}
    </div>
  );
}
