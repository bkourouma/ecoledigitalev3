"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Field, Input, LoadingState, Notice, PageHeader, StatusBadge } from "@ecoledigitale/ui";
import type { TenantStatus } from "@ecoledigitale/contracts/v2/tenancy";
import { ApiError } from "@/platform/api/errors";
import { ApiErrorState, useDateOnly } from "../common";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { EntitlementsSection } from "./EntitlementsSection";
import { OverridesSection } from "./OverridesSection";
import { SubscriptionSection } from "./SubscriptionSection";
import { useReconcileTenant, useSetTenantStatus, useTenantOverview, type TenantOverview } from "./hooks";
import { STATUS_ACTION_KEY, statusTargets } from "./lib";
import { TENANT_STATUS_TONE } from "./TenantsPage";

/** `/v2/platform/tenants/[tenantId]` : vue d'ensemble, statut, abonnement, dérogations, droits effectifs. */
export function TenantDetailPage({ tenantId }: { tenantId: string }) {
  const t = useTranslations("platform.detail");
  const tu = useTranslations("ui");
  const overview = useTenantOverview(tenantId);

  return (
    <div className="space-y-6">
      <Link
        href="/v2/platform/tenants"
        className="inline-flex min-h-11 items-center gap-1 text-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      {overview.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
      {overview.isError ? (
        overview.error instanceof ApiError && overview.error.isNotFound ? (
          <EmptyState title={t("notFound")} />
        ) : (
          <ApiErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        )
      ) : null}
      {overview.data ? <Loaded tenantId={tenantId} overview={overview.data} /> : null}
    </div>
  );
}

function Loaded({ tenantId, overview }: { tenantId: string; overview: TenantOverview }) {
  const t = useTranslations("platform.detail");
  const tTenants = useTranslations("platform.tenants");
  const tPack = useTranslations("settings.institutions.pack");
  const tInstStatus = useTranslations("settings.institutions.status");
  const date = useDateOnly();
  const { tenant, profile, institutions } = overview;

  return (
    <div className="space-y-8">
      <PageHeader
        title={tenant.name}
        description={`${t("slug", { slug: tenant.slug })} · ${t("createdAt", { date: date(tenant.createdAt) })}`}
        actions={<StatusBadge tone={TENANT_STATUS_TONE[tenant.status]}>{tTenants(`statusLabel.${tenant.status}`)}</StatusBadge>}
      />

      <section aria-labelledby="tenant-overview" className="rounded-lg border p-4">
        <h2 id="tenant-overview" className="mb-2 text-base font-semibold">
          {t("overview")}
        </h2>
        <dl className="divide-y text-sm">
          <Line label={t("legalName")}>{profile?.legalName ?? "—"}</Line>
          <Line label={t("country")}>{profile?.countryCode ?? "—"}</Line>
          <Line label={t("contact")}>{profile ? [profile.contactName, profile.contactEmail, profile.contactPhone].filter(Boolean).join(" · ") || "—" : "—"}</Line>
          <Line label={t("institutions")}>
            {institutions.length === 0 ? (
              t("noInstitutions")
            ) : (
              <ul className="space-y-1">
                {institutions.map((i) => (
                  <li key={i.id}>
                    <span className="font-medium">{i.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">{t("institutionLine", { pack: tPack(i.pack), status: tInstStatus(i.status) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Line>
        </dl>
      </section>

      <StatusSection tenantId={tenantId} name={tenant.name} status={tenant.status} />
      <SubscriptionSection tenantId={tenantId} />
      <OverridesSection tenantId={tenantId} />
      <EntitlementsSection tenantId={tenantId} />
      <ReconcileSection tenantId={tenantId} />
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-3">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words sm:col-span-2">{children}</dd>
    </div>
  );
}

function StatusSection({ tenantId, name, status }: { tenantId: string; name: string; status: TenantStatus }) {
  const t = useTranslations("platform.detail.status");
  const tTenants = useTranslations("platform.tenants");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const setStatus = useSetTenantStatus();
  const [target, setTarget] = useState<TenantStatus | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  const actionLabel = (to: TenantStatus) => t(STATUS_ACTION_KEY[to]);
  const reasonRequired = target !== null && target !== "active";

  const close = () => {
    setTarget(null);
    setReason("");
    setReasonError(false);
    setStatus.reset();
  };

  const confirm = () => {
    if (!target) return;
    if (reasonRequired && reason.trim().length < 3) {
      setReasonError(true);
      return;
    }
    setReasonError(false);
    setStatus.mutate(
      { tenantId, status: target, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          notifySuccess(t("done"));
          close();
        },
      },
    );
  };

  return (
    <section aria-labelledby="tenant-status" className="space-y-3 rounded-lg border p-4">
      <h2 id="tenant-status" className="text-base font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {statusTargets(status).map((to) => (
          <Button key={to} type="button" variant={to === "archived" || to === "suspended" ? "destructive" : "outline"} className="min-h-11 sm:min-h-10" onClick={() => setTarget(to)}>
            {actionLabel(to)}
          </Button>
        ))}
      </div>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => (!open ? close() : undefined)}
        title={target ? t("confirmTitle", { action: actionLabel(target) }) : ""}
        description={target ? t("confirmBody", { name, status: tTenants(`statusLabel.${target}`) }) : ""}
        confirmLabel={target ? actionLabel(target) : tu("confirm")}
        cancelLabel={tu("cancel")}
        closeLabel={tu("close")}
        destructive={target !== "active"}
        pending={setStatus.isPending}
        onConfirm={confirm}
      >
        <Field label={t("reason")} hint={t("reasonHint")} required={reasonRequired} requiredLabel={tu("required")} error={reasonError ? t("reasonRequired") : undefined}>
          {(c) => <Input {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
        </Field>
        {setStatus.error ? <Notice tone="danger">{message(setStatus.error)}</Notice> : null}
      </ConfirmDialog>
    </section>
  );
}

function ReconcileSection({ tenantId }: { tenantId: string }) {
  const t = useTranslations("platform.detail.reconcile");
  const message = useErrorMessage();
  const reconcile = useReconcileTenant();

  return (
    <section aria-labelledby="tenant-reconcile" className="space-y-3 rounded-lg border p-4">
      <h2 id="tenant-reconcile" className="text-base font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 sm:min-h-10"
        disabled={reconcile.isPending}
        onClick={() =>
          reconcile.mutate(
            { tenantId },
            {
              onSuccess: (report) =>
                notifySuccess(t("done", { created: report.rolesCreated ?? 0, subscription: report.subscriptionCreated ? t("subscriptionCreated") : t("subscriptionKept") })),
            },
          )
        }
      >
        <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />
        {t("button")}
      </Button>
      {reconcile.error ? <Notice tone="danger">{message(reconcile.error)}</Notice> : null}
    </section>
  );
}
