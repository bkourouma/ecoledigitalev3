"use client";

import { useTranslations } from "next-intl";
import type { ImportJobDto } from "@ecoledigitale/contracts/v2/imports";
import { Notice } from "@/platform/ui";
import { ProgressBar } from "./ProgressBar";

/** Étape 3 — Validation : le worker contrôle chaque ligne (schéma, règles, doublons, existant) ; progression en direct. */
export function ValidationStep({ job }: { job: ImportJobDto }) {
  const t = useTranslations("v2Imports.validation");
  return (
    <section aria-label={t("title")} className="space-y-4">
      <ProgressBar label={t("progress")} done={job.validationProgress} total={job.totalRows} />
      <Notice kind="info">{t("hint")}</Notice>
    </section>
  );
}
