"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Field, Input, LoadingState, NativeSelect, Notice } from "@ecoledigitale/ui";
import type { Subscription } from "@ecoledigitale/contracts/v2/entitlements";
import { ApiErrorState } from "../common";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useCatalog, useSetSubscription, useTenantSubscription } from "./hooks";
import { PACKS, SUBSCRIPTION_STATUSES, subscriptionFormFrom, validateSubscription, type SubscriptionField, type SubscriptionFormState } from "./lib";

const CODES = new Set(["plan", "period", "learnerTier"]);

/** Abonnement d'une organisation : offre, packs, statut, période, tranche d'apprenants. */
export function SubscriptionSection({ tenantId }: { tenantId: string }) {
  const t = useTranslations("platform.subscription");
  const tu = useTranslations("ui");
  const subscription = useTenantSubscription(tenantId);

  return (
    <section aria-labelledby="tenant-subscription" className="space-y-3 rounded-lg border p-4">
      <h2 id="tenant-subscription" className="text-base font-semibold">
        {t("title")}
      </h2>
      {subscription.isPending ? <LoadingState label={tu("loading")} rows={2} /> : null}
      {subscription.isError ? <ApiErrorState error={subscription.error} onRetry={() => void subscription.refetch()} /> : null}
      {subscription.data !== undefined ? <SubscriptionForm key={subscription.data?.updatedAt ?? "none"} tenantId={tenantId} current={subscription.data} /> : null}
    </section>
  );
}

function SubscriptionForm({ tenantId, current }: { tenantId: string; current: Subscription | null }) {
  const t = useTranslations("platform.subscription");
  const tPack = useTranslations("settings.institutions.pack");
  const message = useErrorMessage();
  const catalog = useCatalog();
  const save = useSetSubscription();
  const [form, setForm] = useState<SubscriptionFormState>(subscriptionFormFrom(current));
  const [errors, setErrors] = useState<Partial<Record<SubscriptionField, string>>>({});
  const server = fieldErrorsOf(save.error);
  const text = (field: SubscriptionField) => {
    const raw = errors[field] ?? server[field];
    return raw && CODES.has(raw) ? t(`errors.${raw}` as never) : raw;
  };
  const set = <K extends keyof SubscriptionFormState>(key: K, value: SubscriptionFormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateSubscription(form);
    setErrors(result.errors);
    if (!result.data) return;
    save.mutate({ tenantId, ...result.data }, { onSuccess: () => notifySuccess(t("saved")) });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {!current ? <Notice tone="info">{t("none")}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("plan")} required error={text("planKey")}>
          {(c) => (
            <NativeSelect {...c} value={form.planKey} onChange={(e) => set("planKey", e.target.value)}>
              <option value="">{t("planChoose")}</option>
              {(catalog.data?.plans ?? []).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                  {p.active ? "" : " (inactif)"}
                </option>
              ))}
              {form.planKey && !(catalog.data?.plans ?? []).some((p) => p.key === form.planKey) ? <option value={form.planKey}>{form.planKey}</option> : null}
            </NativeSelect>
          )}
        </Field>
        <Field label={t("status")}>
          {(c) => (
            <NativeSelect {...c} value={form.status} onChange={(e) => set("status", e.target.value as SubscriptionFormState["status"])}>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statusLabel.${s}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t("startsAt")} error={text("startsAt")}>
          {(c) => <Input {...c} type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />}
        </Field>
        <Field label={t("endsAt")} hint={t("endsAtHint")} error={text("endsAt")}>
          {(c) => <Input {...c} type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />}
        </Field>
        <Field label={t("learnerTierMax")} hint={t("learnerTierHint")} error={text("learnerTierMax")}>
          {(c) => <Input {...c} type="number" inputMode="numeric" min={1} value={form.learnerTierMax} onChange={(e) => set("learnerTierMax", e.target.value)} />}
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t("packs")}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {PACKS.map((pack) => {
            const id = `sub-pack-${pack}`;
            return (
              <div key={pack} className="flex min-h-11 items-center gap-2">
                <Checkbox
                  id={id}
                  checked={form.packs.includes(pack)}
                  onCheckedChange={(checked) => set("packs", checked === true ? [...form.packs, pack] : form.packs.filter((p) => p !== pack))}
                />
                <label htmlFor={id} className="cursor-pointer text-sm">
                  {tPack(pack)}
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      {save.error ? <Notice tone="danger">{message(save.error)}</Notice> : null}
      <Button type="submit" className="min-h-11 w-full sm:min-h-10 sm:w-auto" disabled={save.isPending}>
        {save.isPending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
