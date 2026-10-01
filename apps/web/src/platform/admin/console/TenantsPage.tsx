"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button, EmptyState, Field, Input, LoadingState, NativeSelect, PageHeader, ResponsiveTable, StatusBadge, type Column, type StatusTone } from "@ecoledigitale/ui";
import type { PlatformTenantSummary } from "@ecoledigitale/contracts/v2/platform";
import type { TenantStatus } from "@ecoledigitale/contracts/v2/tenancy";
import { ApiErrorState, useDateOnly } from "../common";
import { useTenants } from "./hooks";

export const PAGE_SIZE = 25;
export const TENANT_STATUS_TONE: Record<TenantStatus, StatusTone> = { active: "success", suspended: "warning", archived: "neutral" };

/** `/v2/platform/tenants` : liste des organisations (recherche, statut, pagination). */
export function TenantsPage() {
  const t = useTranslations("platform.tenants");
  const tu = useTranslations("ui");
  const date = useDateOnly();
  const [draft, setDraft] = useState({ search: "", status: "" });
  const [applied, setApplied] = useState({ search: "", status: "" });
  const [offset, setOffset] = useState(0);
  const tenants = useTenants({ ...applied, limit: PAGE_SIZE, offset });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setApplied({ search: draft.search.trim(), status: draft.status });
  };

  const columns: Column<PlatformTenantSummary>[] = [
    {
      key: "name",
      header: t("name"),
      cell: (r) => (
        <Link
          href={`/v2/platform/tenants/${r.id}`}
          aria-label={t("open", { name: r.name })}
          className="font-medium underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {r.name}
        </Link>
      ),
    },
    { key: "slug", header: t("slug"), cell: (r) => <code className="text-xs">{r.slug}</code> },
    { key: "status", header: t("status"), cell: (r) => <StatusBadge tone={TENANT_STATUS_TONE[r.status]}>{t(`statusLabel.${r.status}`)}</StatusBadge> },
    { key: "createdAt", header: t("createdAt"), hideOnMobile: true, cell: (r) => date(r.createdAt) },
  ];

  const data = tenants.data;
  const filtered = applied.search !== "" || applied.status !== "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild className="min-h-11 sm:min-h-10">
            <Link href="/v2/platform/tenants/new">
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("new")}
            </Link>
          </Button>
        }
      />

      <form onSubmit={submit} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end" role="search" aria-label={t("searchForm")}>
        <Field label={t("search")} hint={t("searchHint")}>
          {(c) => <Input {...c} type="search" value={draft.search} onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))} autoComplete="off" />}
        </Field>
        <Field label={t("statusFilter")}>
          {(c) => (
            <NativeSelect {...c} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
              <option value="">{t("all")}</option>
              {(["active", "suspended", "archived"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`statusLabel.${s}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button type="submit" className="min-h-11 sm:min-h-10">
          {t("apply")}
        </Button>
      </form>

      {tenants.isPending ? <LoadingState label={tu("loading")} rows={5} /> : null}
      {tenants.isError ? <ApiErrorState error={tenants.error} onRetry={() => void tenants.refetch()} /> : null}
      {data && data.items.length === 0 ? <EmptyState title={filtered ? t("empty") : t("emptyFirst")} /> : null}
      {data && data.items.length > 0 ? (
        <div className="space-y-4">
          <ResponsiveTable columns={columns} rows={data.items} rowKey={(r) => r.id} caption={t("caption")} />
          <nav aria-label={t("caption")} className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t("range", { from: data.offset + 1, to: data.offset + data.items.length, total: data.total })}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                {t("previous")}
              </Button>
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" disabled={data.offset + data.items.length >= data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                {t("next")}
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
