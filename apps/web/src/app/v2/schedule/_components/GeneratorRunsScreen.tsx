"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAutogenRuns, type AutogenRunDto } from "@/platform/v2/scheduling";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";

export const autogenTone = (status: string) =>
  (status === "COMPLETED" || status === "APPLIED" ? "success" : status === "FAILED" ? "danger" : status === "QUEUED" || status === "RUNNING" ? "info" : "neutral") as "success" | "danger" | "info" | "neutral";

/**
 * Générateur d'emploi du temps : les propositions déjà calculées (ou en cours). Une proposition n'est qu'un brouillon de
 * calcul : rien n'est publié ni écrasé tant qu'un humain ne l'a pas appliquée.
 */
export function GeneratorRunsScreen() {
  const t = useTranslations("v2Schedule.generator.runs");
  const tStatus = useTranslations("v2Schedule.generator.status");
  const date = useDateFormat();
  const list = useAutogenRuns();

  const columns: DataTableColumn<AutogenRunDto>[] = [
    {
      id: "name",
      header: t("columns.name"),
      rowHeader: true,
      cell: (r) => (
        <Link href={`/v2/schedule/generator/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {r.name}
        </Link>
      ),
    },
    { id: "status", header: t("columns.status"), cell: (r) => <StatusBadge label={tStatus(r.status)} tone={autogenTone(r.status)} /> },
    {
      id: "placed",
      header: t("columns.placed"),
      cell: (r) => (r.summary?.sessions !== undefined && r.summary.placed !== undefined ? t("placedValue", { placed: r.summary.placed, total: r.summary.sessions }) : r.summary?.sessions !== undefined ? t("sessionsValue", { total: r.summary.sessions }) : "—"),
      className: "hidden sm:table-cell",
    },
    { id: "unplaced", header: t("columns.unplaced"), cell: (r) => (r.summary?.unplacedSessions === undefined ? "—" : String(r.summary.unplacedSessions)), className: "hidden md:table-cell" },
    { id: "seed", header: t("columns.seed"), cell: (r) => <code className="text-xs">{r.seed.slice(0, 12)}</code>, className: "hidden lg:table-cell" },
    { id: "requested", header: t("columns.requested"), cell: (r) => date.instant(r.requestedAt), className: "hidden md:table-cell" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="schedule.manage">
            <Link href="/v2/schedule/generator/new" className={buttonClass.primary}>
              {t("launch")}
            </Link>
          </Can>
        }
      />
      <Notice kind="info">{t("safety")}</Notice>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data ?? []}
        getRowId={(r) => r.id}
        isLoading={list.isFetching && !list.data}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
    </div>
  );
}
