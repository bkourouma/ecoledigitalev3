"use client";

import { useFormatter, useTranslations } from "next-intl";
import { EmptyState, LoadingState, ResponsiveTable, type Column } from "@ecoledigitale/ui";
import type { UsageCounter } from "@ecoledigitale/contracts/v2/entitlements";
import { ApiErrorState } from "../common";
import { humanBytes } from "../tenancy/SubscriptionPage";
import { useTenantEntitlements, useTenantUsage } from "./hooks";

/** Droits effectifs (pourquoi chaque fonctionnalité est accordée) et usage d'une organisation, en lecture. */
export function EntitlementsSection({ tenantId }: { tenantId: string }) {
  const t = useTranslations("platform.entitlements");
  const tSub = useTranslations("settings.subscription");
  const tu = useTranslations("ui");
  const format = useFormatter();
  const entitlements = useTenantEntitlements(tenantId);
  const usage = useTenantUsage(tenantId);

  const columns: Column<UsageCounter>[] = [
    { key: "metric", header: t("metric"), cell: (c) => tSub(`metrics.${c.metric}`) },
    { key: "period", header: t("period"), cell: (c) => c.period.slice(0, 7) },
    {
      key: "value",
      header: t("value"),
      cell: (c) => {
        if (c.metric !== "STORAGE_BYTES") return format.number(c.value);
        const { value, unit } = humanBytes(c.value);
        return `${format.number(value, { maximumFractionDigits: 1 })} ${unit}`;
      },
    },
  ];

  return (
    <section aria-labelledby="tenant-entitlements" className="space-y-4 rounded-lg border p-4">
      <h2 id="tenant-entitlements" className="text-base font-semibold">
        {t("title")}
      </h2>
      {entitlements.isPending ? <LoadingState label={tu("loading")} rows={2} /> : null}
      {entitlements.isError ? <ApiErrorState error={entitlements.error} onRetry={() => void entitlements.refetch()} /> : null}
      {entitlements.data ? (
        <dl className="divide-y text-sm">
          <div className="grid gap-1 py-2 sm:grid-cols-3">
            <dt className="font-medium text-muted-foreground">{t("plan")}</dt>
            <dd className="sm:col-span-2">{entitlements.data.planKey ?? tSub("noPlan")}</dd>
          </div>
          <div className="grid gap-1 py-2 sm:grid-cols-3">
            <dt className="font-medium text-muted-foreground">{t("reason")}</dt>
            <dd className="sm:col-span-2">{tSub(`reason.${entitlements.data.reason}`)}</dd>
          </div>
          <div className="grid gap-1 py-2 sm:grid-cols-3">
            <dt className="font-medium text-muted-foreground">{tSub("features")}</dt>
            <dd className="sm:col-span-2">{t("features", { count: entitlements.data.features.length })}</dd>
          </div>
        </dl>
      ) : null}

      <h3 className="text-sm font-semibold">{t("usage")}</h3>
      {usage.isPending ? <LoadingState label={tu("loading")} rows={1} /> : null}
      {usage.isError ? <ApiErrorState error={usage.error} onRetry={() => void usage.refetch()} /> : null}
      {usage.data && usage.data.length === 0 ? <EmptyState title={t("usageEmpty")} /> : null}
      {usage.data && usage.data.length > 0 ? <ResponsiveTable columns={columns} rows={usage.data} rowKey={(c) => `${c.metric}:${c.period}`} caption={t("usage")} /> : null}
    </section>
  );
}
