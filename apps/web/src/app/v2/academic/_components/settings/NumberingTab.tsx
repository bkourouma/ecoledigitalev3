"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { academicUpdateSettingsBodySchema, type AcademicSettingsDto, type AcademicUpdateSettingsBody } from "@ecoledigitale/contracts/v2/academic";
import { peopleSettingsPatchSchema, type PeopleSettingsDto, type PeopleSettingsPatch } from "@ecoledigitale/contracts/v2/people";
import { usePermission } from "@/platform/access";
import { useAcademicSettings } from "@/platform/v2/academic";
import { usePeopleSettings, useUpdateAcademicSettings, useUpdatePeopleSettings } from "@/platform/v2/settings";
import { CheckControl, FormField, TextControl } from "@/platform/ui/FormField";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { hasProblem, hasToken, parsePattern, PEOPLE_TOKENS, REGISTRATION_TOKENS, type TokenSpec } from "./numbering-utils";
import { SettingsSection } from "./shared";

/**
 * Aperçu de FORME d'un motif : texte fixe et jetons reconnus (avec leur explication), jetons inconnus signalés.
 * Aucun numéro n'est calculé ici.
 */
export function PatternPreview({ pattern, specs, requiredToken }: { pattern: string; specs: ReadonlyArray<TokenSpec>; requiredToken: string }) {
  const t = useTranslations("v2AcademicSettings.numbering.preview");
  const tToken = useTranslations("v2AcademicSettings.numbering.token");
  const parts = parsePattern(pattern.trim(), specs);
  if (pattern.trim() === "") return <p className="text-xs text-muted-foreground">{t("empty")}</p>;
  const problem = hasProblem(parts);
  const missing = !hasToken(parts, requiredToken);
  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3" aria-live="polite">
      <p className="text-xs font-medium text-muted-foreground">{t("title")}</p>
      <ul className="flex flex-wrap items-center gap-2" aria-label={t("title")}>
        {parts.map((p, i) =>
          p.kind === "text" ? (
            <li key={i}>
              <code className={`rounded border px-1.5 py-0.5 text-xs ${p.invalid ? "border-destructive text-destructive" : ""}`}>{p.text}</code>
              <span className="sr-only"> {p.invalid ? t("strayBrace") : t("fixedText")}</span>
            </li>
          ) : (
            <li key={i} className="flex items-center gap-1">
              <StatusBadge label={p.raw} tone={p.known ? "info" : "danger"} />
              <span className="text-xs text-muted-foreground">{p.known && p.name ? tToken(p.name as "PREFIX", { digits: p.digits ?? 0 }) : t("unknownToken")}</span>
            </li>
          ),
        )}
      </ul>
      {problem ? <p role="alert" className="text-xs font-medium text-destructive">{t("problem")}</p> : null}
      {!problem && missing ? <p className="text-xs font-medium text-amber-300">{t("missingSequence", { token: requiredToken === "SEQ" ? "{SEQ:n}" : "{STUDENT_SEQ:n}" })}</p> : null}
      <p className="text-xs text-muted-foreground">{t("serverNumbers")}</p>
    </div>
  );
}

/** Onglet « Numérotation » : numéro d'inscription (établissement) puis matricules élève / personnel et conservation (personnes). */
export function NumberingTab({ institutionId, canManage }: { institutionId: string | null; canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.numbering");
  const peopleManage = usePermission("people.settings.manage");
  const settings = useAcademicSettings(institutionId);
  return (
    <div className="space-y-10">
      <SettingsSection id="registration-numbering" title={t("registration.title")} description={t("registration.description")}>
        {institutionId === null ? <Notice kind="info">{t("noInstitution")}</Notice> : null}
        {settings.isPending && settings.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : null}
        {institutionId && settings.data ? <RegistrationForm key={JSON.stringify(settings.data)} institutionId={institutionId} settings={settings.data} canManage={canManage} /> : null}
      </SettingsSection>
      <SettingsSection id="people-numbering" title={t("people.title")} description={t("people.description")}>
        {peopleManage.isLoading ? <LoadingBlock /> : null}
        {!peopleManage.isLoading && !peopleManage.allowed ? <Notice kind="info">{t("people.noPermission")}</Notice> : null}
        {peopleManage.allowed ? <PeopleForm /> : null}
      </SettingsSection>
    </div>
  );
}

function RegistrationForm({ institutionId, settings, canManage }: { institutionId: string; settings: AcademicSettingsDto; canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.numbering.registration");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const update = useUpdateAcademicSettings();
  const flash = useFlash();
  const [form, setForm] = useState({ pattern: settings.registrationNumberPattern ?? "", prefix: settings.registrationNumberPrefix ?? "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [noChange, setNoChange] = useState(false);

  async function submit() {
    const patch: Record<string, unknown> = {};
    const pattern = form.pattern.trim() === "" ? null : form.pattern.trim();
    const prefix = form.prefix.trim() === "" ? null : form.prefix.trim();
    if (pattern !== settings.registrationNumberPattern) patch.registrationNumberPattern = pattern;
    if (prefix !== settings.registrationNumberPrefix) patch.registrationNumberPrefix = prefix;
    if (Object.keys(patch).length === 0) return setNoChange(true);
    setNoChange(false);
    const v = validateWith(academicUpdateSettingsBodySchema, patch);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await update.mutateAsync({ institutionId, patch: v.data as AcademicUpdateSettingsBody });
      flash.show(t("saved"));
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {flash.node}
      <FormField label={t("pattern")} hint={t("patternHint")} error={errors.registrationNumberPattern}>
        {(c) => <TextControl {...c} value={form.pattern} disabled={!canManage} maxLength={80} placeholder="{PREFIX}-{YEAR}-{STUDENT_SEQ:5}" onChange={(v) => setForm((f) => ({ ...f, pattern: v }))} />}
      </FormField>
      <PatternPreview pattern={form.pattern} specs={REGISTRATION_TOKENS} requiredToken="STUDENT_SEQ" />
      <FormField label={t("prefix")} hint={t("prefixHint")} error={errors.registrationNumberPrefix} className="max-w-xs">
        {(c) => <TextControl {...c} value={form.prefix} disabled={!canManage} maxLength={12} onChange={(v) => setForm((f) => ({ ...f, prefix: v.toUpperCase() }))} />}
      </FormField>
      {update.error ? <ErrorBlock error={update.error} /> : null}
      {noChange ? <Notice kind="info">{tCommon("noChange")}</Notice> : null}
      {canManage ? (
        <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
          {tCommon("save")}
        </button>
      ) : null}
    </form>
  );
}

function PeopleForm() {
  const settings = usePeopleSettings();
  return (
    <>
      {settings.isPending && settings.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : null}
      {settings.data ? <PeopleFormBody key={JSON.stringify(settings.data)} settings={settings.data} /> : null}
    </>
  );
}

function PeopleFormBody({ settings }: { settings: PeopleSettingsDto }) {
  const t = useTranslations("v2AcademicSettings.numbering.people");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const update = useUpdatePeopleSettings();
  const flash = useFlash();
  const [form, setForm] = useState({
    studentNumberPattern: settings.studentNumberPattern,
    staffNumberPattern: settings.staffNumberPattern,
    numberPrefix: settings.numberPrefix ?? "",
    duplicateCheckEnabled: settings.duplicateCheckEnabled,
    expiryAlertDays: settings.expiryAlertDays === null ? "" : String(settings.expiryAlertDays),
    studentRetentionDays: settings.studentRetentionDays === null ? "" : String(settings.studentRetentionDays),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [noChange, setNoChange] = useState(false);
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const patch: Record<string, unknown> = {};
    if (form.studentNumberPattern.trim() !== settings.studentNumberPattern) patch.studentNumberPattern = form.studentNumberPattern.trim();
    if (form.staffNumberPattern.trim() !== settings.staffNumberPattern) patch.staffNumberPattern = form.staffNumberPattern.trim();
    const prefix = form.numberPrefix.trim() === "" ? null : form.numberPrefix.trim();
    if (prefix !== settings.numberPrefix) patch.numberPrefix = prefix;
    if (form.duplicateCheckEnabled !== settings.duplicateCheckEnabled) patch.duplicateCheckEnabled = form.duplicateCheckEnabled;
    const alert = form.expiryAlertDays.trim() === "" ? null : Number(form.expiryAlertDays);
    if (alert !== settings.expiryAlertDays) patch.expiryAlertDays = alert;
    const retention = form.studentRetentionDays.trim() === "" ? null : Number(form.studentRetentionDays);
    if (retention !== settings.studentRetentionDays) patch.studentRetentionDays = retention;
    if (Object.keys(patch).length === 0) return setNoChange(true);
    setNoChange(false);
    const v = validateWith(peopleSettingsPatchSchema, patch);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await update.mutateAsync(v.data as PeopleSettingsPatch);
      flash.show(t("saved"));
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {flash.node}
      <FormField label={t("studentPattern")} hint={t("patternHint")} error={errors.studentNumberPattern}>
        {(c) => <TextControl {...c} value={form.studentNumberPattern} maxLength={80} placeholder="{YYYY}-{SEQ:4}" onChange={set("studentNumberPattern")} />}
      </FormField>
      <PatternPreview pattern={form.studentNumberPattern} specs={PEOPLE_TOKENS} requiredToken="SEQ" />
      <FormField label={t("staffPattern")} hint={t("patternHint")} error={errors.staffNumberPattern}>
        {(c) => <TextControl {...c} value={form.staffNumberPattern} maxLength={80} placeholder="{PREFIX}-{SEQ:4}" onChange={set("staffNumberPattern")} />}
      </FormField>
      <PatternPreview pattern={form.staffNumberPattern} specs={PEOPLE_TOKENS} requiredToken="SEQ" />
      <FormField label={t("prefix")} hint={t("prefixHint")} error={errors.numberPrefix} className="max-w-xs">
        {(c) => <TextControl {...c} value={form.numberPrefix} maxLength={12} onChange={(v) => set("numberPrefix")(v.toUpperCase())} />}
      </FormField>
      <CheckControl label={t("duplicates")} hint={t("duplicatesHint")} checked={form.duplicateCheckEnabled} onChange={set("duplicateCheckEnabled")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("expiryAlertDays")} hint={t("expiryAlertDaysHint")} error={errors.expiryAlertDays}>
          {(c) => <TextControl {...c} type="number" min={1} max={365} inputMode="numeric" value={form.expiryAlertDays} onChange={set("expiryAlertDays")} />}
        </FormField>
        <FormField label={t("retentionDays")} hint={t("retentionDaysHint")} error={errors.studentRetentionDays}>
          {(c) => <TextControl {...c} type="number" min={0} max={36500} inputMode="numeric" value={form.studentRetentionDays} onChange={set("studentRetentionDays")} />}
        </FormField>
      </div>
      {errors._ ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors._}
        </p>
      ) : null}
      {update.error ? <ErrorBlock error={update.error} /> : null}
      {noChange ? <Notice kind="info">{tCommon("noChange")}</Notice> : null}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {tCommon("save")}
      </button>
    </form>
  );
}
