"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ACADEMIC_SUBJECT_STATUSES, academicCreateSubjectBodySchema, academicUpdateSubjectBodySchema, type AcademicSubjectDto } from "@ecoledigitale/contracts/v2/academic";
import { useCreateSubject, useSubjects, useUpdateSubject } from "@/platform/v2/academic";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { toneOf } from "./shared";

/**
 * Catalogue des matières de l'établissement : création, modification, désactivation. Jusqu'ici le catalogue ne se remplissait
 * que par l'import « Matières et curriculum » (L-10). Une matière désactivée n'est plus proposée dans le curriculum.
 */
export function SubjectsScreen() {
  const t = useTranslations("v2Academic.subjects");
  const subjects = useSubjects();
  const flash = useFlash();
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; subject: AcademicSubjectDto } | null>(null);

  const columns: DataTableColumn<AcademicSubjectDto>[] = [
    { id: "code", header: t("columns.code"), rowHeader: true, cell: (s) => s.code },
    { id: "label", header: t("columns.label"), cell: (s) => s.label },
    { id: "domain", header: t("columns.domain"), cell: (s) => s.domainCode ?? "—", className: "hidden md:table-cell" },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusBadge label={t(`status.${s.status}`)} tone={toneOf(s.status)} /> },
    {
      id: "actions",
      header: t("columns.actions"),
      align: "right",
      cell: (s) => (
        <Can permission="curriculum.manage">
          <button type="button" className={buttonClass.ghost} onClick={() => setDialog({ mode: "edit", subject: s })}>
            {t("edit")}
          </button>
        </Can>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="curriculum.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setDialog({ mode: "create" })}>
              {t("create")}
            </button>
          </Can>
        }
      />
      {flash.node}
      <DataTable caption={t("caption")} columns={columns} rows={subjects.data ?? []} getRowId={(s) => s.id} isLoading={subjects.isFetching} error={subjects.error} onRetry={() => void subjects.refetch()} emptyTitle={t("empty")} />
      {dialog ? <SubjectDialog subject={dialog.mode === "edit" ? dialog.subject : null} onClose={() => setDialog(null)} onDone={(m) => flash.show(m)} /> : null}
    </div>
  );
}

function SubjectDialog({ subject, onClose, onDone }: { subject: AcademicSubjectDto | null; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Academic.subjects");
  const create = useCreateSubject();
  const update = useUpdateSubject();
  const mutation = subject ? update : create;
  const [form, setForm] = useState({ code: subject?.code ?? "", label: subject?.label ?? "", shortLabel: subject?.shortLabel ?? "", domainCode: subject?.domainCode ?? "", description: subject?.description ?? "", status: subject?.status ?? "ACTIVE" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(mutation.error), ...errors };
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    if (subject) {
      const body = { label: form.label.trim(), shortLabel: form.shortLabel.trim() || null, domainCode: form.domainCode.trim() || null, description: form.description.trim() || null, status: form.status as AcademicSubjectDto["status"] };
      const v = validateWith(academicUpdateSubjectBodySchema, body);
      if (!v.ok) return setErrors(v.errors);
      setErrors({});
      update.mutate({ id: subject.id, patch: v.data }, { onSuccess: () => { onClose(); onDone(t("updated")); } });
      return;
    }
    const body = { code: form.code.trim(), label: form.label.trim(), ...compact({ shortLabel: form.shortLabel.trim(), domainCode: form.domainCode.trim(), description: form.description.trim() }) };
    const v = validateWith(academicCreateSubjectBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    create.mutate(v.data, { onSuccess: () => { onClose(); onDone(t("created")); } });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={subject ? t("editTitle") : t("createTitle")} submitLabel={t("save")} onSubmit={submit} isPending={mutation.isPending} error={Object.keys(apiErrorToFieldErrors(mutation.error)).length ? undefined : mutation.error}>
      <FormField label={t("fields.code")} required hint={t("fields.codeHint")} error={shown.code}>
        {(c) => <TextControl {...c} value={form.code} onChange={set("code")} disabled={!!subject} maxLength={40} />}
      </FormField>
      <FormField label={t("fields.label")} required error={shown.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={160} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("fields.shortLabel")} error={shown.shortLabel}>
          {(c) => <TextControl {...c} value={form.shortLabel} onChange={set("shortLabel")} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.domainCode")} hint={t("fields.domainHint")} error={shown.domainCode}>
          {(c) => <TextControl {...c} value={form.domainCode} onChange={set("domainCode")} maxLength={40} />}
        </FormField>
      </div>
      <FormField label={t("fields.description")} error={shown.description}>
        {(c) => <TextAreaControl {...c} value={form.description} onChange={set("description")} maxLength={1000} />}
      </FormField>
      {subject ? (
        <FormField label={t("fields.status")} hint={t("fields.statusHint")}>
          {(c) => <NativeSelect {...c} value={form.status} onChange={set("status")} options={ACADEMIC_SUBJECT_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />}
        </FormField>
      ) : null}
    </FormDialog>
  );
}
