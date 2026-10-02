"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ADMISSION_CAPACITY_POLICIES, ADMISSION_DUPLICATE_POLICIES, ADMISSION_WAITLIST_PROMOTIONS, admissionsUpdateSettingsBodySchema, type AdmissionsSettingsDto } from "@ecoledigitale/contracts/v2/admissions";
import { useAdmissionsLookups, useAdmissionsSettings, useInitializeInstitution, usePublicLinkAction, useUpdateAdmissionsSettings } from "@/platform/v2/admissions";
import { useFeature } from "@/platform/access";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CopyableValue } from "./AdmissionsShell";
import { SettingsReference } from "./SettingsReference";
import { parseInteger, publicFormLink, trackLink } from "./admissions-utils";

/** Réglages d'admission d'un établissement : politiques (capacité, doublons, liste d'attente), consentement, formulaire public. */
export function SettingsScreen() {
  const t = useTranslations("v2Admissions.settings");
  const lookups = useAdmissionsLookups();
  const institutions = lookups.data?.institutions ?? [];
  const [institutionId, setInstitutionId] = useState<string | undefined>(undefined);
  const effective = institutionId ?? (institutions.length === 1 ? institutions[0]?.id : undefined);
  const settings = useAdmissionsSettings(effective);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {institutions.length > 1 ? (
        <div className="max-w-md">
          <FormField label={t("institution")}>
            {(c) => <NativeSelect {...c} value={institutionId ?? ""} onChange={(v) => setInstitutionId(v || undefined)} placeholder={t("chooseInstitution")} options={institutions.map((i) => ({ value: i.id, label: i.name }))} />}
          </FormField>
        </div>
      ) : null}
      {institutions.length > 1 && !effective ? <p className="text-sm text-muted-foreground">{t("pickInstitution")}</p> : null}
      {settings.isPending && (effective || institutions.length <= 1) ? <LoadingBlock /> : null}
      {settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : null}
      {settings.data ? (
        <>
          <GeneralForm key={`${settings.data.institutionId}-${JSON.stringify(settings.data)}`} settings={settings.data} />
          <PublicLink settings={settings.data} />
          <SettingsReference institutionId={settings.data.institutionId} consentTextVersion={settings.data.consentTextVersion} />
        </>
      ) : null}
    </div>
  );
}

function GeneralForm({ settings }: { settings: AdmissionsSettingsDto }) {
  const t = useTranslations("v2Admissions.settings");
  const tp = useTranslations("v2Admissions.policy");
  const update = useUpdateAdmissionsSettings();
  const describe = useDescribeError();
  const flash = useFlash();
  const [capacityPolicy, setCapacityPolicy] = useState<string>(settings.capacityPolicy);
  const [duplicatePolicy, setDuplicatePolicy] = useState<string>(settings.duplicatePolicy);
  const [waitlistEnabled, setWaitlistEnabled] = useState(settings.waitlistEnabled);
  const [promotion, setPromotion] = useState<string>(settings.waitlistPromotion);
  const [consentRequired, setConsentRequired] = useState(settings.consentRequired);
  const [validity, setValidity] = useState(String(settings.offerValidityDays));
  const [deadline, setDeadline] = useState(settings.paymentDeadlineDays === null ? "" : String(settings.paymentDeadlineDays));
  const [retention, setRetention] = useState(settings.rejectedRetentionMonths === null ? "" : String(settings.rejectedRetentionMonths));
  const [minSeconds, setMinSeconds] = useState(String(settings.minimumFormSeconds));
  const [perTen, setPerTen] = useState(String(settings.submissionsPer10Min));
  const [captcha, setCaptcha] = useState(settings.captchaRequired);
  const [pattern, setPattern] = useState(settings.applicationNumberPattern);
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(update.error), ...errors };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      institutionId: settings.institutionId,
      capacityPolicy,
      duplicatePolicy,
      waitlistEnabled,
      waitlistPromotion: promotion,
      consentRequired,
      offerValidityDays: parseInteger(validity, 1, 365) ?? 0,
      paymentDeadlineDays: deadline.trim() === "" ? null : (parseInteger(deadline, 1, 365) ?? 0),
      rejectedRetentionMonths: retention.trim() === "" ? null : (parseInteger(retention, 1, 240) ?? 0),
      minimumFormSeconds: parseInteger(minSeconds, 0, 600) ?? -1,
      submissionsPer10Min: parseInteger(perTen, 1, 1000) ?? 0,
      captchaRequired: captcha,
      applicationNumberPattern: pattern.trim(),
    };
    const checked = validateWith(admissionsUpdateSettingsBodySchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    update.mutate(checked.data, { onSuccess: () => flash.show(t("saved")) });
  }

  return (
    <form noValidate onSubmit={submit} aria-label={t("general")} className="max-w-3xl space-y-4 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{t("general")}</h2>
      {flash.node}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("capacityPolicy")} hint={t("capacityPolicyHint")} error={shown["capacityPolicy"]}>
          {(c) => <NativeSelect {...c} value={capacityPolicy} onChange={setCapacityPolicy} options={ADMISSION_CAPACITY_POLICIES.map((p) => ({ value: p, label: tp(`capacity.${p}`) }))} />}
        </FormField>
        <FormField label={t("duplicatePolicy")} hint={t("duplicatePolicyHint")} error={shown["duplicatePolicy"]}>
          {(c) => <NativeSelect {...c} value={duplicatePolicy} onChange={setDuplicatePolicy} options={ADMISSION_DUPLICATE_POLICIES.map((p) => ({ value: p, label: tp(`duplicate.${p}`) }))} />}
        </FormField>
        <FormField label={t("promotion")} error={shown["waitlistPromotion"]}>
          {(c) => <NativeSelect {...c} value={promotion} onChange={setPromotion} options={ADMISSION_WAITLIST_PROMOTIONS.map((p) => ({ value: p, label: tp(`promotion.${p}`) }))} />}
        </FormField>
        <FormField label={t("offerValidity")} required error={shown["offerValidityDays"]}>
          {(c) => <TextControl {...c} inputMode="numeric" value={validity} onChange={setValidity} />}
        </FormField>
        <FormField label={t("paymentDeadline")} hint={t("paymentDeadlineHint")} error={shown["paymentDeadlineDays"]}>
          {(c) => <TextControl {...c} inputMode="numeric" value={deadline} onChange={setDeadline} />}
        </FormField>
        <FormField label={t("retention")} hint={t("retentionHint")} error={shown["rejectedRetentionMonths"]}>
          {(c) => <TextControl {...c} inputMode="numeric" value={retention} onChange={setRetention} />}
        </FormField>
        <FormField label={t("numberPattern")} hint={t("numberPatternHint")} error={shown["applicationNumberPattern"]}>
          {(c) => <TextControl {...c} value={pattern} onChange={setPattern} maxLength={60} />}
        </FormField>
      </div>
      <CheckControl checked={waitlistEnabled} onChange={setWaitlistEnabled} label={t("waitlistEnabled")} />
      <CheckControl checked={consentRequired} onChange={setConsentRequired} label={t("consentRequired")} hint={t("consentRequiredHint")} />
      <fieldset className="space-y-3 border-t pt-4">
        <legend className="text-sm font-semibold">{t("antiSpam")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("minSeconds")} hint={t("minSecondsHint")} error={shown["minimumFormSeconds"]}>
            {(c) => <TextControl {...c} inputMode="numeric" value={minSeconds} onChange={setMinSeconds} />}
          </FormField>
          <FormField label={t("perTen")} hint={t("perTenHint")} error={shown["submissionsPer10Min"]}>
            {(c) => <TextControl {...c} inputMode="numeric" value={perTen} onChange={setPerTen} />}
          </FormField>
        </div>
        <CheckControl checked={captcha} onChange={setCaptcha} label={t("captcha")} hint={t("captchaHint")} />
      </fieldset>
      {update.error && Object.keys(apiErrorToFieldErrors(update.error)).length === 0 ? <Notice kind="error">{describe(update.error)}</Notice> : null}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {t("save")}
      </button>
    </form>
  );
}

/** Lien public : création, activation / désactivation, rotation (l'ancien lien cesse aussitôt de fonctionner). */
function PublicLink({ settings }: { settings: AdmissionsSettingsDto }) {
  const t = useTranslations("v2Admissions.publicLink");
  const describe = useDescribeError();
  const enabledFeature = useFeature("admissions.public-form").allowed;
  const action = usePublicLinkAction();
  const initialize = useInitializeInstitution();
  const flash = useFlash();
  if (!enabledFeature) return null;
  const slug = settings.publicFormSlug;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <section aria-labelledby="public-link" className="max-w-3xl space-y-3 rounded-lg border p-4">
      <h2 id="public-link" className="text-base font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {flash.node}
      {action.error ? <Notice kind="error">{describe(action.error)}</Notice> : null}
      {initialize.error ? <Notice kind="error">{describe(initialize.error)}</Notice> : null}
      {slug ? (
        <>
          <p className="flex items-center gap-2 text-sm">
            <StatusBadge label={settings.publicFormLinkEnabled ? t("active") : t("inactive")} tone={settings.publicFormLinkEnabled ? "success" : "warning"} />
          </p>
          <CopyableValue label={t("formLink")} value={publicFormLink(origin, slug)} />
          <CopyableValue label={t("trackLink")} value={trackLink(origin, slug)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.secondary} disabled={action.isPending} onClick={() => action.mutate({ institutionId: settings.institutionId, enabled: !settings.publicFormLinkEnabled }, { onSuccess: () => flash.show(t("updated")) })}>
              {settings.publicFormLinkEnabled ? t("disable") : t("enable")}
            </button>
            <button type="button" className={buttonClass.secondary} disabled={action.isPending} onClick={() => action.mutate({ institutionId: settings.institutionId, rotate: true }, { onSuccess: () => flash.show(t("rotated")) })}>
              {t("rotate")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t("rotateHint")}</p>
        </>
      ) : (
        <button type="button" className={buttonClass.primary} disabled={action.isPending} onClick={() => action.mutate({ institutionId: settings.institutionId, enabled: true }, { onSuccess: () => flash.show(t("created")) })}>
          {t("create")}
        </button>
      )}
      <div className="border-t pt-3">
        <p className="text-sm">{t("initializeHint")}</p>
        <button type="button" className={`${buttonClass.secondary} mt-2`} disabled={initialize.isPending} onClick={() => initialize.mutate({ institutionId: settings.institutionId }, { onSuccess: () => flash.show(t("initialized")) })}>
          {t("initialize")}
        </button>
      </div>
    </section>
  );
}
