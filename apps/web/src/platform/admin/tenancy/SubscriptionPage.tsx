"use client";

import { useFormatter, useTranslations } from "next-intl";
import { EmptyState, LoadingState, Notice, PageHeader, ResponsiveTable, StatusBadge, type Column, type StatusTone } from "@ecoledigitale/ui";
import type { EffectiveEntitlementsDto, SubscriptionStatus, UsageCounter } from "@ecoledigitale/contracts/v2/entitlements";
import { ApiErrorState, useDateTime } from "../common";
import { useEffectiveEntitlements, useMyUsage } from "./hooks";

const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = { TRIALING: "info", ACTIVE: "success", PAST_DUE: "warning", CANCELED: "neutral", EXPIRED: "danger" };
const UNITS = ["o", "Ko", "Mo", "Go", "To"] as const;

/** Taille lisible : `{ value, unit }` en puissances de 1024 (valeur arrondie à 1 décimale). Fonction pure. */
export function humanBytes(bytes: number): { value: number; unit: (typeof UNITS)[number] } {
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1024 && index < UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  return { value: Math.round(value * 10) / 10, unit: UNITS[index]! };
}

/** Fonctionnalités regroupées par module (première partie de la clé), triées. Fonction pure. */
export function groupFeatures(features: readonly string[]): { module: string; keys: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const key of features) {
    const moduleKey = key.split(".")[0] ?? key;
    groups.set(moduleKey, [...(groups.get(moduleKey) ?? []), key]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([moduleKey, keys]) => ({ module: moduleKey, keys: keys.sort() }));
}

/** `/v2/settings/subscription` : offre, packs, droits effectifs et usage (lecture seule). */
export function SubscriptionPage() {
  const t = useTranslations("settings.subscription");
  const tu = useTranslations("ui");
  const entitlements = useEffectiveEntitlements();
  const usage = useMyUsage();

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {entitlements.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
      {entitlements.isError ? <ApiErrorState error={entitlements.error} onRetry={() => void entitlements.refetch()} /> : null}
      {entitlements.data ? <Summary data={entitlements.data} /> : null}
      <UsageSection query={usage} />
    </div>
  );
}

function Summary({ data }: { data: EffectiveEntitlementsDto }) {
  const t = useTranslations("settings.subscription");
  const tInst = useTranslations("settings.institutions.pack");
  const tu = useTranslations("ui");
  const format = useFormatter();
  const dateTime = useDateTime();

  return (
    <div className="space-y-6">
      {data.reason !== "OK" ? <Notice tone="warning">{t(`reason.${data.reason}`)}</Notice> : null}

      <section aria-labelledby="subscription-summary" className="rounded-lg border p-4">
        <h2 id="subscription-summary" className="sr-only">
          {t("title")}
        </h2>
        <dl className="divide-y">
          <Row label={t("plan")}>{data.planKey ?? t("noPlan")}</Row>
          <Row label={t("status")}>
            {data.subscriptionStatus ? <StatusBadge tone={STATUS_TONE[data.subscriptionStatus]}>{t(`statusLabel.${data.subscriptionStatus}`)}</StatusBadge> : tu("dash")}
          </Row>
          <Row label={t("packs")}>
            {data.packs.length > 0 ? (
              <span className="flex flex-wrap gap-2">
                {data.packs.map((pack) => (
                  <StatusBadge key={pack} tone="info">
                    {tInst(pack)}
                  </StatusBadge>
                ))}
              </span>
            ) : (
              t("noPacks")
            )}
          </Row>
          <Row label={t("learnerTier")}>
            {data.limits.learnerTierMax ? t("learnerTierValue", { max: format.number(data.limits.learnerTierMax) }) : t("learnerTierUnlimited")}
          </Row>
          {data.validUntil ? <Row label={t("validUntil")}>{dateTime(data.validUntil)}</Row> : null}
        </dl>
      </section>

      <section aria-labelledby="subscription-features" className="rounded-lg border p-4">
        <h2 id="subscription-features" className="mb-1 text-base font-semibold">
          {t("features")}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("featuresCount", { count: data.features.length })}</p>
        <div className="space-y-2">
          {groupFeatures(data.features).map((group) => (
            <details key={group.module} className="rounded-md border p-3">
              <summary className="min-h-6 cursor-pointer text-sm font-medium">
                {group.module} <span className="text-xs text-muted-foreground">({group.keys.length})</span>
              </summary>
              <ul className="mt-2 space-y-1">
                {group.keys.map((key) => (
                  <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <code className="break-all text-xs">{key}</code>
                    {data.sources[key] ? <span className="text-xs text-muted-foreground">{t(`source.${data.sources[key]}`)}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-3">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm sm:col-span-2">{children}</dd>
    </div>
  );
}

function UsageSection({ query }: { query: ReturnType<typeof useMyUsage> }) {
  const t = useTranslations("settings.subscription");
  const tu = useTranslations("ui");
  const format = useFormatter();

  const formatValue = (counter: UsageCounter): string => {
    if (counter.metric === "STORAGE_BYTES") {
      const { value, unit } = humanBytes(counter.value);
      return `${format.number(value, { maximumFractionDigits: 1 })} ${unit}`;
    }
    return format.number(counter.value);
  };
  const monthOf = (period: string) => {
    const date = new Date(`${period}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? period : format.dateTime(date, { month: "long", year: "numeric", timeZone: "UTC" });
  };

  const columns: Column<UsageCounter>[] = [
    { key: "metric", header: t("metric"), cell: (c) => t(`metrics.${c.metric}`) },
    { key: "period", header: t("period"), cell: (c) => monthOf(c.period) },
    { key: "value", header: t("value"), cell: formatValue },
  ];

  return (
    <section aria-labelledby="subscription-usage" className="space-y-3">
      <h2 id="subscription-usage" className="text-base font-semibold">
        {t("usage")}
      </h2>
      {query.isPending ? <LoadingState label={tu("loading")} rows={2} /> : null}
      {query.isError ? <ApiErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? <EmptyState title={t("usageEmpty")} /> : null}
      {query.data && query.data.length > 0 ? (
        <ResponsiveTable columns={columns} rows={query.data} rowKey={(c) => `${c.metric}:${c.period}`} caption={t("usageCaption")} />
      ) : null}
    </section>
  );
}
