"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, LoadingState, NativeSelect, Notice, PageHeader } from "@ecoledigitale/ui";
import type { TenantProfile } from "@ecoledigitale/contracts/v2/tenancy";
import { usePermission } from "@/platform/access";
import { sanitizeColor, sanitizeLogoUrl } from "@/platform/theme/theme";
import { ApiErrorState } from "../common";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useCountries, useTenantProfile, useUpdateTenantProfile } from "./hooks";
import { diffProfile, toFormState, validateProfilePatch, type ProfileFormState } from "./profile";

/** `/v2/settings` : profil de l'organisation et marque (logo, couleurs). */
export function ProfilePage() {
  const t = useTranslations("settings.profile");
  const tu = useTranslations("ui");
  const profile = useTenantProfile();

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {profile.isPending ? <LoadingState label={tu("loading")} rows={5} /> : null}
      {profile.isError ? <ApiErrorState error={profile.error} onRetry={() => void profile.refetch()} /> : null}
      {profile.data ? <ProfileForm key={profile.data.updatedAt} profile={profile.data} /> : null}
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("settings.profile");
  return (
    <Field label={label} hint={hint} error={error}>
      {(c) => (
        <div className="flex gap-2">
          <Input {...c} value={value} readOnly={disabled} placeholder="#1A73E8" onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
          <input
            type="color"
            aria-label={t("colorPicker", { label })}
            disabled={disabled}
            value={sanitizeColor(value) ?? "#000000"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1 sm:h-10"
          />
        </div>
      )}
    </Field>
  );
}

function ProfileForm({ profile }: { profile: TenantProfile }) {
  const t = useTranslations("settings.profile");
  const tSettings = useTranslations("settings");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const manage = usePermission("tenancy.institution.manage");
  const countries = useCountries();
  const update = useUpdateTenantProfile();
  const initial = toFormState(profile);
  const [form, setForm] = useState<ProfileFormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileFormState, string>>>({});

  const readOnly = !manage.allowed;
  const set = (key: keyof ProfileFormState, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const patch = diffProfile(form, profile);
  const dirty = Object.keys(patch).length > 0;
  const server = fieldErrorsOf(update.error);
  const shown = (key: keyof ProfileFormState) => errors[key] ?? server[key];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.legalName.trim()) {
      setErrors({ legalName: t("legalNameRequired") });
      return;
    }
    const result = validateProfilePatch(patch);
    setErrors(result.errors);
    if (!result.data) return;
    update.mutate(result.data, { onSuccess: () => notifySuccess(t("saved")) });
  };

  const primary = sanitizeColor(form.primaryColor);
  const secondary = sanitizeColor(form.secondaryColor);
  const logo = sanitizeLogoUrl(form.logoUrl);

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      {readOnly && !manage.isLoading ? <Notice tone="info">{tSettings("readOnly")}</Notice> : null}

      <fieldset className="space-y-4">
        <legend className="mb-2 text-base font-semibold">{t("identity")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("legalName")} required={!readOnly} requiredLabel={tu("required")} error={shown("legalName")}>
            {(c) => <Input {...c} value={form.legalName} readOnly={readOnly} onChange={(e) => set("legalName", e.target.value)} />}
          </Field>
          <Field label={t("tradeName")} hint={t("tradeNameHint")} error={shown("tradeName")}>
            {(c) => <Input {...c} value={form.tradeName} readOnly={readOnly} onChange={(e) => set("tradeName", e.target.value)} />}
          </Field>
          <Field label={t("country")} error={shown("countryCode")}>
            {(c) =>
              countries.data ? (
                <NativeSelect {...c} value={form.countryCode} disabled={readOnly} onChange={(e) => set("countryCode", e.target.value)}>
                  {!countries.data.some((x) => x.code === form.countryCode) ? <option value={form.countryCode}>{form.countryCode}</option> : null}
                  {countries.data.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name} ({country.code})
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input {...c} value={form.countryCode} readOnly={readOnly} maxLength={2} onChange={(e) => set("countryCode", e.target.value.toUpperCase())} />
              )
            }
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-base font-semibold">{t("contact")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("contactName")} error={shown("contactName")}>
            {(c) => <Input {...c} value={form.contactName} readOnly={readOnly} onChange={(e) => set("contactName", e.target.value)} />}
          </Field>
          <Field label={t("contactEmail")} error={shown("contactEmail")}>
            {(c) => <Input {...c} type="email" value={form.contactEmail} readOnly={readOnly} onChange={(e) => set("contactEmail", e.target.value)} />}
          </Field>
          <Field label={t("contactPhone")} error={shown("contactPhone")}>
            {(c) => <Input {...c} type="tel" value={form.contactPhone} readOnly={readOnly} onChange={(e) => set("contactPhone", e.target.value)} />}
          </Field>
          <Field label={t("address")} error={shown("address")}>
            {(c) => <Input {...c} value={form.address} readOnly={readOnly} onChange={(e) => set("address", e.target.value)} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-base font-semibold">{t("branding")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("logoUrl")} hint={t("logoHint")} error={shown("logoUrl")} className="sm:col-span-2">
            {(c) => <Input {...c} type="url" value={form.logoUrl} readOnly={readOnly} onChange={(e) => set("logoUrl", e.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
          <ColorField label={t("primaryColor")} hint={t("colorHint")} value={form.primaryColor} error={shown("primaryColor")} disabled={readOnly} onChange={(v) => set("primaryColor", v)} />
          <ColorField label={t("secondaryColor")} hint={t("colorHint")} value={form.secondaryColor} error={shown("secondaryColor")} disabled={readOnly} onChange={(v) => set("secondaryColor", v)} />
          <Field label={t("customDomain")} hint={t("customDomainHint")} error={shown("customDomain")} className="sm:col-span-2">
            {(c) => <Input {...c} value={form.customDomain} readOnly={readOnly} onChange={(e) => set("customDomain", e.target.value.toLowerCase())} autoComplete="off" spellCheck={false} />}
          </Field>
        </div>

        <div className="rounded-lg border p-4" aria-label={t("preview")} role="group">
          <p className="mb-2 text-sm font-medium">{t("preview")}</p>
          <div className="overflow-hidden rounded-md border">
            <div className="flex items-center gap-2 px-3 py-2 text-white" style={{ backgroundColor: primary ?? "#2563eb" }}>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt={t("previewLogoAlt")} className="h-8 w-8 rounded bg-white/90 object-contain p-0.5" />
              ) : null}
              <span className="truncate text-sm font-semibold">{form.tradeName.trim() || form.legalName.trim()}</span>
            </div>
            <div className="p-3">
              <span className="inline-flex min-h-9 items-center rounded-md px-3 text-sm text-white" style={{ backgroundColor: secondary ?? "#059669" }}>
                {t("previewSample")}
              </span>
            </div>
          </div>
        </div>
      </fieldset>

      {update.error ? <Notice tone="danger">{message(update.error)}</Notice> : null}

      {!readOnly ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" className="min-h-11 sm:min-h-10" disabled={!dirty || update.isPending}>
            {update.isPending ? t("saving") : t("save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-10"
            disabled={!dirty || update.isPending}
            onClick={() => {
              setForm(initial);
              setErrors({});
              update.reset();
            }}
          >
            {t("reset")}
          </Button>
          {!dirty ? <p className="self-center text-xs text-muted-foreground">{t("unchanged")}</p> : null}
        </div>
      ) : null}
    </form>
  );
}
