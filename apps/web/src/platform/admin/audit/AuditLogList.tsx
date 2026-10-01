"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, LoadingState, ResponsiveTable, StatusBadge, type Column, type StatusTone } from "@ecoledigitale/ui";
import type { AuditLogSummaryDto } from "@ecoledigitale/contracts/v2/audit";
import { ApiErrorState, useDateTime } from "../common";
import { useAuditLogs } from "./hooks";
import type { AuditFilterState, AuditSeverity } from "./filters";
import { hasActiveFilters } from "./filters";

const TONE: Record<AuditSeverity, StatusTone> = { info: "neutral", notice: "info", warning: "warning", critical: "danger" };

export function auditHref(id: string): string {
  return `/v2/audit/${id}`;
}

export function AuditLogList({ filters }: { filters: AuditFilterState }) {
  const t = useTranslations("audit.list");
  const tSeverity = useTranslations("audit.severity");
  const tActor = useTranslations("audit.actorType");
  const tu = useTranslations("ui");
  const dateTime = useDateTime();
  const query = useAuditLogs(filters);

  if (query.isPending) return <LoadingState label={tu("loading")} rows={5} />;
  if (query.isError) return <ApiErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const items = query.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return <EmptyState title={hasActiveFilters(filters) ? t("emptyFiltered") : t("empty")} />;
  }

  const columns: Column<AuditLogSummaryDto>[] = [
    { key: "date", header: t("date"), cell: (e) => <time dateTime={e.occurredAt}>{dateTime(e.occurredAt)}</time> },
    {
      key: "severity",
      header: t("severity"),
      cell: (e) => <StatusBadge tone={TONE[e.severity]}>{tSeverity(e.severity)}</StatusBadge>,
    },
    {
      key: "action",
      header: t("action"),
      cell: (e) => (
        <Link
          href={auditHref(e.id)}
          className="font-mono text-xs underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={t("viewEntry", { action: e.action })}
        >
          {e.action}
        </Link>
      ),
    },
    {
      key: "entity",
      header: t("entity"),
      cell: (e) => (
        <span>
          {e.entity}
          {e.entityId ? <span className="block break-all text-xs text-muted-foreground">{e.entityId}</span> : null}
        </span>
      ),
    },
    {
      key: "actor",
      header: t("actor"),
      hideOnMobile: true,
      cell: (e) => (
        <span>
          {tActor(e.actorType)}
          {e.actorId ? <span className="block break-all text-xs text-muted-foreground">{e.actorId}</span> : null}
        </span>
      ),
    },
    {
      key: "changes",
      header: t("changes"),
      hideOnMobile: true,
      cell: (e) => t("changesCount", { count: e.diff ? Object.keys(e.diff).length : 0 }),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("loaded", { count: items.length })}
      </p>
      <ResponsiveTable columns={columns} rows={items} rowKey={(e) => e.id} caption={t("caption")} />
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" className="min-h-11" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
