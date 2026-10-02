"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { cardDownloadPath, useFamilyReportCards } from "@/platform/v2/reportcards";
import { familyReceiptPdfPath, learnerIdOf, useChildReportCards, useFamilyHigherDocuments, useFamilyLabels, useFamilyReceipts, type FamilySubject } from "@/platform/v2/portal";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { PageHeader } from "@/platform/ui/PageHeader";
import { PdfButton } from "@/platform/ui/PdfButton";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { DownloadButton } from "../reportcards/_components/shared";

/**
 * Documents de l'élève ou de l'enfant, au même endroit : bulletins publiés, reçus de paiement (PDF scellé), diplômes et
 * attestations publiés. Chaque rubrique n'apparaît que si le droit de lecture est accordé ; téléchargements contrôlés.
 */
export function FamilyDocuments({ subject, title, receiptHref }: { subject: FamilySubject; title: string; receiptHref: (receiptId: string) => string }) {
  const t = useTranslations("v2Portal.family.documents");
  const own = subject.kind === "me";
  const canCards = usePermission(own ? "reportcard.self.read" : "reportcard.child.read").allowed;
  const canFinance = usePermission(own ? "finance.self.read" : "finance.child.read").allowed;
  const canHigher = usePermission(own ? "higher.self.read" : "higher.child.read").allowed;
  return (
    <div className="space-y-8">
      <PageHeader title={title} description={t("description")} />
      {canCards ? <CardsSection subject={subject} /> : null}
      {canFinance ? <ReceiptsSection subject={subject} receiptHref={receiptHref} /> : null}
      {canHigher ? <HigherSection subject={subject} /> : null}
      {!canCards && !canFinance && !canHigher ? <EmptyBlock title={t("none")} /> : null}
    </div>
  );
}

function CardsSection({ subject }: { subject: FamilySubject }) {
  const t = useTranslations("v2Portal.family.documents.cards");
  const date = useDateFormat();
  const labels = useFamilyLabels(subject);
  const own = useFamilyReportCards(subject.kind === "me");
  const child = useChildReportCards(subject.kind === "child" ? subject.id : null);
  const query = subject.kind === "me" ? own : child;
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  return (
    <section aria-labelledby="doc-cards" className="space-y-2">
      <h2 id="doc-cards" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {query.isPending ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && items.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="divide-y rounded-md border text-sm">
        {items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span>
              <span className="block font-medium">{c.title}</span>
              <span className="block text-xs text-muted-foreground">{[labels.period(c.academicPeriodId), date.instant(c.publishedAt ?? c.issuedAt)].filter(Boolean).join(" · ")}</span>
            </span>
            <DownloadButton path={cardDownloadPath(c.id)} label={t("download")} ariaLabel={t("downloadOf", { title: c.title })} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReceiptsSection({ subject, receiptHref }: { subject: FamilySubject; receiptHref: (id: string) => string }) {
  const t = useTranslations("v2Portal.family.documents.receipts");
  const money = useMoney();
  const date = useDateFormat();
  const learnerId = learnerIdOf(subject);
  const receipts = useFamilyReceipts(learnerId, { limit: 50 });
  return (
    <section aria-labelledby="doc-receipts" className="space-y-2">
      <h2 id="doc-receipts" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {learnerId === null || receipts.isPending ? <LoadingBlock /> : null}
      {receipts.isError ? <ErrorBlock error={receipts.error} onRetry={() => void receipts.refetch()} /> : null}
      {receipts.data && receipts.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="divide-y rounded-md border text-sm">
        {(receipts.data?.items ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <Link href={receiptHref(r.id)} className="font-medium text-primary underline-offset-4 hover:underline">
              {r.number}
            </Link>
            <span className="text-muted-foreground">{date.instant(r.issuedAt)}</span>
            <span className="tabular-nums">{money.of(r.amount)}</span>
            {learnerId ? <PdfButton path={familyReceiptPdfPath(learnerId, r.id)} fileName={`recu-${r.number}.pdf`} label={t("pdf")} ariaLabel={t("pdfOf", { number: r.number })} variant="ghost" /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HigherSection({ subject }: { subject: FamilySubject }) {
  const t = useTranslations("v2Portal.family.documents.higher");
  const tKind = useTranslations("v2Higher.documentKind");
  const date = useDateFormat();
  const docs = useFamilyHigherDocuments(subject);
  // La fonction « supérieur » peut être absente de l'offre : l'API répond alors par un refus, la rubrique disparaît sans bruit.
  if (docs.isPending) return <LoadingBlock />;
  if (docs.isError || docs.data.length === 0) return null;
  return (
    <section aria-labelledby="doc-higher" className="space-y-2">
      <h2 id="doc-higher" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <ul className="divide-y rounded-md border text-sm">
        {docs.data.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span>
              <span className="block font-medium">{tKind(d.documentKind as never)}</span>
              <span className="block text-xs text-muted-foreground">{t("meta", { reference: d.reference, date: date.instant(d.publishedAt ?? d.issuedAt) })}</span>
            </span>
            <Link href={`/v2/verify/${d.verificationCode}`} className="text-primary underline-offset-4 hover:underline">
              {t("verify")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
