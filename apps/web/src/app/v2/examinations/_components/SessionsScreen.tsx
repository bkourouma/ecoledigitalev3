"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { examCreateSessionBodySchema, type ExamSessionDto, type ExamSessionStatus } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useDateFormat } from "@/platform/ui/format";
import { useInstitutions } from "@/platform/v2/lookups";
import { useCreateSession, useExamSessions, useExamTypes } from "@/platform/v2/examinations";
import { sessionTone, StatusPill, useExamLabels } from "./shared";

const STATUSES: readonly ExamSessionStatus[] = ["PLANNED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "IN_PROGRESS", "RESULTS_ENTERED", "PUBLISHED", "ARCHIVED"];

function CreateSessionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("v2Examinations.sessions.create");
  const labels = useExamLabels();
  const router = useRouter();
  const types = useExamTypes(open);
  const institutions = useInstitutions();
  const officials = useExamSessions({ sessionKind: "OFFICIAL", pageSize: 200 }, open);
  const create = useCreateSession();
  const [form, setForm] = useState({ examTypeId: "", institutionId: "", sessionKind: "OFFICIAL", code: "", label: "", sessionYear: String(new Date().getFullYear()), startsOn: "", mockOfSessionId: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const institutionList = institutions.data ?? [];
  const institutionId = form.institutionId || (institutionList.length === 1 ? (institutionList[0]?.id ?? "") : "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validateWith(examCreateSessionBodySchema, {
      examTypeId: form.examTypeId,
      institutionId,
      code: form.code.trim().toUpperCase(),
      label: form.label.trim(),
      sessionKind: form.sessionKind,
      sessionYear: Number(form.sessionYear),
      ...(form.startsOn ? { startsOn: form.startsOn } : {}),
      ...(form.sessionKind === "MOCK" && form.mockOfSessionId ? { mockOfSessionId: form.mockOfSessionId } : {}),
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    try {
      const s = await create.mutateAsync(parsed.data);
      onOpenChange(false);
      router.push(`/v2/examinations/sessions/${s.id}`);
    } catch (error) {
      setErrors(apiErrorToFieldErrors(error));
    }
  }

  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <FormField label={t("type")} required error={errors.examTypeId ?? null}>
          {(c) => <NativeSelect {...c} value={form.examTypeId} placeholder={t("choose")} options={(types.data ?? []).filter((x) => x.status === "ACTIVE").map((x) => ({ value: x.id, label: `${x.code} — ${x.label}` }))} onChange={set("examTypeId")} />}
        </FormField>
        {institutionList.length > 1 ? (
          <FormField label={t("institution")} required error={errors.institutionId ?? null}>
            {(c) => <NativeSelect {...c} value={form.institutionId} placeholder={t("choose")} options={institutionList.map((i) => ({ value: i.id, label: i.name }))} onChange={set("institutionId")} />}
          </FormField>
        ) : null}
        <FormField label={t("kind")} required>
          {(c) => <NativeSelect {...c} value={form.sessionKind} options={(["OFFICIAL", "MOCK"] as const).map((k) => ({ value: k, label: labels.sessionKind(k) }))} onChange={set("sessionKind")} />}
        </FormField>
        {form.sessionKind === "MOCK" ? (
          <FormField label={t("mockOf")} hint={t("mockOfHint")} error={errors.mockOfSessionId ?? null}>
            {(c) => <NativeSelect {...c} value={form.mockOfSessionId} placeholder={t("none")} options={(officials.data?.items ?? []).filter((s) => s.examTypeId === form.examTypeId).map((s) => ({ value: s.id, label: s.label }))} onChange={set("mockOfSessionId")} />}
          </FormField>
        ) : null}
        <FormField label={t("code")} required hint={t("codeHint")} error={errors.code ?? null}>
          {(c) => <TextControl {...c} value={form.code} onChange={set("code")} maxLength={40} />}
        </FormField>
        <FormField label={t("label")} required error={errors.label ?? null}>
          {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("year")} required error={errors.sessionYear ?? null}>
            {(c) => <TextControl {...c} type="number" value={form.sessionYear} onChange={set("sessionYear")} min={2000} max={2200} />}
          </FormField>
          <FormField label={t("startsOn")} hint={t("startsOnHint")} error={errors.startsOn ?? null}>
            {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
          </FormField>
        </div>
        {create.isError && Object.keys(errors).length === 0 ? <ErrorBlock error={create.error} /> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClass.secondary} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </button>
          <button type="submit" className={buttonClass.primary} disabled={create.isPending}>
            {t("submit")}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

/** Liste des sessions d'examen (officielles et blanches) avec avancement ; création réservée à la gestion de session. */
export function SessionsScreen() {
  const t = useTranslations("v2Examinations.sessions");
  const labels = useExamLabels();
  const date = useDateFormat();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useExamSessions({ ...(status ? { status: status as ExamSessionStatus } : {}), ...(kind ? { sessionKind: kind as "OFFICIAL" | "MOCK" } : {}), page, pageSize: 20 });
  const columns: DataTableColumn<ExamSessionDto>[] = [
    { id: "label", header: t("columns.label"), rowHeader: true, cell: (s) => <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/v2/examinations/sessions/${s.id}`}>{s.label}</Link> },
    { id: "type", header: t("columns.type"), cell: (s) => `${s.examTypeCode} ${s.sessionYear}`, className: "hidden sm:table-cell" },
    { id: "kind", header: t("columns.kind"), cell: (s) => labels.sessionKind(s.sessionKind) },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusPill label={labels.sessionStatus(s.status)} tone={sessionTone(s.status)} /> },
    { id: "progress", header: t("columns.progress"), cell: (s) => `${s.progress.percent} %`, className: "hidden md:table-cell" },
    { id: "startsOn", header: t("columns.startsOn"), cell: (s) => date.civil(s.startsOn), className: "hidden md:table-cell" },
    { id: "demo", header: t("columns.demo"), cell: (s) => (s.demoRules ? <StatusPill label={t("demo")} tone="warning" /> : null), className: "hidden lg:table-cell" },
  ];
  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="exam.session.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create.open")}
            </button>
          </Can>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label={t("filters.status")}>{(c) => <NativeSelect {...c} value={status} placeholder={t("filters.all")} options={STATUSES.map((s) => ({ value: s, label: labels.sessionStatus(s) }))} onChange={(v) => { setStatus(v); setPage(1); }} />}</FormField>
        <FormField label={t("filters.kind")}>{(c) => <NativeSelect {...c} value={kind} placeholder={t("filters.all")} options={(["OFFICIAL", "MOCK"] as const).map((k) => ({ value: k, label: labels.sessionKind(k) }))} onChange={(v) => { setKind(v); setPage(1); }} />}</FormField>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(s) => s.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={{ page, pageSize: 20, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
      <CreateSessionDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
