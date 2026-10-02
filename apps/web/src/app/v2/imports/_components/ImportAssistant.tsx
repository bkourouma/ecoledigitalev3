"use client";

import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ImportUploadResult } from "@ecoledigitale/contracts/v2/imports";
import { usePermission } from "@/platform/access";
import { buttonClass, ErrorBlock, LoadingBlock, Notice, PageHeader, StatusBadge } from "@/platform/ui";
import { useImportJob, useImporters } from "@/platform/v2/imports";
import { MappingStep } from "./MappingStep";
import { PreviewStep } from "./PreviewStep";
import { ReportStep } from "./ReportStep";
import { RunStep } from "./RunStep";
import { UploadStep } from "./UploadStep";
import { ValidationStep } from "./ValidationStep";
import { ASSISTANT_STEPS, stepOf, toneOf, type AssistantStep } from "./import-utils";

/**
 * Assistant d'import en sept étapes (Upload, Mapping, Validation, Erreurs, Preview, Import, Rapport). L'ÉTAT vient du serveur :
 * l'étape affichée se déduit du statut de l'import (`stepOf`) ; on peut donc quitter la page et y revenir (liste des imports,
 * `/v2/imports/<id>`), recharger, ou suivre l'import depuis un autre appareil. Pas d'écriture ici : tout passe par l'API.
 */
export function ImportAssistant({ jobId }: { jobId?: string }) {
  const t = useTranslations("v2Imports");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ImportUploadResult | null>(null);
  const activeId = jobId ?? createdId;
  const job = useImportJob(activeId ?? null);
  const importers = useImporters();
  const canCancel = usePermission("imports.cancel").allowed;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step: AssistantStep = stepOf(job.data);
  const firstRender = useRef(true);

  // Le titre de l'étape reçoit le focus à chaque changement d'étape (annonce aux lecteurs d'écran).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const importer = job.data ? importers.data?.items.find((i) => i.key === job.data?.importerKey) : undefined;
  const stepIndex = ASSISTANT_STEPS.indexOf(step);

  return (
    <div>
      <PageHeader
        title={t("assistant.title")}
        description={job.data ? t("assistant.forFile", { file: job.data.fileName }) : t("assistant.description")}
        actions={
          job.data ? (
            <StatusBadge label={t(`status.${job.data.status}`)} tone={toneOf(job.data.status)} />
          ) : undefined
        }
      />

      <ol className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label={t("assistant.steps")}>
        {ASSISTANT_STEPS.map((s, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          return (
            <li key={s} aria-current={current ? "step" : undefined} className={`flex items-center gap-2 text-sm ${current ? "font-semibold text-primary" : done ? "text-foreground" : "text-muted-foreground"}`}>
              <span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${current ? "border-primary bg-primary text-primary-foreground" : done ? "border-emerald-500 bg-emerald-500 text-white" : "border-input"}`}>
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span>
                {t(`steps.${s}`)}
                {s === "validation" ? <span className="sr-only"> {t("steps.validationAlt")}</span> : null}
                {done ? <span className="sr-only"> ({t("assistant.done")})</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <h2 ref={headingRef} tabIndex={-1} className="mb-4 text-lg font-semibold focus:outline-none">
        {t(`stepTitle.${step}`)}
      </h2>

      {activeId && job.isLoading ? <LoadingBlock /> : null}
      {activeId && job.isError ? <ErrorBlock error={job.error} onRetry={() => void job.refetch()} /> : null}

      {!activeId ? (
        <UploadStep
          onUploaded={(r) => {
            setSuggestion(r);
            setCreatedId(r.job.id);
          }}
        />
      ) : null}

      {job.data && importer ? (
        <>
          {job.data.errorMessage && job.data.status === "MAPPED" ? <Notice kind="error" className="mb-4">{job.data.errorMessage}</Notice> : null}
          {step === "mapping" ? <MappingStep key={job.data.id + job.data.status} job={job.data} importer={importer} suggestion={suggestion} /> : null}
          {step === "validation" ? <ValidationStep job={job.data} /> : null}
          {step === "preview" ? <PreviewStep key={job.data.id + job.data.validatedAt} job={job.data} importer={importer} /> : null}
          {step === "import" ? <RunStep job={job.data} canCancel={canCancel} /> : null}
          {step === "report" ? <ReportStep job={job.data} importer={importer} /> : null}
          {(job.data.status === "UPLOADED" || job.data.status === "MAPPED" || job.data.status === "VALIDATED") && activeId ? (
            <p className="mt-6 text-sm text-muted-foreground">
              {t("assistant.resume")}{" "}
              <Link href={`/v2/imports/${activeId}`} className="underline underline-offset-2">
                {t("assistant.link")}
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
      {job.data && !importer && importers.isSuccess ? <Notice kind="warning">{t("assistant.unknownImporter")}</Notice> : null}
      {job.data && step === "report" ? null : null}
      <div className="mt-8">
        <Link href="/v2/imports" className={buttonClass.secondary}>
          {t("assistant.backToHistory")}
        </Link>
      </div>
    </div>
  );
}
