"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ACADEMIC_CONFIRMATION_POLICIES,
  ACADEMIC_COURSE_CONFIRMATION_POLICIES,
  academicUpdateSettingsBodySchema,
  type AcademicSettingsDto,
  type AcademicUpdateSettingsBody,
} from "@ecoledigitale/contracts/v2/academic";
import { useAcademicSettings } from "@/platform/v2/academic";
import { useUpdateAcademicSettings } from "@/platform/v2/settings";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { SettingsSection } from "./shared";

/** Un groupe de choix exclusifs avec l'explication de chaque option (liste de boutons radio natifs : clavier et lecteurs d'écran). */
function PolicyChoice<T extends string>({
  legend,
  hint,
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: string;
  hint: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; help: string }>;
  disabled: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold">{legend}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="space-y-2">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <div key={o.value} className={`flex items-start gap-3 rounded-xl border p-3 ${value === o.value ? "border-primary bg-primary/5" : ""}`}>
              <input id={id} type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} aria-describedby={`${id}-help`} className="mt-1 h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <label htmlFor={id} className="min-w-0 text-sm">
                <span className="block font-medium">{o.label}</span>
                <span id={`${id}-help`} className="block text-muted-foreground">
                  {o.help}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function PoliciesForm({ institutionId, settings, canManage }: { institutionId: string; settings: AcademicSettingsDto; canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.enrollments");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const update = useUpdateAcademicSettings();
  const flash = useFlash();
  const [form, setForm] = useState({
    enrollmentConfirmationPolicy: settings.enrollmentConfirmationPolicy,
    courseConfirmationPolicy: settings.courseConfirmationPolicy,
    pendingHoldMinutes: settings.pendingHoldMinutes === null ? "" : String(settings.pendingHoldMinutes),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [noChange, setNoChange] = useState(false);

  async function submit() {
    const patch: Record<string, unknown> = {};
    if (form.enrollmentConfirmationPolicy !== settings.enrollmentConfirmationPolicy) patch.enrollmentConfirmationPolicy = form.enrollmentConfirmationPolicy;
    if (form.courseConfirmationPolicy !== settings.courseConfirmationPolicy) patch.courseConfirmationPolicy = form.courseConfirmationPolicy;
    const hold = form.pendingHoldMinutes.trim() === "" ? null : Number(form.pendingHoldMinutes);
    if (hold !== settings.pendingHoldMinutes) patch.pendingHoldMinutes = hold;
    if (Object.keys(patch).length === 0) {
      setNoChange(true);
      return;
    }
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
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-6"
    >
      {flash.node}
      <PolicyChoice
        legend={t("enrollmentPolicy.legend")}
        hint={t("enrollmentPolicy.hint")}
        name="enrollment-policy"
        value={form.enrollmentConfirmationPolicy}
        disabled={!canManage}
        onChange={(v) => setForm((f) => ({ ...f, enrollmentConfirmationPolicy: v }))}
        options={ACADEMIC_CONFIRMATION_POLICIES.map((p) => ({ value: p, label: t(`policyLabel.${p}`), help: t(`policyHelp.${p}`) }))}
      />
      <PolicyChoice
        legend={t("coursePolicy.legend")}
        hint={t("coursePolicy.hint")}
        name="course-policy"
        value={form.courseConfirmationPolicy}
        disabled={!canManage}
        onChange={(v) => setForm((f) => ({ ...f, courseConfirmationPolicy: v }))}
        options={ACADEMIC_COURSE_CONFIRMATION_POLICIES.map((p) => ({ value: p, label: t(`coursePolicyLabel.${p}`), help: t(`coursePolicyHelp.${p}`) }))}
      />
      <FormField label={t("holdMinutes.label")} hint={t("holdMinutes.hint")} error={errors.pendingHoldMinutes} className="max-w-xs">
        {(c) => <TextControl {...c} type="number" min={1} max={525600} inputMode="numeric" disabled={!canManage} value={form.pendingHoldMinutes} onChange={(v) => setForm((f) => ({ ...f, pendingHoldMinutes: v }))} />}
      </FormField>
      {errors.enrollmentConfirmationPolicy || errors.courseConfirmationPolicy ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors.enrollmentConfirmationPolicy ?? errors.courseConfirmationPolicy}
        </p>
      ) : null}
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

/** Onglet « Inscriptions » : politique de confirmation automatique des inscriptions et des cours à la carte, durée de réservation. */
export function EnrollmentPoliciesTab({ institutionId, canManage }: { institutionId: string | null; canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.enrollments");
  const settings = useAcademicSettings(institutionId);
  return (
    <SettingsSection id="enrollment-policies" title={t("title")} description={t("description")}>
      {institutionId === null ? <Notice kind="info">{t("noInstitution")}</Notice> : null}
      {settings.isPending && settings.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : null}
      {institutionId && settings.data ? <PoliciesForm key={JSON.stringify(settings.data)} institutionId={institutionId} settings={settings.data} canManage={canManage} /> : null}
    </SettingsSection>
  );
}
