"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { resultsSettingsUpdateBodySchema, type resultsSettingsDtoSchema } from "@ecoledigitale/contracts/v2/results";
import type { z } from "zod";
import { useResultsSettings, useUpdateResultsSettings } from "@/platform/v2/results";
import { CheckControl, FormField, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

type Settings = z.infer<typeof resultsSettingsDtoSchema>;

/**
 * Réglages des résultats de l'établissement : délibération obligatoire avant la clôture d'une période, séparation du demandeur et
 * de l'approbateur des surcharges, temporisation du recalcul. Le web envoie les valeurs ; l'API décide (permission sensible, journal
 * d'audit renforcé quand un garde-fou est relâché). Jusqu'ici ces réglages n'étaient modifiables par aucun écran (L-22).
 */
export function SettingsScreen() {
  const t = useTranslations("v2Results.settings");
  const settings = useResultsSettings();
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <QueryBoundary query={settings}>{settings.data ? <SettingsForm key={settings.data.updatedAt ?? "initial"} settings={settings.data} /> : null}</QueryBoundary>
    </div>
  );
}

function SettingsForm({ settings }: { settings: Settings }) {
  const t = useTranslations("v2Results.settings");
  const update = useUpdateResultsSettings();
  const flash = useFlash();
  const [deliberation, setDeliberation] = useState(settings.requireDeliberation);
  const [separate, setSeparate] = useState(settings.requireSeparateApprover);
  const [delay, setDelay] = useState(String(settings.recomputeDelaySeconds));
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(update.error);
  const relaxing = (settings.requireDeliberation && !deliberation) || (settings.requireSeparateApprover && !separate);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const seconds = /^\d+$/.test(delay.trim()) ? Number(delay.trim()) : -1;
    const v = validateWith(resultsSettingsUpdateBodySchema, { requireDeliberation: deliberation, requireSeparateApprover: separate, recomputeDelaySeconds: seconds });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    update.mutate(v.data, { onSuccess: () => flash.show(t("saved")) });
  }

  return (
    <form noValidate onSubmit={submit} aria-label={t("title")} className="max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-card/40 p-4">
      {flash.node}
      <CheckControl checked={deliberation} onChange={setDeliberation} label={t("requireDeliberation")} hint={t("requireDeliberationHint")} />
      <CheckControl checked={separate} onChange={setSeparate} label={t("requireSeparateApprover")} hint={t("requireSeparateApproverHint")} />
      <FormField label={t("recomputeDelay")} hint={t("recomputeDelayHint")} error={errors.recomputeDelaySeconds ?? apiErrors.recomputeDelaySeconds}>
        {(c) => <TextControl {...c} inputMode="numeric" value={delay} onChange={setDelay} />}
      </FormField>
      {relaxing ? <Notice kind="warning">{t("relaxWarning")}</Notice> : null}
      {update.error && Object.keys(apiErrors).length === 0 ? <Notice kind="error">{update.error instanceof Error ? update.error.message : t("failed")}</Notice> : null}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {t("save")}
      </button>
    </form>
  );
}
