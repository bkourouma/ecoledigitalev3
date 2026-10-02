"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AcademicRolloverRunDto } from "@ecoledigitale/contracts/v2/academic";
import { useAcademicYears } from "@/platform/v2/academic";
import { isLiveRun, useRolloverRuns } from "@/platform/v2/rollover";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { runTone } from "./labels";

/** Historique des reconductions d'une année source, avec reprise d'une exécution vivante. */
export function RolloverHistory({ initialFromId = "" }: { initialFromId?: string }) {
  const t = useTranslations("v2Rollover.history");
  const tStatus = useTranslations("v2Rollover.runStatus");
  const tStep = useTranslations("v2Rollover.step");
  const date = useDateFormat();
  const years = useAcademicYears();
  const [fromId, setFromId] = useState(initialFromId);
  const runs = useRolloverRuns(fromId || null);
  const list = runs.data ?? [];
  const live = list.find((r) => isLiveRun(r));
  const yearLabel = (id: string) => (years.data ?? []).find((y) => y.id === id)?.label ?? id.slice(0, 8);

  const columns: DataTableColumn<AcademicRolloverRunDto>[] = [
    { id: "requestedAt", header: t("columns.requestedAt"), rowHeader: true, cell: (r) => date.instant(r.requestedAt) },
    { id: "to", header: t("columns.to"), cell: (r) => yearLabel(r.toAcademicYearId) },
    { id: "status", header: t("columns.status"), cell: (r) => <StatusBadge label={tStatus(r.status)} tone={runTone(r.status)} /> },
    { id: "steps", header: t("columns.steps"), cell: (r) => r.steps.map((s) => tStep(s)).join(", "), className: "hidden md:table-cell" },
    { id: "attempts", header: t("columns.attempts"), align: "right", cell: (r) => date.number(r.attempts), className: "hidden sm:table-cell" },
    {
      id: "open",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) => (
        <Link href={`/v2/academic/rollover/runs/${r.id}`} className={buttonClass.ghost} aria-label={`${isLiveRun(r) ? t("resume") : t("open")} — ${date.instant(r.requestedAt)}`}>
          {isLiveRun(r) ? t("resume") : t("open")}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/v2/academic/rollover" className={buttonClass.primary}>
            {t("new")}
          </Link>
        }
      />
      <FormField label={t("from")} className="max-w-md">
        {(c) => <NativeSelect {...c} value={fromId} placeholder={t("choose")} onChange={setFromId} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
      </FormField>
      {live ? (
        <Notice kind="warning">
          <p className="font-medium">{t("liveRun")}</p>
          <Link href={`/v2/academic/rollover/runs/${live.id}`} className="text-sm font-medium underline underline-offset-4">
            {t("resume")}
          </Link>
        </Notice>
      ) : null}
      {fromId ? (
        <DataTable
          caption={t("caption")}
          columns={columns}
          rows={list}
          getRowId={(r) => r.id}
          isLoading={runs.isPending && runs.fetchStatus !== "idle"}
          error={runs.error}
          onRetry={() => void runs.refetch()}
          emptyTitle={t("empty")}
          emptyDescription={t("emptyHint")}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("selectYear")}</p>
      )}
    </div>
  );
}
