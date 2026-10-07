"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AdmissionsApplicationDetailDto } from "@ecoledigitale/contracts/v2/admissions";
import { admissionsRecordConsentBodySchema } from "@ecoledigitale/contracts/v2/admissions";
import { fetchApplicationExport, useAdmissionsSettings, useConsentTexts, useAnonymizeApplication, useApplicationHistory, useDetectDuplicates, useRecordConsent, useResolveDuplicate } from "@/platform/v2/admissions";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

/** Tuteurs et consentements parentaux : le consentement est exigé par le workflow ; le personnel peut en consigner un (papier / délégation). */
export function DossierGuardians({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2Admissions.guardians");
  const tk = useTranslations("v2Admissions.consentKind");
  const tv = useTranslations("v2Admissions.consentVia");
  const fmt = useDateFormat();
  const [recording, setRecording] = useState(false);
  return (
    <section aria-labelledby="dossier-guardians" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="dossier-guardians" className="text-base font-semibold">
          {t("title")}
        </h2>
        <Can permission="admission.update">
          {!application.anonymized ? (
            <button type="button" className={buttonClass.secondary} onClick={() => setRecording(true)}>
              {t("recordConsent")}
            </button>
          ) : null}
        </Can>
      </div>
      <ul className="divide-y text-sm">
        {application.guardians.map((g) => (
          <li key={g.id} className="py-2">
            <p className="font-medium">
              {g.firstName} {g.lastName} <span className="text-xs text-muted-foreground">({g.relationshipCode})</span>
            </p>
            <p className="text-xs text-muted-foreground">{[g.phone, g.email].filter(Boolean).join(" · ")}</p>
            <p className="mt-1 flex flex-wrap gap-1">
              {g.isPrimary ? <StatusBadge label={t("primary")} tone="info" /> : null}
              {g.isFinancialResponsible ? <StatusBadge label={t("financial")} tone="neutral" /> : null}
            </p>
          </li>
        ))}
      </ul>
      <div>
        <h3 className="text-sm font-medium">{t("consents")}</h3>
        <p role="status" className="mt-1 text-sm">
          {application.hasValidConsent ? <StatusBadge label={t("consentValid")} tone="success" /> : <StatusBadge label={t("consentMissing")} tone="warning" />}
        </p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {application.consents.map((c) => (
            <li key={c.id}>
              {tk(c.kind)} · {c.textVersion.startsWith("v") ? c.textVersion : `v${c.textVersion}`} · {tv(c.givenVia)} · {fmt.instant(c.givenAt)}
              {c.withdrawnAt ? ` · ${t("withdrawn", { date: fmt.instant(c.withdrawnAt) })}` : ""}
            </li>
          ))}
        </ul>
      </div>
      {recording ? <ConsentDialog application={application} onClose={() => setRecording(false)} /> : null}
    </section>
  );
}

function ConsentDialog({ application, onClose }: { application: AdmissionsApplicationDetailDto; onClose: () => void }) {
  const t = useTranslations("v2Admissions.guardians");
  const tv = useTranslations("v2Admissions.consentVia");
  const settings = useAdmissionsSettings(application.institutionId);
  // Versions du texte de consentement en vigueur (lecture ouverte à l'agent d'admission, contrairement aux réglages) : liste de choix, la plus récente présélectionnée (QA C-04-01).
  const texts = useConsentTexts(application.institutionId);
  const activeVersions = [...(texts.data?.items ?? [])].filter((x) => x.retiredAt === null).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((x) => x.version).filter((v, i, all) => all.indexOf(v) === i);
  const record = useRecordConsent(application.id);
  const eligible = application.guardians.filter((g) => g.canConsent);
  const [guardianId, setGuardianId] = useState(eligible.find((g) => g.isPrimary)?.id ?? eligible[0]?.id ?? "");
  const [via, setVia] = useState("PAPER");
  const [evidence, setEvidence] = useState("");
  const [versionInput, setVersion] = useState<string | null>(null);
  const version = versionInput ?? settings.data?.consentTextVersion ?? activeVersions[0] ?? "";
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(record.error), ...errors };

  function submit() {
    const checked = validateWith(admissionsRecordConsentBodySchema, { guardianId, textVersion: version, givenVia: via, evidenceRef: evidence });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    record.mutate(checked.data, { onSuccess: onClose });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("consentTitle")} description={t("consentDescription")} submitLabel={t("consentSubmit")} onSubmit={submit} isPending={record.isPending} error={Object.keys(apiErrorToFieldErrors(record.error)).length === 0 ? record.error : undefined}>
      <FormField label={t("guardian")} required error={shown["guardianId"]}>
        {(c) => <NativeSelect {...c} value={guardianId} onChange={setGuardianId} placeholder={t("choose")} options={eligible.map((g) => ({ value: g.id, label: `${g.firstName} ${g.lastName}` }))} />}
      </FormField>
      <FormField label={t("textVersion")} required error={shown["textVersion"]}>
        {(c) => (activeVersions.length > 0 ? <NativeSelect {...c} value={version} onChange={setVersion} options={activeVersions.map((v) => ({ value: v, label: v }))} /> : <TextControl {...c} value={version} onChange={setVersion} maxLength={20} />)}
      </FormField>
      <FormField label={t("via")} error={shown["givenVia"]}>
        {(c) => <NativeSelect {...c} value={via} onChange={setVia} options={[{ value: "PAPER", label: tv("PAPER") }, { value: "STAFF_ON_BEHALF", label: tv("STAFF_ON_BEHALF") }]} />}
      </FormField>
      <FormField label={t("evidence")} hint={t("evidenceHint")} required error={shown["evidenceRef"]}>
        {(c) => <TextControl {...c} value={evidence} onChange={setEvidence} maxLength={300} />}
      </FormField>
    </FormDialog>
  );
}

/** Doublons détectés par l'API (score de ressemblance et motifs) : le personnel confirme ou écarte, la décision est journalisée. */
export function DossierDuplicates({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2Admissions.duplicates");
  const tst = useTranslations("v2Admissions.duplicateStatus");
  const tk = useTranslations("v2Admissions.duplicateKind");
  const describe = useDescribeError();
  const detect = useDetectDuplicates(application.id);
  const resolve = useResolveDuplicate(application.id);
  if (application.duplicates.length === 0) {
    return (
      <Can permission="admission.duplicate.resolve">
        <section aria-labelledby="dossier-duplicates" className="rounded-lg border p-4">
          <h2 id="dossier-duplicates" className="text-base font-semibold">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("none")}</p>
          <button type="button" className={`${buttonClass.secondary} mt-2`} disabled={detect.isPending} onClick={() => detect.mutate()}>
            {t("detect")}
          </button>
          {detect.error ? <Notice kind="error" className="mt-2">{describe(detect.error)}</Notice> : null}
        </section>
      </Can>
    );
  }
  return (
    <section aria-labelledby="dossier-duplicates" className="space-y-3 rounded-lg border border-amber-300 p-4">
      <h2 id="dossier-duplicates" className="text-base font-semibold">
        {t("title")}
      </h2>
      {resolve.error ? <Notice kind="error">{describe(resolve.error)}</Notice> : null}
      <ul className="divide-y text-sm">
        {application.duplicates.map((d) => (
          <li key={d.id} className="space-y-1 py-2">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{tk(d.matchedKind)}</span>
              <StatusBadge label={t("score", { score: d.score })} tone={d.score >= 80 ? "danger" : "warning"} />
              <StatusBadge label={tst(d.status)} tone={d.status === "OPEN" ? "warning" : "neutral"} />
            </p>
            <p className="text-xs text-muted-foreground">{d.reasons.join(", ")}</p>
            {d.status === "OPEN" ? (
              <Can permission="admission.duplicate.resolve">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass.secondary} disabled={resolve.isPending} onClick={() => resolve.mutate({ duplicateId: d.id, resolution: "CONFIRMED_DUPLICATE" })}>
                    {t("confirm")}
                  </button>
                  <button type="button" className={buttonClass.secondary} disabled={resolve.isPending} onClick={() => resolve.mutate({ duplicateId: d.id, resolution: "DISMISSED" })}>
                    {t("dismiss")}
                  </button>
                </div>
              </Can>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Historique : transitions d'étape et décisions formelles (journal en ajout seul côté base). Chargé à l'ouverture seulement. */
export function DossierHistory({ applicationId }: { applicationId: string }) {
  const t = useTranslations("v2Admissions.history");
  const tk = useTranslations("v2Admissions.decisionKind");
  const fmt = useDateFormat();
  const [open, setOpen] = useState(false);
  const history = useApplicationHistory(applicationId, open);
  return (
    <details className="rounded-lg border p-4" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-base font-semibold">{t("title")}</summary>
      <div className="mt-3 space-y-4">
        {open && history.isPending ? <LoadingBlock /> : null}
        {history.isError ? <ErrorBlock error={history.error} onRetry={() => void history.refetch()} /> : null}
        {history.data ? (
          <>
            <div>
              <h3 className="text-sm font-medium">{t("decisions")}</h3>
              {history.data.decisions.length === 0 ? <p className="text-sm text-muted-foreground">{t("noDecision")}</p> : null}
              <ol className="mt-1 space-y-2 text-sm">
                {history.data.decisions.map((d) => (
                  <li key={d.id} className="rounded-md border p-2">
                    <p className="font-medium">
                      {tk(d.kind)} · {fmt.instant(d.decidedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">{[d.reasonLabel ?? d.reasonCode, d.reasonText, d.conditions].filter(Boolean).join(" — ")}</p>
                    <p className="text-xs text-muted-foreground">{t("by", { name: d.decidedByName })}</p>
                    {d.overrideCapacity ? <StatusBadge className="mt-1" label={t("override")} tone="warning" /> : null}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="text-sm font-medium">{t("transitions")}</h3>
              <ol className="mt-1 space-y-1 text-sm">
                {history.data.transitions.map((x) => (
                  <li key={x.id}>
                    {fmt.instant(x.occurredAt)} · {x.fromStageLabel ?? t("creation")} → {x.toStageLabel}
                  </li>
                ))}
              </ol>
            </div>
          </>
        ) : null}
      </div>
    </details>
  );
}

/** Données personnelles : export du dossier (accès) et anonymisation motivée (irréversible, permission sensible). */
export function DossierPrivacy({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2Admissions.privacy");
  const describe = useDescribeError();
  const router = useRouter();
  const anonymize = useAnonymizeApplication(application.id);
  const [confirming, setConfirming] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  if (application.anonymized) return <Notice kind="info">{t("anonymized")}</Notice>;

  async function exportDossier() {
    setExportError(null);
    try {
      const data = await fetchApplicationExport(application.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dossier-${application.applicationNumber}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error);
    }
  }

  return (
    <section aria-labelledby="dossier-privacy" className="space-y-3 rounded-lg border p-4">
      <h2 id="dossier-privacy" className="text-base font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {exportError ? <Notice kind="error">{describe(exportError)}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Can permission="admission.export">
          <button type="button" className={buttonClass.secondary} onClick={() => void exportDossier()}>
            {t("export")}
          </button>
        </Can>
        <Can permission="admission.anonymize">
          <button type="button" className={buttonClass.danger} onClick={() => setConfirming(true)}>
            {t("anonymize")}
          </button>
        </Can>
      </div>
      {confirming ? (
        <ReasonDialog
          open
          onOpenChange={(o) => (!o ? setConfirming(false) : undefined)}
          title={t("anonymizeTitle")}
          description={t("anonymizeDescription")}
          reasonLabel={t("anonymizeReason")}
          confirmLabel={t("anonymize")}
          destructive
          minLength={10}
          isPending={anonymize.isPending}
          error={anonymize.error}
          onConfirm={(reason) =>
            anonymize.mutate(
              { reason },
              {
                onSuccess: () => {
                  setConfirming(false);
                  router.refresh();
                },
              },
            )
          }
        />
      ) : null}
    </section>
  );
}
