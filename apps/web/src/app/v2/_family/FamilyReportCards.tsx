"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import type { reportcardsReportCardDtoSchema } from "@ecoledigitale/contracts/v2/reportcards";
import { cardDownloadPath, useFamilyReportCards } from "@/platform/v2/reportcards";
import { useChildReportCards, useFamilyLabels, type FamilySubject } from "@/platform/v2/portal";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { QrCode } from "@/platform/ui/QrCode";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { DownloadButton } from "../reportcards/_components/shared";

type Card = z.infer<typeof reportcardsReportCardDtoSchema>;

/**
 * Bulletins PUBLIÉS de l'élève ou d'un enfant lié (jamais un brouillon, un provisoire ni un bulletin révoqué : filtre de l'API).
 * Téléchargement contrôlé (URL signée de courte durée demandée à l'API, accès des familles journalisé), code et QR de vérification
 * publique (aucune donnée personnelle sur la page de vérification).
 */
export function FamilyReportCards({ subject, title }: { subject: FamilySubject; title: string }) {
  const t = useTranslations("v2Portal.family.reportcards");
  const date = useDateFormat();
  const labels = useFamilyLabels(subject);
  const own = useFamilyReportCards(subject.kind === "me");
  const child = useChildReportCards(subject.kind === "child" ? subject.id : null);
  const query = subject.kind === "me" ? own : child;
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={t("description")} />
      {query.isPending ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <ul className="space-y-3">
        {items.map((c) => (
          <li key={c.id}>
            <CardRow card={c} periodLabel={labels.period(c.academicPeriodId)} issued={date.instant(c.publishedAt ?? c.issuedAt)} />
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {t("more")}
          </button>
        </div>
      ) : null}
      {items.length > 0 ? <Notice kind="info">{t("downloadNote")}</Notice> : null}
    </div>
  );
}

function CardRow({ card, periodLabel, issued }: { card: Card; periodLabel: string | null; issued: string }) {
  const t = useTranslations("v2Portal.family.reportcards");
  const [showVerify, setShowVerify] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const verifyUrl = `${origin}/v2/verify/${card.verificationCode}`;
  return (
    <article aria-label={card.title} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{card.title}</h2>
          <p className="text-sm text-muted-foreground">{[periodLabel, card.studentName].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-muted-foreground">{t("publishedOn", { date: issued })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {card.provisional ? <StatusBadge label={t("provisional")} tone="warning" /> : null}
          <DownloadButton path={cardDownloadPath(card.id)} label={t("download")} ariaLabel={t("downloadOf", { title: card.title })} variant="primary" />
          <button type="button" className={buttonClass.secondary} aria-expanded={showVerify} onClick={() => setShowVerify((v) => !v)}>
            {t("verification")}
          </button>
        </div>
      </div>
      {showVerify ? (
        <div className="flex flex-wrap items-start gap-4 rounded-md border bg-muted/30 p-3">
          <QrCode value={verifyUrl} label={t("qrLabel")} size={128} />
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("code")}</dt>
              <dd className="font-mono text-base font-semibold tracking-wider" data-testid="verification-code">
                {card.verificationCode}
              </dd>
            </div>
          </dl>
          <div className="space-y-2 text-sm">
            <Link href={`/v2/verify/${card.verificationCode}`} className="text-primary underline-offset-4 hover:underline">
              {t("openVerify")}
            </Link>
            <p className="max-w-xs text-xs text-muted-foreground">{t("verifyHint")}</p>
          </div>
        </div>
      ) : null}
    </article>
  );
}

