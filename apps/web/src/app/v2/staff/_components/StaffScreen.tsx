"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PEOPLE_STAFF_STATUSES, type PeopleStaffSummaryDto } from "@ecoledigitale/contracts/v2/people";
import { useAcademicYears } from "@/platform/v2/academic";
import { useExpiringQualifications, useStaffCategories, useStaffList } from "@/platform/v2/people";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn, type SortState } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { useDebounced } from "@/platform/ui/useDebounced";

const PAGE_SIZES = [20, 50, 100] as const;

export function staffTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "ON_LEAVE" || status === "SUSPENDED") return "warning";
  return status === "LEFT" ? "neutral" : "danger";
}

export function StaffScreen() {
  const t = useTranslations("v2Staff.list");
  const tStatus = useTranslations("v2Staff.status");
  const categories = useStaffCategories();
  const years = useAcademicYears();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [filters, setFilters] = useState({ categoryCode: "", status: "", canTeach: "", academicYearId: "" });
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const setFilter = (k: keyof typeof filters) => (v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const list = useStaffList({
    q: q || undefined,
    categoryCode: filters.categoryCode || undefined,
    status: (filters.status || undefined) as PeopleStaffSummaryDto["status"] | undefined,
    canTeach: filters.canTeach === "" ? undefined : filters.canTeach === "yes",
    // Le tri par charge s'appuie sur les affectations d'UNE année : l'API l'exige.
    sort: sort?.id === "load" ? "load" : "name",
    academicYearId: filters.academicYearId || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const categoryLabel = (code: string) => (categories.data ?? []).find((c) => c.code === code)?.label ?? code;
  const sortByLoad = sort?.id === "load";

  const columns: DataTableColumn<PeopleStaffSummaryDto>[] = [
    { id: "name", header: t("columns.name"), headerLabel: t("columns.name"), sortable: true, rowHeader: true, cell: (s) => (<Link href={`/v2/staff/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{s.displayName}</Link>) },
    { id: "number", header: t("columns.number"), cell: (s) => s.staffNumber, className: "hidden sm:table-cell" },
    { id: "category", header: t("columns.category"), cell: (s) => categoryLabel(s.categoryCode) },
    { id: "jobTitle", header: t("columns.jobTitle"), cell: (s) => s.jobTitle ?? "—", className: "hidden md:table-cell" },
    { id: "load", header: t("columns.load"), headerLabel: t("columns.load"), sortable: true, align: "right", cell: (s) => (s.plannedHours === null ? "—" : t("hours", { value: s.plannedHours })), className: "hidden sm:table-cell" },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusBadge label={tStatus(s.status)} tone={staffTone(s.status)} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Can permission="teaching.read">
              <Link href="/v2/staff/assignments" className={buttonClass.secondary}>
                {t("assignments")}
              </Link>
            </Can>
            <Can permission="staff.create">
              <Link href="/v2/staff/new" className={buttonClass.primary}>
                {t("new")}
              </Link>
            </Can>
          </>
        }
      />
      <ExpiringQualifications />
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("search")} className="sm:col-span-2">
          {(c) => <TextControl {...c} type="search" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t("searchPlaceholder")} maxLength={120} />}
        </FormField>
        <FormField label={t("filterCategory")}>
          {(c) => <NativeSelect {...c} value={filters.categoryCode} onChange={setFilter("categoryCode")} placeholder={t("all")} options={(categories.data ?? []).filter((x) => x.active).map((x) => ({ value: x.code, label: x.label }))} />}
        </FormField>
        <FormField label={t("filterStatus")}>
          {(c) => <NativeSelect {...c} value={filters.status} onChange={setFilter("status")} placeholder={t("all")} options={PEOPLE_STAFF_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("filterTeaching")}>
          {(c) => <NativeSelect {...c} value={filters.canTeach} onChange={setFilter("canTeach")} placeholder={t("all")} options={[{ value: "yes", label: t("teachingYes") }, { value: "no", label: t("teachingNo") }]} />}
        </FormField>
        <FormField label={t("filterYear")} hint={sortByLoad ? t("yearForLoad") : undefined}>
          {(c) => <NativeSelect {...c} value={filters.academicYearId} onChange={setFilter("academicYearId")} placeholder={t("allYears")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
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
        sort={sort ?? { id: "name", direction: "asc" }}
        // L'API ne propose que des tris croissants (nom, charge) : la direction demandée est ramenée à « croissant ».
        onSortChange={(next) => { setSort(next ? { id: next.id, direction: "asc" } : null); setPage(1); }}
        pagination={list.data ? { page, pageSize, total: list.data.total, onPageChange: setPage, pageSizeOptions: PAGE_SIZES, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } } : undefined}
      />
    </div>
  );
}

/** Qualifications qui expirent bientôt (alerte d'expiration) : visible des seuls utilisateurs autorisés à les lire. */
function ExpiringQualifications() {
  const t = useTranslations("v2Staff.expiring");
  const date = useDateFormat();
  const q = useExpiringQualifications();
  if (!q.data || q.data.length === 0) return null;
  return (
    <section aria-labelledby="expiring-title" className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
      <h2 id="expiring-title" className="mb-2 text-base font-semibold text-amber-300">
        {t("title", { count: q.data.length })}
      </h2>
      <ul className="divide-y divide-amber-400/20 text-sm">
        {q.data.map((e) => (
          <li key={e.qualificationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Link href={`/v2/staff/${e.staffId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {e.label}
            </Link>
            <span>{t("expiresOn", { date: date.civil(e.expiresOn) })}</span>
            <StatusBadge label={e.daysLeft < 0 ? t("expired") : t("daysLeft", { count: e.daysLeft })} tone={e.daysLeft < 0 ? "danger" : "warning"} />
          </li>
        ))}
      </ul>
    </section>
  );
}
