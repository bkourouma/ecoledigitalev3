"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { NOTIF_SKIP_REASONS, type NotifCategory, type NotifChannel, type NotifDeliveryStatus, type NotifDeliveryView } from "@ecoledigitale/contracts/v2/notifications";
import { useDeliveriesInfinite, useDeliveryStats, type DeliveryFilters } from "@/platform/v2/notifications";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { CATEGORIES, CHANNELS, endOfDay, startOfDay, STATUSES, STATUS_TONE } from "./notifications-utils";

const inputClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";
const DAY_RANGES = [1, 7, 30] as const;

function DeliveryRow({ d }: { d: NotifDeliveryView }) {
  const t = useTranslations("v2Notifications");
  const fmt = useDateFormat();
  const skip = d.skipReason ? ((NOTIF_SKIP_REASONS as readonly string[]).includes(d.skipReason) ? t(`skip.${d.skipReason}`) : d.skipReason) : null;
  return (
    <li className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={t(`status.${d.status}`)} tone={STATUS_TONE[d.status]} />
          <span className="text-sm font-medium">{t(`channels.${d.channel}`)}</span>
          {d.urgent ? <StatusBadge label={t("urgent")} tone="danger" /> : null}
        </div>
        <time dateTime={d.createdAt} className="text-xs text-muted-foreground">
          {fmt.instant(d.createdAt)}
        </time>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">{t("row.recipient")}</dt>
          <dd className="min-w-0 break-all font-mono">{d.recipient}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">{t("row.template")}</dt>
          <dd>{t("row.templateValue", { code: d.templateCode, version: d.templateVersion })}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">{t("row.source")}</dt>
          <dd>{d.ruleKey ? `${t(`source.${d.sourceKind}`)} · ${d.ruleKey}` : t(`source.${d.sourceKind}`)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">{t("row.attempts")}</dt>
          <dd>{t("row.attemptsValue", { n: d.attempts, max: d.maxAttempts })}</dd>
        </div>
        {d.sentAt ? (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t("row.sentAt")}</dt>
            <dd>{fmt.instant(d.sentAt)}</dd>
          </div>
        ) : null}
        {d.providerId ? (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t("row.providerId")}</dt>
            <dd className="min-w-0 break-all font-mono text-xs">{d.providerId}</dd>
          </div>
        ) : null}
        {d.cost ? (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t("row.cost")}</dt>
            <dd>{`${fmt.number(d.cost.amount)} ${d.cost.currency}`}</dd>
          </div>
        ) : null}
      </dl>
      {skip ? <p className="mt-2 text-sm text-muted-foreground">{t("row.skipped", { reason: skip })}</p> : null}
      {d.errorCode ? (
        <p className="mt-2 text-sm text-destructive">
          <span className="font-mono">{d.errorCode}</span>
          {d.errorMessage ? ` — ${d.errorMessage}` : ""}
        </p>
      ) : null}
      {d.status === "PENDING" && d.attempts > 0 ? <p className="mt-1 text-xs text-muted-foreground">{t("row.nextAttempt", { at: fmt.instant(d.availableAt) })}</p> : null}
    </li>
  );
}

function Stats({ days }: { days: number }) {
  const t = useTranslations("v2Notifications");
  const stats = useDeliveryStats(days);
  if (stats.isPending) return null;
  if (stats.isError) return null;
  const statuses = STATUSES.filter((s) => (stats.data.byStatus[s] ?? 0) > 0);
  const channels = CHANNELS.filter((c) => (stats.data.byChannel[c] ?? 0) > 0);
  if (statuses.length === 0) return <p className="text-sm text-muted-foreground">{t("stats.none")}</p>;
  return (
    <section aria-label={t("stats.label")} className="space-y-2">
      <ul className="flex flex-wrap gap-2">
        {statuses.map((s) => (
          <li key={s} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <StatusBadge label={t(`status.${s}`)} tone={STATUS_TONE[s]} />
            <span className="font-semibold tabular-nums">{stats.data.byStatus[s]}</span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {channels.map((c) => (
          <li key={c}>{t("stats.channel", { channel: t(`channels.${c}`), n: stats.data.byChannel[c] ?? 0 })}</li>
        ))}
      </ul>
    </section>
  );
}

/** Journal de tous les envois : filtres, statistiques, liste paginée. Destinataires masqués ; jamais de contenu. */
export function JournalScreen() {
  const t = useTranslations("v2Notifications");
  const [channel, setChannel] = useState<NotifChannel | "">("");
  const [status, setStatus] = useState<NotifDeliveryStatus | "">("");
  const [category, setCategory] = useState<NotifCategory | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [days, setDays] = useState<number>(7);

  const filters = useMemo<DeliveryFilters>(
    () => ({
      ...(channel ? { channel } : {}),
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(from ? { from: startOfDay(from) } : {}),
      ...(to ? { to: endOfDay(to) } : {}),
    }),
    [channel, status, category, from, to],
  );
  const list = useDeliveriesInfinite(filters);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Object.keys(filters).length > 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("stats.period")}>
        {DAY_RANGES.map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={days === d ? buttonClass.primary : buttonClass.secondary}>
            {t("stats.days", { n: d })}
          </button>
        ))}
      </div>
      <Stats days={days} />

      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label={t("filters.label")} onSubmit={(e) => e.preventDefault()}>
        <label className="space-y-1 text-sm font-medium">
          {t("filters.channel")}
          <select value={channel} onChange={(e) => setChannel(e.target.value as NotifChannel | "")} className={inputClass}>
            <option value="">{t("filters.all")}</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`channels.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("filters.status")}
          <select value={status} onChange={(e) => setStatus(e.target.value as NotifDeliveryStatus | "")} className={inputClass}>
            <option value="">{t("filters.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("filters.category")}
          <select value={category} onChange={(e) => setCategory(e.target.value as NotifCategory | "")} className={inputClass}>
            <option value="">{t("filters.all")}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("filters.from")}
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t("filters.to")}
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </label>
      </form>

      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={filtered ? t("empty.filteredTitle") : t("empty.title")} description={filtered ? t("empty.filteredDescription") : t("empty.description")} />
      ) : (
        <>
          <ul className="space-y-3" aria-label={t("list")}>
            {items.map((d) => (
              <DeliveryRow key={d.id} d={d} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="flex justify-center">
              <button type="button" className={buttonClass.secondary} onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {t("loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
