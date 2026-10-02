"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { schedulingTimetableBodySchema, type schedulingTimetableDtoSchema } from "@ecoledigitale/contracts/v2/scheduling";
import { useAcademicYears } from "@/platform/v2/academic";
import { useInstitutions } from "@/platform/v2/lookups";
import { useCreateTimetable, useTimetables } from "@/platform/v2/scheduling";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

type Timetable = z.infer<typeof schedulingTimetableDtoSchema>;

export const timetableTone = (s: string) => (s === "PUBLISHED" ? "success" : s === "DRAFT" ? "info" : "neutral") as "success" | "info" | "neutral";

/** Emplois du temps (patrons récurrents) : brouillons, publiés, archivés. */
export function TimetablesScreen() {
  const t = useTranslations("v2Schedule.timetables");
  const date = useDateFormat();
  const flash = useFlash();
  const [status, setStatus] = useState("");
  const list = useTimetables({ status: (status || undefined) as Timetable["status"] | undefined });
  const [creating, setCreating] = useState(false);

  const columns: DataTableColumn<Timetable>[] = [
    {
      id: "name",
      header: t("columns.name"),
      rowHeader: true,
      cell: (x) => (
        <Link href={`/v2/schedule/timetables/${x.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {x.name}
        </Link>
      ),
    },
    { id: "validity", header: t("columns.validity"), cell: (x) => t("validityValue", { from: date.civil(x.validFrom), to: date.civil(x.validTo) }), className: "hidden sm:table-cell" },
    { id: "pattern", header: t("columns.abAnchor"), cell: (x) => (x.weekAAnchor ? date.civil(x.weekAAnchor) : "—"), className: "hidden lg:table-cell" },
    { id: "published", header: t("columns.published"), cell: (x) => (x.publishedAt ? date.instant(x.publishedAt) : "—"), className: "hidden md:table-cell" },
    { id: "status", header: t("columns.status"), cell: (x) => <StatusBadge label={t(`status.${x.status}`)} tone={timetableTone(x.status)} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="schedule.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create")}
            </button>
          </Can>
        }
      />
      {flash.node}
      <div className="max-w-xs">
        <FormField label={t("statusFilter")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("all")} options={(["DRAFT", "PUBLISHED", "ARCHIVED"] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))} />}
        </FormField>
      </div>
      <DataTable caption={t("caption")} columns={columns} rows={list.data ?? []} getRowId={(x) => x.id} isLoading={list.isFetching} error={list.error} onRetry={() => void list.refetch()} emptyTitle={t("empty")} emptyDescription={t("emptyHint")} />
      {creating ? <CreateDialog onClose={() => setCreating(false)} onDone={() => flash.show(t("created"))} /> : null}
    </div>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Schedule.timetables.form");
  const create = useCreateTimetable();
  const institutions = useInstitutions();
  const years = useAcademicYears();
  const [yearId, setYearId] = useState("");
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [anchor, setAnchor] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const api = apiErrorToFieldErrors(create.error);
  const year = (years.data ?? []).find((y) => y.id === (yearId || years.data?.find((x) => x.isCurrent)?.id || years.data?.[0]?.id));

  function submit() {
    const institutionId = year?.institutionId ?? institutions.data?.[0]?.id ?? "";
    const body = { institutionId, academicYearId: year?.id ?? "", name: name.trim(), validFrom: from || year?.startsOn || "", validTo: to || year?.endsOn || "", ...(anchor ? { weekAAnchor: anchor } : {}) };
    const r = validateWith(schedulingTimetableBodySchema, body);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    create.mutate(r.data as never, {
      onSuccess: () => {
        onClose();
        onDone();
      },
    });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={Object.keys(api).length ? undefined : create.error}>
      <FormField label={t("year")} required error={errors.academicYearId ?? api.academicYearId}>
        {(c) => <NativeSelect {...c} value={year?.id ?? ""} onChange={setYearId} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
      </FormField>
      <FormField label={t("name")} required error={errors.name ?? api.name}>
        {(c) => <TextControl {...c} value={name} onChange={setName} maxLength={200} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("validFrom")} hint={t("defaultYear")} error={errors.validFrom ?? api.validFrom}>
          {(c) => <TextControl {...c} type="date" value={from || year?.startsOn || ""} onChange={setFrom} />}
        </FormField>
        <FormField label={t("validTo")} error={errors.validTo ?? api.validTo}>
          {(c) => <TextControl {...c} type="date" value={to || year?.endsOn || ""} onChange={setTo} />}
        </FormField>
      </div>
      <FormField label={t("anchor")} hint={t("anchorHint")} error={errors.weekAAnchor ?? api.weekAAnchor}>
        {(c) => <TextControl {...c} type="date" value={anchor} onChange={setAnchor} />}
      </FormField>
    </FormDialog>
  );
}
