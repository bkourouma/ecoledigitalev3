"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, Field, Input, LoadingState, NativeSelect, Notice, ResponsiveTable, StatusBadge, type Column } from "@ecoledigitale/ui";
import type { FeatureOverride } from "@ecoledigitale/contracts/v2/entitlements";
import { ApiErrorState, useDateOnly } from "../common";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useCatalog, useOverrides, useRemoveOverride, useSetOverride } from "./hooks";
import { EMPTY_OVERRIDE, validateOverride, type OverrideField, type OverrideFormState } from "./lib";

/** Dérogations de fonctionnalités d'une organisation (accorder / retirer, motif obligatoire, expiration facultative). */
export function OverridesSection({ tenantId }: { tenantId: string }) {
  const t = useTranslations("platform.overrides");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const date = useDateOnly();
  const overrides = useOverrides(tenantId);
  const catalog = useCatalog();
  const save = useSetOverride();
  const remove = useRemoveOverride();
  const [form, setForm] = useState<OverrideFormState>(EMPTY_OVERRIDE);
  const [errors, setErrors] = useState<Partial<Record<OverrideField, string>>>({});
  const [removing, setRemoving] = useState<FeatureOverride | null>(null);
  const server = fieldErrorsOf(save.error);
  const text = (field: OverrideField) => {
    const raw = errors[field] ?? server[field];
    return raw === "feature" ? t("errors.feature") : raw;
  };
  const labelOf = (key: string) => catalog.data?.features.find((f) => f.key === key)?.label ?? key;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateOverride(form);
    setErrors(result.errors);
    if (!result.data) return;
    save.mutate(
      { tenantId, featureKey: form.featureKey, ...result.data },
      {
        onSuccess: () => {
          notifySuccess(t("saved"));
          setForm(EMPTY_OVERRIDE);
        },
      },
    );
  };

  const columns: Column<FeatureOverride>[] = [
    {
      key: "feature",
      header: t("feature"),
      cell: (o) => (
        <span>
          {labelOf(o.featureKey)}
          <code className="block break-all text-xs text-muted-foreground">{o.featureKey}</code>
        </span>
      ),
    },
    { key: "effect", header: t("effect"), cell: (o) => <StatusBadge tone={o.effect === "GRANT" ? "success" : "danger"}>{o.effect === "GRANT" ? t("grant") : t("deny")}</StatusBadge> },
    { key: "reason", header: t("reason"), hideOnMobile: true, cell: (o) => o.reason },
    { key: "expiresAt", header: t("expiresAt"), cell: (o) => (o.expiresAt ? date(o.expiresAt) : t("never")) },
    {
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      label: "",
      cell: (o) => (
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("remove", { feature: labelOf(o.featureKey) })} onClick={() => setRemoving(o)}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      ),
    },
  ];

  return (
    <section aria-labelledby="tenant-overrides" className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 id="tenant-overrides" className="text-base font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {overrides.isPending ? <LoadingState label={tu("loading")} rows={2} /> : null}
      {overrides.isError ? <ApiErrorState error={overrides.error} onRetry={() => void overrides.refetch()} /> : null}
      {overrides.data && overrides.data.length === 0 ? <EmptyState title={t("empty")} /> : null}
      {overrides.data && overrides.data.length > 0 ? <ResponsiveTable columns={columns} rows={overrides.data} rowKey={(o) => o.id} caption={t("caption")} /> : null}

      <form onSubmit={submit} noValidate aria-label={t("add")} className="space-y-4 border-t pt-4">
        <h3 className="text-sm font-semibold">{t("add")}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("feature")} required requiredLabel={tu("required")} error={text("featureKey")}>
            {(c) => (
              <NativeSelect {...c} value={form.featureKey} onChange={(e) => setForm((f) => ({ ...f, featureKey: e.target.value }))}>
                <option value="">{t("featureChoose")}</option>
                {(catalog.data?.features ?? [])
                  .filter((f) => !f.retired)
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label} ({f.key})
                    </option>
                  ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t("effect")}>
            {(c) => (
              <NativeSelect {...c} value={form.effect} onChange={(e) => setForm((f) => ({ ...f, effect: e.target.value === "DENY" ? "DENY" : "GRANT" }))}>
                <option value="GRANT">{t("grant")}</option>
                <option value="DENY">{t("deny")}</option>
              </NativeSelect>
            )}
          </Field>
          <Field label={t("reason")} hint={t("reasonHint")} required requiredLabel={tu("required")} error={text("reason")}>
            {(c) => <Input {...c} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} maxLength={500} />}
          </Field>
          <Field label={t("expiresAt")} hint={t("expiresHint")} error={text("expiresAt")}>
            {(c) => <Input {...c} type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />}
          </Field>
        </div>
        {save.error ? <Notice tone="danger">{message(save.error)}</Notice> : null}
        <Button type="submit" className="min-h-11 w-full sm:min-h-10 sm:w-auto" disabled={save.isPending}>
          {t("save")}
        </Button>
      </form>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.reset();
          }
        }}
        title={t("removeTitle")}
        description={removing ? t("removeBody", { feature: labelOf(removing.featureKey) }) : ""}
        confirmLabel={tu("confirm")}
        cancelLabel={tu("cancel")}
        closeLabel={tu("close")}
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(
            { tenantId, featureKey: removing.featureKey },
            {
              onSuccess: () => {
                notifySuccess(t("removed"));
                setRemoving(null);
              },
            },
          )
        }
      >
        {remove.error ? <Notice tone="danger">{message(remove.error)}</Notice> : null}
      </ConfirmDialog>
    </section>
  );
}
