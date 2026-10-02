"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useDocumentsInfinite, useDocumentSummary } from "@/platform/v2/documents";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { cn } from "@/lib/utils";
import { DocumentRow } from "./ExplorerScreen";

const TABS = ["expiring", "expired", "missing"] as const;
type Tab = (typeof TABS)[number];

function Counter({ label, value, tone }: { label: string; value: number | null; tone: "warning" | "danger" | "neutral" }) {
  return (
    <div className={cn("rounded-lg border p-4", tone === "danger" && "border-red-300 bg-red-50", tone === "warning" && "border-amber-300 bg-amber-50")}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold" aria-label={`${label} : ${value ?? 0}`}>
        {value ?? 0}
      </p>
    </div>
  );
}

/** Écran des expirations : à échoir sous N jours, échus, sans échéance alors que la catégorie l'exige. */
export function ExpirationsScreen() {
  const t = useTranslations("v2Documents.expirations");
  const [within, setWithin] = useState("30");
  const [tab, setTab] = useState<Tab>("expiring");
  const days = Number(within);
  const summary = useDocumentSummary(days);
  const list = useDocumentsInfinite({ expiry: tab, withinDays: days, sort: "expiresOn", dir: tab === "expired" ? "desc" : "asc" });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <FormField label={t("within")} className="max-w-xs">
        {(c) => <NativeSelect {...c} value={within} options={["15", "30", "60", "90", "180"].map((d) => ({ value: d, label: t("days", { count: Number(d) }) }))} onChange={setWithin} />}
      </FormField>
      {summary.isError ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : (
        <section aria-label={t("summary")} className="grid gap-3 sm:grid-cols-3">
          <Counter label={t("expiring", { days })} value={summary.data?.expiring ?? null} tone="warning" />
          <Counter label={t("expired")} value={summary.data?.expired ?? null} tone="danger" />
          <Counter label={t("missing")} value={summary.data?.missingExpiry ?? null} tone="neutral" />
        </section>
      )}
      <div role="tablist" aria-label={t("tabs")} className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" id={`exp-tab-${x}`} aria-selected={tab === x} aria-controls="exp-panel" onClick={() => setTab(x)} className={tab === x ? buttonClass.primary : buttonClass.secondary}>
            {t(`tab.${x}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="exp-panel" aria-labelledby={`exp-tab-${tab}`} className="space-y-2">
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : items.length === 0 ? <EmptyBlock title={t(`empty.${tab}`)} /> : (
          <ul aria-label={t(`tab.${tab}`)} className="space-y-2">
            {items.map((d) => (
              <DocumentRow key={d.id} doc={d} />
            ))}
          </ul>
        )}
        {list.hasNextPage ? <button type="button" onClick={() => void list.fetchNextPage()} className={buttonClass.secondary}>{t("more")}</button> : null}
      </div>
    </div>
  );
}
