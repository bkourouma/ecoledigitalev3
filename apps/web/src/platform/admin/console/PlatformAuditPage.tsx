"use client";

import { useTranslations } from "next-intl";
import { Button, EmptyState, LoadingState, PageHeader, ResponsiveTable, StatusBadge, type Column, type StatusTone } from "@ecoledigitale/ui";
import type { AuditLogSummaryDto } from "@ecoledigitale/contracts/v2/audit";
import { ApiErrorState, useDateTime } from "../common";
import { isUnavailableEndpoint } from "../errors";
import { usePlatformAudit } from "./hooks";

const TONE: Record<AuditLogSummaryDto["severity"], StatusTone> = { info: "neutral", notice: "info", warning: "warning", critical: "danger" };

/**
 * `/v2/platform/audit` : journal d'audit de plateforme (actions des opérateurs). L'API n'expose pas encore la route de
 * lecture : tant qu'elle répond 404/501, l'écran l'explique au lieu d'afficher une panne.
 */
export function PlatformAuditPage() {
  const t = useTranslations("platform.audit");
  const tSeverity = useTranslations("audit.severity");
  const tActor = useTranslations("audit.actorType");
  const tList = useTranslations("audit.list");
  const tu = useTranslations("ui");
  const dateTime = useDateTime();
  const query = usePlatformAudit();

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const columns: Column<AuditLogSummaryDto>[] = [
    { key: "date", header: tList("date"), cell: (e) => <time dateTime={e.occurredAt}>{dateTime(e.occurredAt)}</time> },
    { key: "severity", header: tList("severity"), cell: (e) => <StatusBadge tone={TONE[e.severity]}>{tSeverity(e.severity)}</StatusBadge> },
    { key: "action", header: tList("action"), cell: (e) => <code className="text-xs">{e.action}</code> },
    { key: "entity", header: tList("entity"), cell: (e) => <span>{e.entity}{e.entityId ? <span className="block break-all text-xs text-muted-foreground">{e.entityId}</span> : null}</span> },
    { key: "actor", header: tList("actor"), hideOnMobile: true, cell: (e) => tActor(e.actorType) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {query.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
      {query.isError ? (
        isUnavailableEndpoint(query.error) ? (
          <EmptyState title={t("unavailableTitle")} description={t("unavailableBody")} />
        ) : (
          <ApiErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : null}
      {query.data && items.length === 0 ? <EmptyState title={t("empty")} /> : null}
      {query.data && items.length > 0 ? (
        <div className="space-y-4">
          <ResponsiveTable columns={columns} rows={items} rowKey={(e) => e.id} caption={t("caption")} />
          {query.hasNextPage ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" className="min-h-11" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {tList("loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
