"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ADMISSION_STATUSES, type AdmissionStatus, type AdmissionsApplicationSummaryDto } from "@ecoledigitale/contracts/v2/admissions";
import { useAdmissionsLookups, useApplications } from "@/platform/v2/admissions";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { useDebounced } from "@/platform/ui/useDebounced";
import { CampaignPicker, useSelectedCampaign } from "./AdmissionsShell";
import { fullName, statusTone } from "./admissions-utils";

/** Liste filtrable des candidatures : le filtrage, la pagination et le tri sont faits par l'API. */
export function ApplicationsListScreen() {
  const t = useTranslations("v2Admissions.list");
  const tc = useTranslations("v2Admissions.common");
  const ts = useTranslations("v2Admissions.status");
  const fmt = useDateFormat();
  const { campaigns, campaignId, select } = useSelectedCampaign();
  const lookups = useAdmissionsLookups();
  const [status, setStatus] = useState("");
  const [grade, setGrade] = useState("");
  const [search, setSearch] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const q = useDebounced(search.trim(), 300);
  const list = useApplications({
    campaignId: campaignId ?? undefined,
    status: (status || undefined) as AdmissionStatus | undefined,
    grade: grade || undefined,
    q: q || undefined,
    overdue: overdue || undefined,
    page,
    pageSize,
  });

  const columns: DataTableColumn<AdmissionsApplicationSummaryDto>[] = [
    {
      id: "number",
      header: t("columns.number"),
      headerLabel: t("columns.number"),
      cell: (a) => (
        <Link href={`/v2/admissions/applications/${a.id}`} className="font-medium text-primary hover:underline">
          {a.applicationNumber}
        </Link>
      ),
    },
    { id: "name", header: t("columns.name"), headerLabel: t("columns.name"), rowHeader: true, cell: (a) => (a.anonymized ? t("anonymized") : fullName(a)) },
    { id: "grade", header: t("columns.grade"), headerLabel: t("columns.grade"), className: "hidden sm:table-cell", cell: (a) => a.desiredGradeLevelCode },
    {
      id: "stage",
      header: t("columns.stage"),
      headerLabel: t("columns.stage"),
      cell: (a) => (
        <span className="flex flex-wrap items-center gap-1">
          <span>{a.stageLabel}</span>
          <StatusBadge label={ts(a.status)} tone={statusTone(a.status)} />
          {a.overdue ? <StatusBadge label={t("overdue")} tone="danger" /> : null}
        </span>
      ),
    },
    { id: "submitted", header: t("columns.submitted"), headerLabel: t("columns.submitted"), className: "hidden md:table-cell", cell: (a) => fmt.instant(a.submittedAt) },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="admission.create">
            <Link href="/v2/admissions/applications/new" className={buttonClass.primary}>
              {t("new")}
            </Link>
          </Can>
        }
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label={t("filters")} onSubmit={(e) => e.preventDefault()}>
        <CampaignPicker
          campaigns={campaigns}
          value={campaignId}
          onChange={(id) => {
            select(id);
            setPage(1);
          }}
        />
        <FormField label={t("status")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              placeholder={t("allStatuses")}
              options={ADMISSION_STATUSES.map((s) => ({ value: s, label: ts(s) }))}
            />
          )}
        </FormField>
        <FormField label={tc("grade")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={grade}
              onChange={(v) => {
                setGrade(v);
                setPage(1);
              }}
              placeholder={tc("allGrades")}
              options={(lookups.data?.gradeLevels ?? []).map((g) => ({ value: g.code, label: g.label }))}
            />
          )}
        </FormField>
        <FormField label={t("search")}>
          {(c) => (
            <TextControl
              {...c}
              type="search"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder={t("searchPlaceholder")}
              maxLength={120}
            />
          )}
        </FormField>
        <div className="sm:col-span-2 lg:col-span-4">
          <CheckControl
            checked={overdue}
            onChange={(v) => {
              setOverdue(v);
              setPage(1);
            }}
            label={t("overdueOnly")}
          />
        </div>
      </form>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(a) => a.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        pagination={{ page, pageSize, total: list.data?.total ?? 0, onPageChange: setPage, pageSizeOptions: [30, 50, 100], onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
      />
    </div>
  );
}
