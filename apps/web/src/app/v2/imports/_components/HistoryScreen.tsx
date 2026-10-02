"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { IMPORT_JOB_STATUSES, type ImportJobDto, type ImporterKey } from "@ecoledigitale/contracts/v2/imports";
import { usePermission } from "@/platform/access";
import { buttonClass, DataTable, PageHeader, StatusBadge, useDateFormat, type DataTableColumn } from "@/platform/ui";
import { useImportJobs, useImporters } from "@/platform/v2/imports";
import { INPUT_CLASS, formatDuration, toneOf } from "./import-utils";

/** Historique des imports : un tableau lisible sur mobile (colonnes secondaires masquées), filtres par importeur et état. */
export function HistoryScreen() {
  const t = useTranslations("v2Imports");
  const dates = useDateFormat();
  const canCreate = usePermission("imports.create").allowed;
  const importers = useImporters();
  const [importer, setImporter] = useState<ImporterKey | "">("");
  const [status, setStatus] = useState<ImportJobDto["status"] | "">("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const jobs = useImportJobs({ ...(importer ? { importer } : {}), ...(status ? { status } : {}), limit: pageSize, offset: (page - 1) * pageSize });
  const labelOf = (key: ImporterKey): string => importers.data?.items.find((i) => i.key === key)?.label ?? key;

  const columns: Array<DataTableColumn<ImportJobDto>> = [
    {
      id: "file",
      header: t("history.columns.file"),
      headerLabel: t("history.columns.file"),
      rowHeader: true,
      cell: (j) => (
        <Link href={`/v2/imports/${j.id}`} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {j.fileName}
        </Link>
      ),
    },
    { id: "importer", header: t("history.columns.importer"), headerLabel: t("history.columns.importer"), cell: (j) => labelOf(j.importerKey), className: "hidden sm:table-cell" },
    { id: "status", header: t("history.columns.status"), headerLabel: t("history.columns.status"), cell: (j) => <StatusBadge label={t(`status.${j.status}`)} tone={toneOf(j.status)} /> },
    {
      id: "rows",
      header: t("history.columns.rows"),
      headerLabel: t("history.columns.rows"),
      className: "hidden md:table-cell",
      cell: (j) =>
        j.status === "COMPLETED" || j.status === "COMPLETED_WITH_ERRORS" || j.status === "CANCELLED"
          ? t("history.rowsDone", { created: j.createdCount, updated: j.updatedCount, skipped: j.skippedCount, failed: j.failedCount })
          : t("history.rowsTotal", { total: j.totalRows }),
    },
    { id: "duration", header: t("history.columns.duration"), headerLabel: t("history.columns.duration"), className: "hidden lg:table-cell", cell: (j) => formatDuration(j.durationMs) },
    { id: "createdAt", header: t("history.columns.date"), headerLabel: t("history.columns.date"), className: "hidden sm:table-cell", cell: (j) => dates.instant(j.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title={t("history.title")}
        description={t("history.description")}
        actions={
          canCreate ? (
            <Link href="/v2/imports/new" className={buttonClass.primary}>
              {t("history.new")}
            </Link>
          ) : undefined
        }
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label={t("history.filters")}>
        <div>
          <label htmlFor="imports-filter-importer" className="mb-1 block text-sm font-medium">
            {t("history.filterImporter")}
          </label>
          <select
            id="imports-filter-importer"
            className={INPUT_CLASS}
            value={importer}
            onChange={(e) => {
              setImporter(e.target.value as ImporterKey | "");
              setPage(1);
            }}
          >
            <option value="">{t("history.all")}</option>
            {(importers.data?.items ?? []).map((i) => (
              <option key={i.key} value={i.key}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="imports-filter-status" className="mb-1 block text-sm font-medium">
            {t("history.filterStatus")}
          </label>
          <select
            id="imports-filter-status"
            className={INPUT_CLASS}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ImportJobDto["status"] | "");
              setPage(1);
            }}
          >
            <option value="">{t("history.all")}</option>
            {IMPORT_JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </form>
      <DataTable
        caption={t("history.caption")}
        columns={columns}
        rows={jobs.data?.items ?? []}
        getRowId={(j) => j.id}
        isLoading={jobs.isLoading}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
        emptyTitle={t("history.empty")}
        emptyDescription={t("history.emptyHint")}
        pagination={{ page, pageSize, total: jobs.data?.total ?? 0, onPageChange: setPage }}
      />
    </div>
  );
}
