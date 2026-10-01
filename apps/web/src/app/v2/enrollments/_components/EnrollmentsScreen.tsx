"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ACADEMIC_ENROLLMENT_MODES, ACADEMIC_ENROLLMENT_STATUSES, ACADEMIC_FUNDING_CODES, type AcademicEnrollmentDto } from "@ecoledigitale/contracts/v2/academic";
import { useAcademicYears, useEnrollments } from "@/platform/v2/academic";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ClassroomLabel, enrollmentTone, StudentLabel } from "./labels";

const PAGE_SIZES = [20, 50, 100] as const;

export function EnrollmentsScreen() {
  const t = useTranslations("v2Enrollments.list");
  const tStatus = useTranslations("v2Enrollments.status");
  const tFunding = useTranslations("v2Enrollments.funding");
  const tMode = useTranslations("v2Enrollments.mode");
  const years = useAcademicYears();
  const date = useDateFormat();
  const [filters, setFilters] = useState({ academicYearId: "", status: "", fundingType: "", mode: "", registrationNumber: "" });
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const setFilter = (k: keyof typeof filters) => (v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const list = useEnrollments({
    academicYearId: filters.academicYearId || undefined,
    classroomId: classroom?.value,
    status: filters.status || undefined,
    fundingType: filters.fundingType || undefined,
    mode: filters.mode || undefined,
    registrationNumber: filters.registrationNumber.trim() || undefined,
    page,
    pageSize,
  });

  const useClassOptions = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { academicYearId: filters.academicYearId || undefined });

  const columns: DataTableColumn<AcademicEnrollmentDto>[] = [
    { id: "student", header: t("columns.student"), rowHeader: true, cell: (e) => <StudentLabel studentId={e.studentId} /> },
    { id: "classroom", header: t("columns.classroom"), cell: (e) => <ClassroomLabel classroomId={e.classroomId} /> },
    { id: "registration", header: t("columns.registration"), cell: (e) => e.registrationNumber ?? "—", className: "hidden md:table-cell" },
    { id: "enrolledOn", header: t("columns.enrolledOn"), cell: (e) => date.civil(e.enrolledOn), className: "hidden lg:table-cell" },
    { id: "funding", header: t("columns.funding"), cell: (e) => (ACADEMIC_FUNDING_CODES as readonly string[]).includes(e.fundingType) ? tFunding(e.fundingType) : e.fundingType, className: "hidden sm:table-cell" },
    { id: "mode", header: t("columns.mode"), cell: (e) => tMode(e.mode), className: "hidden xl:table-cell" },
    { id: "status", header: t("columns.status"), cell: (e) => <StatusBadge label={tStatus(e.status)} tone={enrollmentTone(e.status)} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (e) => (
        <Link href={`/v2/enrollments/${e.id}`} className={buttonClass.ghost} aria-label={t("open", { id: e.registrationNumber ?? e.id.slice(0, 8) })}>
          {t("see")}
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="enrollment.create">
            <Link href="/v2/enrollments/new" className={buttonClass.primary}>
              {t("new")}
            </Link>
          </Can>
        }
      />
      <div role="search" aria-label={t("filters")} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label={t("filterYear")}>
          {(c) => <NativeSelect {...c} value={filters.academicYearId} onChange={(v) => { setFilter("academicYearId")(v); setClassroom(null); }} placeholder={t("all")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
        <FormField label={t("filterClassroom")}>
          {(c) => <SelectAsync {...c} value={classroom} onChange={(o) => { setClassroom(o); setPage(1); }} useOptions={useClassOptions} placeholder={t("allClassrooms")} ariaLabel={t("filterClassroom")} />}
        </FormField>
        <FormField label={t("filterStatus")}>
          {(c) => <NativeSelect {...c} value={filters.status} onChange={setFilter("status")} placeholder={t("all")} options={ACADEMIC_ENROLLMENT_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("filterFunding")}>
          {(c) => <NativeSelect {...c} value={filters.fundingType} onChange={setFilter("fundingType")} placeholder={t("all")} options={ACADEMIC_FUNDING_CODES.map((s) => ({ value: s, label: tFunding(s) }))} />}
        </FormField>
        <FormField label={t("filterMode")}>
          {(c) => <NativeSelect {...c} value={filters.mode} onChange={setFilter("mode")} placeholder={t("all")} options={ACADEMIC_ENROLLMENT_MODES.map((s) => ({ value: s, label: tMode(s) }))} />}
        </FormField>
        <FormField label={t("filterRegistration")}>
          {(c) => <TextControl {...c} type="search" value={filters.registrationNumber} onChange={setFilter("registrationNumber")} maxLength={80} />}
        </FormField>
      </div>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(e) => e.id}
        isLoading={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={list.data ? { page, pageSize, total: list.data.total, onPageChange: setPage, pageSizeOptions: PAGE_SIZES, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } } : undefined}
      />
    </div>
  );
}
