"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button, Checkbox, Field, Input, NativeSelect, Notice, PageHeader } from "@ecoledigitale/ui";
import { ApiError } from "@/platform/api/errors";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useCatalog, useProvisionTenant, type ProvisionedTenant } from "./hooks";
import { EMPTY_PROVISION, PACKS, slugify, validateProvision, type ProvisionField, type ProvisionFormState } from "./lib";

/** `/v2/platform/tenants/new` : provisionnement d'une organisation (profil, établissements, essai, propriétaire). */
export function ProvisionTenantPage() {
  const t = useTranslations("platform.provision");
  const tPack = useTranslations("settings.institutions.pack");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const catalog = useCatalog();
  const provision = useProvisionTenant();
  const [form, setForm] = useState<ProvisionFormState>(EMPTY_PROVISION);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ProvisionField, string>>>({});
  const [done, setDone] = useState<ProvisionedTenant | null>(null);

  const set = <K extends keyof ProvisionFormState>(key: K, value: ProvisionFormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const server = fieldErrorsOf(provision.error);
  const serverFor = (field: ProvisionField) => server[field] ?? server[field === "adminName" ? "adminContact.name" : field === "adminEmail" ? "adminContact.email" : field];
  const shown = (field: ProvisionField) => errors[field] ?? serverFor(field);
  const partial = provision.error instanceof ApiError && provision.error.code === "platform.provisioning_partial";
  const partialTenantId = partial && provision.error instanceof ApiError && typeof (provision.error.details as { tenantId?: unknown } | undefined)?.tenantId === "string" ? ((provision.error.details as { tenantId: string }).tenantId) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateProvision(form);
    setErrors(result.errors);
    if (!result.data) return;
    provision.mutate(result.data, {
      onSuccess: (created) => {
        notifySuccess(t("doneTitle"));
        setDone(created);
      },
    });
  };

  if (done) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("doneTitle")} />
        <Notice tone="success">
          <p>{done.owner?.email ? t("doneBody", { slug: done.slug, email: done.owner.email }) : t("doneBodyNoOwner", { slug: done.slug })}</p>
          <p className="mt-1 text-xs">{t("doneInstitutions", { count: done.institutions.length })}</p>
        </Notice>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild className="min-h-11 sm:min-h-10">
            <Link href={`/v2/platform/tenants/${done.tenantId}`}>{t("open")}</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-10"
            onClick={() => {
              setDone(null);
              setForm(EMPTY_PROVISION);
              setSlugTouched(false);
              provision.reset();
            }}
          >
            {t("another")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/v2/platform/tenants"
        className="inline-flex min-h-11 items-center gap-1 text-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} description={t("description")} />

      <form onSubmit={submit} noValidate className="space-y-8">
        <fieldset className="space-y-4">
          <legend className="mb-2 text-base font-semibold">{t("organization")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("name")} required requiredLabel={tu("required")} error={shown("name")}>
              {(c) => (
                <Input
                  {...c}
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({ ...f, name, ...(slugTouched ? {} : { slug: slugify(name) }) }));
                  }}
                />
              )}
            </Field>
            <Field label={t("slug")} hint={t("slugHint")} required requiredLabel={tu("required")} error={shown("slug")}>
              {(c) => (
                <Input
                  {...c}
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set("slug", e.target.value.toLowerCase());
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <Field label={t("country")} hint={t("countryHint")} required requiredLabel={tu("required")} error={shown("countryCode")}>
              {(c) => <Input {...c} value={form.countryCode} maxLength={2} onChange={(e) => set("countryCode", e.target.value.toUpperCase())} autoComplete="off" />}
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t("packs")}</legend>
            <p className="mb-2 text-xs text-muted-foreground">{t("packsHint")}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {PACKS.map((pack) => {
                const id = `provision-pack-${pack}`;
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
            {shown("packs") ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {shown("packs") === "packs" ? t("errors.packs") : shown("packs")}
              </p>
            ) : null}
          </fieldset>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-base font-semibold">{t("owner")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("ownerName")} required requiredLabel={tu("required")} error={shown("adminName")}>
              {(c) => <Input {...c} value={form.adminName} onChange={(e) => set("adminName", e.target.value)} autoComplete="off" />}
            </Field>
            <Field label={t("ownerEmail")} required requiredLabel={tu("required")} error={shown("adminEmail")}>
              {(c) => <Input {...c} type="email" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} autoComplete="off" />}
            </Field>
            <Field label={t("ownerPhone")} error={shown("adminPhone")}>
              {(c) => <Input {...c} type="tel" value={form.adminPhone} onChange={(e) => set("adminPhone", e.target.value)} autoComplete="off" />}
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-base font-semibold">{t("trial")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("trialPlan")} error={shown("trialPlan")}>
              {(c) => (
                <NativeSelect {...c} value={form.trialPlan} onChange={(e) => set("trialPlan", e.target.value)}>
                  <option value="">{t("trialPlanDefault")}</option>
                  {(catalog.data?.plans ?? [])
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t("trialDays")} hint={t("trialDaysHint")} error={shown("trialDays")}>
              {(c) => <Input {...c} type="number" inputMode="numeric" min={1} max={365} value={form.trialDays} onChange={(e) => set("trialDays", e.target.value)} />}
            </Field>
          </div>
        </fieldset>

        {provision.error ? (
          <Notice tone="danger">
            <p>{message(provision.error)}</p>
            {partial ? <p className="mt-1">{t("partial")}</p> : null}
            {partialTenantId ? (
              <p className="mt-2">
                <Link href={`/v2/platform/tenants/${partialTenantId}`} className="font-medium underline">
                  {t("open")}
                </Link>
              </p>
            ) : null}
          </Notice>
        ) : null}

        <Button type="submit" className="min-h-11 w-full sm:min-h-10 sm:w-auto" disabled={provision.isPending}>
          {provision.isPending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
