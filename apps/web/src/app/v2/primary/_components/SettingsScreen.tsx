"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { primaryUpdateSettingsBodySchema, type PrimarySettingsDto, type PrimaryTemplateResultDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { QueryBoundary, useFlash } from "@/platform/ui/states";
import { validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useApplyPrimaryTemplate, usePrimaryScales, usePrimarySettings, useUpdatePrimarySettings } from "@/platform/v2/primary";
import { FrameworksSection } from "./FrameworksSection";
import { ScalesSection } from "./ScalesSection";
import { ConfirmActionDialog, PrimaryError, RuleBanner } from "./shared";

/** Paramètres du pack Primary : réglages d'établissement, modèle de pack, échelles et référentiels (écran sobre). */
export function SettingsScreen() {
  const t = useTranslations("v2PrimarySettings");
  const settings = usePrimarySettings();
  const canTemplate = usePermission("primary.template.apply").allowed;
  const canScales = usePermission("primary.scale.manage").allowed;
  const canFrameworkRead = usePermission("primary.framework.read").allowed;
  const canFrameworkManage = usePermission("primary.framework.manage").allowed;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner />
      <QueryBoundary query={settings}>{settings.data ? <SettingsForm initial={settings.data} /> : null}</QueryBoundary>
      {canTemplate ? <TemplateSection /> : null}
      {canScales || canFrameworkRead || canFrameworkManage ? <ScalesSection /> : null}
      {canFrameworkRead || canFrameworkManage ? <FrameworksSection /> : null}
    </div>
  );
}

function SettingsForm({ initial }: { initial: PrimarySettingsDto }) {
  const t = useTranslations("v2PrimarySettings.form");
  const update = useUpdatePrimarySettings();
  const scales = usePrimaryScales();
  const [homeroom, setHomeroom] = useState(initial.requireHomeroomForActivation);
  const [council, setCouncil] = useState(initial.councilRequiredForBilan);
  const [phrases, setPhrases] = useState(initial.phraseBankEnabled);
  const [scaleId, setScaleId] = useState(initial.defaultRatingScaleId ?? "");
  const [retention, setRetention] = useState(initial.archiveRetentionYears === null ? "" : String(initial.archiveRetentionYears));
  const [errors, setErrors] = useState<FieldErrors>({});
  const flash = useFlash();
  useEffect(() => {
    setHomeroom(initial.requireHomeroomForActivation);
    setCouncil(initial.councilRequiredForBilan);
    setPhrases(initial.phraseBankEnabled);
    setScaleId(initial.defaultRatingScaleId ?? "");
    setRetention(initial.archiveRetentionYears === null ? "" : String(initial.archiveRetentionYears));
  }, [initial]);

  async function submit() {
    flash.show(null);
    const years = retention.trim() === "" ? null : Number(retention);
    const v = validateWith(primaryUpdateSettingsBodySchema, {
      requireHomeroomForActivation: homeroom,
      councilRequiredForBilan: council,
      phraseBankEnabled: phrases,
      defaultRatingScaleId: scaleId || null,
      archiveRetentionYears: years,
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await update.mutateAsync(v.data);
      flash.show(t("saved"));
    } catch {
      /* affichée sous le formulaire */
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4 rounded-lg border p-4"
      aria-labelledby="primary-settings-title"
    >
      <h2 id="primary-settings-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {flash.node}
      <CheckControl checked={homeroom} onChange={setHomeroom} label={t("homeroom")} hint={t("homeroomHint")} />
      <CheckControl checked={council} onChange={setCouncil} label={t("council")} hint={t("councilHint")} />
      <CheckControl checked={phrases} onChange={setPhrases} label={t("phrases")} />
      <FormField label={t("defaultScale")} error={errors.defaultRatingScaleId}>
        {(c) => <NativeSelect {...c} value={scaleId} onChange={setScaleId} placeholder={t("noDefaultScale")} options={(scales.data ?? []).filter((s) => s.status === "ACTIVE").map((s) => ({ value: s.id, label: s.label }))} />}
      </FormField>
      <FormField label={t("retention")} hint={t("retentionHint")} error={errors.archiveRetentionYears}>
        {(c) => <TextControl {...c} type="number" inputMode="numeric" min={1} max={200} value={retention} onChange={setRetention} />}
      </FormField>
      <PrimaryError error={update.error} />
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {update.isPending ? t("saving") : t("save")}
      </button>
    </form>
  );
}

function TemplateSection() {
  const t = useTranslations("v2PrimarySettings.template");
  const apply = useApplyPrimaryTemplate();
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<PrimaryTemplateResultDto | null>(null);
  return (
    <section aria-labelledby="primary-template" className="space-y-3 rounded-lg border p-4">
      <h2 id="primary-template" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <button type="button" className={buttonClass.secondary} onClick={() => setConfirm(true)}>
        {t("apply")}
      </button>
      {result ? (
        <p role="status" className="text-sm font-medium">
          {result.alreadyApplied ? t("alreadyApplied") : t("done", { scales: result.created.scales, frameworks: result.created.frameworks, phrases: result.created.phrases })}
        </p>
      ) : null}
      <ConfirmActionDialog
        open={confirm}
        onOpenChange={(o) => {
          setConfirm(o);
          if (!o) apply.reset();
        }}
        title={t("dialog.title")}
        description={t("dialog.description")}
        confirmLabel={t("dialog.confirm")}
        isPending={apply.isPending}
        error={apply.error}
        onConfirm={() => apply.mutate(undefined, { onSuccess: (r) => { setResult(r); setConfirm(false); } })}
      />
    </section>
  );
}
