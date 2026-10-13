"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { HigherAwardDto } from "@ecoledigitale/contracts/v2/higher";
import { usePermission } from "@/platform/access";
import { useDocuments } from "@/platform/v2/higher";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { toneOfStatus } from "../../assessments/_components/shared";
import { DocumentPdfActions, PdfStateBadge, SealBadge, VerifyLink } from "./DocumentPdf";

/** Documents émis pour un octroi (diplôme, duplicata, attestation) avec leur PDF : chargés à la demande, une liste par étudiant. */
export function AwardDocuments({ award }: { award: HigherAwardDto }) {
  const t = useTranslations("v2HigherPdf.award");
  const tKind = useTranslations("v2Higher.documentKind");
  const tStatus = useTranslations("v2Higher.documentStatus");
  const canRead = usePermission("higher.document.read");
  const [open, setOpen] = useState(false);
  const query = useDocuments({ studentId: award.studentId }, open && canRead.allowed);
  if (!canRead.allowed) return null;
  const docs = (query.data?.pages.flatMap((p) => p.items) ?? []).filter((d) => d.awardId === award.id);
  return (
    <div className="space-y-2">
      <button type="button" className={buttonClass.ghost} aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`${open ? t("hide") : t("show")} — ${award.reference}`}>
        {open ? t("hide") : t("show")}
      </button>
      {open ? (
        <div className="space-y-2" aria-live="polite">
          {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
          {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
          {query.data && docs.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
          {docs.length > 0 ? (
            <ul className="space-y-2" aria-label={t("listLabel", { reference: award.reference })}>
              {docs.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="font-medium">
                      {tKind(d.documentKind)} <span className="font-mono text-xs font-normal text-muted-foreground">{d.reference} · {t("version", { n: d.version })}</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge label={tStatus(d.status)} tone={toneOfStatus(d.status)} />
                      <SealBadge sealed={d.sealed} />
                      <PdfStateBadge doc={d} />
                    </div>
                    <VerifyLink code={d.verificationCode} />
                  </div>
                  <DocumentPdfActions doc={d} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
