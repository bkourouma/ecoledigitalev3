"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { DocumentSettingsDto } from "@ecoledigitale/contracts/v2/documents";
import { useDocumentSettings, useDocumentUsage, useUpdateDocumentSettings } from "@/platform/v2/documents";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { formatFileSize } from "@/platform/ui/UploadDropzone";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { bytesToMiB, mibToBytes, parseAlertDays } from "./documents-utils";

function UsageMeter() {
  const t = useTranslations("v2Documents.settings.usage");
  const usage = useDocumentUsage();
  if (usage.isPending) return <LoadingBlock />;
  if (usage.isError) return <ErrorBlock error={usage.error} onRetry={() => void usage.refetch()} />;
  const u = usage.data;
  const percent = Math.min(100, Math.round((u.usedBytes / u.quotaBytes) * 100));
  return (
    <section aria-labelledby="usage-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="usage-title" className="text-base font-semibold">{t("title")}</h2>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("meter")} className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className={percent >= 90 ? "h-full bg-red-600" : percent >= 75 ? "h-full bg-amber-500" : "h-full bg-primary"} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm">{t("summary", { used: formatFileSize(u.usedBytes), quota: formatFileSize(u.quotaBytes), percent })}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">{t("documents")}</dt><dd>{u.documentCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("versions")}</dt><dd>{u.versionCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("archived")}</dt><dd>{u.archivedCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("quarantine")}</dt><dd>{u.quarantineHeldCount}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("plan", { plan: formatFileSize(u.planQuotaBytes) })}</p>
    </section>
  );
}

function SettingsForm({ settings }: { settings: DocumentSettingsDto }) {
  const t = useTranslations("v2Documents.settings.form");
  const mutation = useUpdateDocumentSettings();
  const flash = useFlash();
  const [maxMiB, setMaxMiB] = useState(bytesToMiB(settings.maxBytes));
  const [quotaMiB, setQuotaMiB] = useState(settings.storageQuotaBytes ? bytesToMiB(settings.storageQuotaBytes) : "");
  const [alertText, setAlertText] = useState(settings.defaultAlertDays.join(", "));
  const [retention, setRetention] = useState(String(settings.archiveRetentionDays));
  const [quarantine, setQuarantine] = useState(String(settings.quarantineRetentionDays));
  const [versions, setVersions] = useState(String(settings.maxVersions));
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);

  useEffect(() => {
    setMaxMiB(bytesToMiB(settings.maxBytes));
  }, [settings.maxBytes]);

  const maxBytes = mibToBytes(maxMiB);
  const quotaBytes = quotaMiB.trim() ? mibToBytes(quotaMiB) : null;
  const alertDays = parseAlertDays(alertText);
  const int = (s: string, min: number, max: number): number | null => (/^\d+$/.test(s.trim()) && Number(s) >= min && Number(s) <= max ? Number(s) : null);
  const problems = {
    max: maxBytes === null || maxBytes > 100 * 1024 * 1024 ? t("errors.max") : null,
    quota: quotaMiB.trim() && quotaBytes === null ? t("errors.quota") : null,
    alert: alertDays === null ? t("errors.alert") : null,
    retention: int(retention, 0, 3650) === null ? t("errors.retention") : null,
    quarantine: int(quarantine, 1, 365) === null ? t("errors.quarantine") : null,
    versions: int(versions, 1, 500) === null ? t("errors.versions") : null,
  };
  const invalid = Object.values(problems).some(Boolean);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmitted(true);
    if (invalid || maxBytes === null || alertDays === null) return;
    mutation.mutate(
      { maxBytes, storageQuotaBytes: quotaBytes, defaultAlertDays: alertDays, archiveRetentionDays: Number(retention), quarantineRetentionDays: Number(quarantine), maxVersions: Number(versions) },
      { onSuccess: () => flash.show(t("saved")) },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border p-4" aria-labelledby="settings-title">
      <h2 id="settings-title" className="text-base font-semibold">{t("title")}</h2>
      {flash.node}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("maxMiB")} hint={t("maxHint")} error={submitted ? problems.max : (errors.maxBytes ?? null)}>{(c) => <TextControl {...c} inputMode="decimal" value={maxMiB} onChange={setMaxMiB} />}</FormField>
        <FormField label={t("quotaMiB")} hint={t("quotaHint")} error={submitted ? problems.quota : (errors.storageQuotaBytes ?? null)}>{(c) => <TextControl {...c} inputMode="decimal" value={quotaMiB} onChange={setQuotaMiB} />}</FormField>
        <FormField label={t("alertDays")} hint={t("alertDaysHint")} error={submitted ? problems.alert : null}>{(c) => <TextControl {...c} value={alertText} onChange={setAlertText} />}</FormField>
        <FormField label={t("retention")} hint={t("retentionHint")} error={submitted ? problems.retention : null}>{(c) => <TextControl {...c} type="number" min={0} max={3650} value={retention} onChange={setRetention} />}</FormField>
        <FormField label={t("quarantine")} hint={t("quarantineHint")} error={submitted ? problems.quarantine : null}>{(c) => <TextControl {...c} type="number" min={1} max={365} value={quarantine} onChange={setQuarantine} />}</FormField>
        <FormField label={t("versions")} hint={t("versionsHint")} error={submitted ? problems.versions : null}>{(c) => <TextControl {...c} type="number" min={1} max={500} value={versions} onChange={setVersions} />}</FormField>
      </div>
      {mutation.isError ? <ErrorBlock error={mutation.error} /> : null}
      <div className="flex justify-end">
        <button type="submit" disabled={mutation.isPending} className={buttonClass.primary}>{mutation.isPending ? t("saving") : t("save")}</button>
      </div>
    </form>
  );
}

/** Paramètres de l'établissement : taille maximale, quota, seuils d'alerte, rétention ; usage de stockage. */
export function SettingsScreen() {
  const t = useTranslations("v2Documents.settings");
  const settings = useDocumentSettings();
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <UsageMeter />
      {settings.isPending ? <LoadingBlock /> : settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : <SettingsForm settings={settings.data} />}
      <Notice kind="info">{t("environmentNote")}</Notice>
    </div>
  );
}
