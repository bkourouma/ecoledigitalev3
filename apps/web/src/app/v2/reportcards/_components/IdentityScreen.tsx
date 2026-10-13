"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { reportcardsPutBrandingBodySchema } from "@ecoledigitale/contracts/v2/reportcards";
import { useFeature } from "@/platform/access";
import { useInstitutions } from "@/platform/v2/lookups";
import { useBranding, usePutBranding, useReportcardsSettings, useUpdateReportcardsSettings } from "@/platform/v2/reportcards";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ImageUploadField } from "./ImageUpload";

const lines = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Identité visuelle de l'établissement (versionnée) et réglages des documents. Aucune valeur par défaut : tout vient des données du tenant. */
export function IdentityScreen() {
  const t = useTranslations("v2Reportcards.identity");
  const institutions = useInstitutions();
  const [institutionId, setInstitutionId] = useState("");
  const items = institutions.data ?? [];
  const query = useBranding(institutionId || undefined);
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {items.length > 1 ? (
        <FormField label={t("institution")} className="max-w-sm">
          {(c) => <NativeSelect {...c} value={institutionId} onChange={setInstitutionId} placeholder={t("allInstitutions")} options={items.map((i) => ({ value: i.id, label: i.name }))} />}
        </FormField>
      ) : null}
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError ? <BrandingForm key={`${institutionId}-${query.data?.find((b) => b.isCurrent)?.version ?? 0}`} institutionId={institutionId || null} current={query.data?.find((b) => b.isCurrent) ?? null} history={query.data ?? []} /> : null}
      <SettingsPanel />
    </div>
  );
}

type Branding = NonNullable<ReturnType<typeof useBranding>["data"]>[number];

function BrandingForm({ institutionId, current, history }: { institutionId: string | null; current: Branding | null; history: Branding[] }) {
  const t = useTranslations("v2Reportcards.identity");
  const date = useDateFormat();
  const put = usePutBranding();
  const flash = useFlash();
  const [form, setForm] = useState({
    legalName: current?.legalName ?? "",
    shortName: current?.shortName ?? "",
    headerLeft: (current?.headerLeft ?? []).join("\n"),
    headerRight: (current?.headerRight ?? []).join("\n"),
    address: current?.address ?? "",
    phone: current?.phone ?? "",
    email: current?.email ?? "",
    website: current?.website ?? "",
    registrationRef: current?.registrationRef ?? "",
    primaryColor: current?.primaryColor ?? "",
    secondaryColor: current?.secondaryColor ?? "",
    footerText: current?.footerText ?? "",
    logoObjectKey: current?.logoObjectKey ?? "",
    emblemObjectKey: current?.emblemObjectKey ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const nullable = (v: string) => (v.trim() === "" ? null : v.trim());

  async function submit() {
    const body = {
      institutionId,
      legalName: form.legalName,
      shortName: nullable(form.shortName),
      headerLeft: lines(form.headerLeft),
      headerRight: lines(form.headerRight),
      address: nullable(form.address),
      phone: nullable(form.phone),
      email: nullable(form.email),
      website: nullable(form.website),
      registrationRef: nullable(form.registrationRef),
      logoObjectKey: nullable(form.logoObjectKey),
      emblemObjectKey: nullable(form.emblemObjectKey),
      primaryColor: nullable(form.primaryColor),
      secondaryColor: nullable(form.secondaryColor),
      footerText: nullable(form.footerText),
    };
    const v = validateWith(reportcardsPutBrandingBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const saved = await put.mutateAsync(v.data);
      flash.show(t("saved", { version: saved.version }));
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <section aria-labelledby="brand-h" className="space-y-4">
      <h2 id="brand-h" className="text-lg font-semibold">
        {t("brandingTitle")}
      </h2>
      {current ? <p className="text-sm text-muted-foreground">{t("currentVersion", { version: current.version, date: date.instant(current.createdAt) })}</p> : <Notice kind="warning">{t("noBranding")}</Notice>}
      {flash.node}
      <form
        noValidate
        aria-label={t("brandingTitle")}
        className="max-w-3xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("legalName")} required error={errors.legalName}>
            {(c) => <TextControl {...c} value={form.legalName} onChange={set("legalName")} maxLength={200} />}
          </FormField>
          <FormField label={t("shortName")} error={errors.shortName}>
            {(c) => <TextControl {...c} value={form.shortName} onChange={set("shortName")} maxLength={60} />}
          </FormField>
          <FormField label={t("headerLeft")} error={errors.headerLeft} hint={t("linesHint")}>
            {(c) => <TextAreaControl {...c} value={form.headerLeft} onChange={set("headerLeft")} rows={4} />}
          </FormField>
          <FormField label={t("headerRight")} error={errors.headerRight} hint={t("linesHint")}>
            {(c) => <TextAreaControl {...c} value={form.headerRight} onChange={set("headerRight")} rows={4} />}
          </FormField>
          <FormField label={t("address")} error={errors.address}>
            {(c) => <TextControl {...c} value={form.address} onChange={set("address")} maxLength={300} />}
          </FormField>
          <FormField label={t("registrationRef")} error={errors.registrationRef}>
            {(c) => <TextControl {...c} value={form.registrationRef} onChange={set("registrationRef")} maxLength={120} />}
          </FormField>
          <FormField label={t("phone")} error={errors.phone}>
            {(c) => <TextControl {...c} type="tel" value={form.phone} onChange={set("phone")} maxLength={60} />}
          </FormField>
          <FormField label={t("email")} error={errors.email}>
            {(c) => <TextControl {...c} type="email" value={form.email} onChange={set("email")} maxLength={160} />}
          </FormField>
          <FormField label={t("website")} error={errors.website}>
            {(c) => <TextControl {...c} value={form.website} onChange={set("website")} maxLength={160} />}
          </FormField>
          <FormField label={t("footerText")} error={errors.footerText}>
            {(c) => <TextControl {...c} value={form.footerText} onChange={set("footerText")} maxLength={500} />}
          </FormField>
          <FormField label={t("primaryColor")} error={errors.primaryColor} hint={t("colorHint")}>
            {(c) => (
              <span className="flex items-center gap-2">
                <TextControl {...c} value={form.primaryColor} onChange={set("primaryColor")} maxLength={7} />
                {/^#[0-9A-Fa-f]{6}$/.test(form.primaryColor) ? <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded border" style={{ backgroundColor: form.primaryColor }} /> : null}
              </span>
            )}
          </FormField>
          <FormField label={t("secondaryColor")} error={errors.secondaryColor} hint={t("colorHint")}>
            {(c) => (
              <span className="flex items-center gap-2">
                <TextControl {...c} value={form.secondaryColor} onChange={set("secondaryColor")} maxLength={7} />
                {/^#[0-9A-Fa-f]{6}$/.test(form.secondaryColor) ? <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded border" style={{ backgroundColor: form.secondaryColor }} /> : null}
              </span>
            )}
          </FormField>
          <ImageUploadField kind="logo" label={t("logo")} value={form.logoObjectKey} onChange={set("logoObjectKey")} />
          <ImageUploadField kind="emblem" label={t("emblem")} value={form.emblemObjectKey} onChange={set("emblemObjectKey")} />
        </div>
        {put.error && Object.keys(errors).length === 0 ? <ErrorBlock error={put.error} /> : null}
        <button type="submit" className={buttonClass.primary} disabled={put.isPending}>
          {t("save")}
        </button>
      </form>
      {history.length > 1 ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{t("history", { count: history.length })}</summary>
          <ul className="mt-2 space-y-1">
            {history.map((b) => (
              <li key={b.id}>
                {t("historyLine", { version: b.version, name: b.legalName, date: date.instant(b.createdAt) })} {b.isCurrent ? <StatusBadge label={t("currentBadge")} tone="success" /> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function SettingsPanel() {
  const t = useTranslations("v2Reportcards.settings");
  const query = useReportcardsSettings();
  const update = useUpdateReportcardsSettings();
  const blockFeature = useFeature("reportcard.block-unpaid");
  const flash = useFlash();
  const [localError, setLocalError] = useState<unknown>(null);
  useEffect(() => setLocalError(null), [query.data]);
  if (query.isError || !query.data) return null;
  const s = query.data;

  async function patch(body: { blockIfUnpaid?: boolean; requireDeliberation?: boolean; verificationShowsMention?: boolean }) {
    setLocalError(null);
    try {
      await update.mutateAsync(body);
      flash.show(t("saved"));
    } catch (e) {
      setLocalError(e);
    }
  }

  return (
    <section aria-labelledby="settings-h" className="max-w-3xl space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 id="settings-h" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {flash.node}
      {localError ? <ErrorBlock error={localError} /> : null}
      <CheckControl checked={s.requireDeliberation} disabled={update.isPending} onChange={(v) => void patch({ requireDeliberation: v })} label={t("requireDeliberation")} hint={t("requireDeliberationHint")} />
      <CheckControl checked={s.verificationShowsMention} disabled={update.isPending} onChange={(v) => void patch({ verificationShowsMention: v })} label={t("showsMention")} hint={t("showsMentionHint")} />
      {blockFeature.allowed ? <CheckControl checked={s.blockIfUnpaid} disabled={update.isPending} onChange={(v) => void patch({ blockIfUnpaid: v })} label={t("blockIfUnpaid")} hint={t("blockIfUnpaidHint")} /> : null}
    </section>
  );
}
