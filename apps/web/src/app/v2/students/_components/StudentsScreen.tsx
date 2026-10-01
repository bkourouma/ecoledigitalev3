"use client";

import Link from "next/link";
import { useState } from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { PEOPLE_STUDENT_STATUSES, type PeopleStudentSummaryDto } from "@ecoledigitale/contracts/v2/people";
import { platformHooks } from "@/platform/api/default-client";
import { useAcademicYears } from "@/platform/v2/academic";
import { useStudents } from "@/platform/v2/people";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock } from "@/platform/ui/states";
import { useDebounced } from "@/platform/ui/useDebounced";
import { enrollmentTone } from "../../enrollments/_components/labels";

const PAGE_SIZES = [20, 50, 100] as const;

export function studentTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED" || status === "INACTIVE") return "warning";
  if (status === "WITHDRAWN" || status === "EXCLUDED" || status === "TRANSFERRED_OUT") return "danger";
  return status === "GRADUATED" ? "info" : "neutral";
}

export function StudentsScreen() {
  const t = useTranslations("v2Students.list");
  const tStatus = useTranslations("v2Students.status");
  const tEnr = useTranslations("v2Enrollments.status");
  const years = useAcademicYears();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [filters, setFilters] = useState({ status: "", academicYearId: "", includeArchived: false });
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [exportError, setExportError] = useState<unknown>(null);

  const query = {
    q: q || undefined,
    status: (filters.status || undefined) as PeopleStudentSummaryDto["status"] | undefined,
    academicYearId: filters.academicYearId || undefined,
    classroomId: classroom?.value,
    includeArchived: filters.includeArchived || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
  const list = useStudents(query);
  const useClassOptions = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { academicYearId: filters.academicYearId || undefined });
  const reset = () => setPage(1);

  async function exportCsv() {
    setExportError(null);
    try {
      const csv = await platformHooks.client.get<string>("/api/v1/people/students/export", { query: { ...query, limit: undefined, offset: undefined }, responseType: "text" });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "eleves.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e);
    }
  }

  const columns: DataTableColumn<PeopleStudentSummaryDto>[] = [
    {
      id: "name",
      header: t("columns.name"),
      rowHeader: true,
      cell: (s) => (
        <Link href={`/v2/students/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {s.displayName}
        </Link>
      ),
    },
    { id: "number", header: t("columns.number"), cell: (s) => s.studentNumber, className: "hidden sm:table-cell" },
    { id: "classroom", header: t("columns.classroom"), cell: (s) => s.currentEnrollment?.classroomName ?? "—" },
    {
      id: "enrollment",
      header: t("columns.enrollment"),
      cell: (s) => (s.currentEnrollment ? <StatusBadge label={tEnr(s.currentEnrollment.status)} tone={enrollmentTone(s.currentEnrollment.status)} /> : <span className="text-muted-foreground">{t("notEnrolled")}</span>),
      className: "hidden md:table-cell",
    },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusBadge label={tStatus(s.status)} tone={studentTone(s.status)} /> },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Can permission="student.export">
              <button type="button" className={buttonClass.secondary} onClick={() => void exportCsv()}>
                <Download className="h-4 w-4" aria-hidden="true" />
                {t("export")}
              </button>
            </Can>
            <Can permission="student.create">
              <Link href="/v2/students/new" className={buttonClass.primary}>
                {t("new")}
              </Link>
            </Can>
          </>
        }
      />
      {exportError ? <div className="mb-4"><ErrorBlock error={exportError} /></div> : null}
      <div role="search" aria-label={t("filters")} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("search")} className="sm:col-span-2">
          {(c) => <TextControl {...c} type="search" value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder={t("searchPlaceholder")} maxLength={120} />}
        </FormField>
        <FormField label={t("filterStatus")}>
          {(c) => <NativeSelect {...c} value={filters.status} onChange={(v) => { setFilters((f) => ({ ...f, status: v })); reset(); }} placeholder={t("all")} options={PEOPLE_STUDENT_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("filterYear")}>
          {(c) => <NativeSelect {...c} value={filters.academicYearId} onChange={(v) => { setFilters((f) => ({ ...f, academicYearId: v })); setClassroom(null); reset(); }} placeholder={t("all")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
        <FormField label={t("filterClassroom")} className="sm:col-span-2">
          {(c) => <SelectAsync {...c} value={classroom} onChange={(o) => { setClassroom(o); reset(); }} useOptions={useClassOptions} placeholder={t("allClassrooms")} ariaLabel={t("filterClassroom")} />}
        </FormField>
        <div className="sm:col-span-2">
          <CheckControl checked={filters.includeArchived} onChange={(v) => { setFilters((f) => ({ ...f, includeArchived: v })); reset(); }} label={t("includeArchived")} />
        </div>
      </div>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(s) => s.id}
        isLoading={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={q ? t("noResults") : t("empty")}
        emptyDescription={q ? undefined : t("emptyHint")}
        pagination={list.data ? { page, pageSize, total: list.data.total, onPageChange: setPage, pageSizeOptions: PAGE_SIZES, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } } : undefined}
      />
    </div>
  );
}
