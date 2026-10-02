"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAgendaItem, useCouncil, useRebuildAgendaItem, useReviewAgendaItem } from "@/platform/v2/councils";
import { Can } from "@/platform/ui/AccessGate";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { useFlash } from "@/platform/ui/states";
import { CouncilStatusBar } from "./CouncilParts";
import { DecisionForm, DecisionsPanel, FactsPanel, ProposalsPanel, SuggestionsPanel } from "./ItemPanels";
import { ActionError, CouncilSubNav, CouncilsBoundary, EnumLabel, PlaceholderBanner, Section, councilTitle } from "./shared";

/**
 * Zone de travail d'un élève, partagée par la fiche et le mode séance : faits figés, suggestions étiquetées, propositions,
 * décisions, saisie d'une décision. `session` : version compacte pour la délibération (propositions repliées).
 */
export function ItemWorkArea({ councilId, itemId, variant }: { councilId: string; itemId: string; variant: "full" | "session" }) {
  const t = useTranslations("v2Councils.item");
  const item = useAgendaItem(itemId);
  const council = useCouncil(councilId);
  const rebuild = useRebuildAgendaItem();
  const review = useReviewAgendaItem();
  const flash = useFlash();
  const detail = item.data;
  return (
    <CouncilsBoundary query={item}>
      {detail ? (
        <div className="space-y-4">
          <PlaceholderBanner ruleSourceKind={detail.ruleSourceKind} />
          <div className="flex flex-wrap items-center gap-2">
            <EnumLabel group="status" value={detail.councilStatus} />
            <EnumLabel group="agendaStatus" value={detail.item.status} />
            {detail.item.missingResults ? <StatusBadge label={t("missingResults")} tone="warning" /> : null}
            <Can permission="council.session.run">
              <button type="button" className={buttonClass.secondary} disabled={review.isPending} onClick={() => review.mutate({ itemId }, { onSuccess: () => flash.show(t("reviewed")) })}>
                {t("markReviewed")}
              </button>
            </Can>
            <Can permission="council.prepare">
              <button type="button" className={buttonClass.secondary} disabled={rebuild.isPending} onClick={() => rebuild.mutate({ itemId }, { onSuccess: () => flash.show(t("rebuilt")) })}>
                {t("rebuild")}
              </button>
            </Can>
          </div>
          {flash.node}
          <ActionError error={review.error ?? rebuild.error} />
          <Section id="item-facts" title={t("factsTitle")}>
            <FactsPanel facts={detail.facts} factsVersion={detail.item.factsVersion} factsHash={detail.item.factsHash} compact={variant === "session"} />
          </Section>
          <SuggestionsPanel facts={detail.facts} />
          {variant === "full" ? <ProposalsPanel itemId={itemId} proposals={detail.proposals} /> : (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-semibold">{t("proposalsCount", { count: detail.proposals.length })}</summary>
              <div className="mt-3">
                <ProposalsPanel itemId={itemId} proposals={detail.proposals} />
              </div>
            </details>
          )}
          <DecisionsPanel decisions={detail.decisions} />
          {council.data ? <DecisionForm itemId={itemId} detail={detail} council={council.data} /> : null}
        </div>
      ) : null}
    </CouncilsBoundary>
  );
}

/** Fiche d'un élève dans un conseil (`/v2/councils/[councilId]/eleves/[itemId]`). */
export function StudentItemScreen({ councilId, itemId }: { councilId: string; itemId: string }) {
  const t = useTranslations("v2Councils.item");
  const item = useAgendaItem(itemId);
  const council = useCouncil(councilId);
  return (
    <div className="space-y-4">
      <PageHeader
        title={item.data ? item.data.item.studentName : t("title")}
        description={council.data ? councilTitle(council.data.council) : t("description")}
        actions={
          <Link href={`/v2/councils/${councilId}`} className={buttonClass.secondary}>
            {t("backToFile")}
          </Link>
        }
      />
      <CouncilSubNav councilId={councilId} current="file" />
      {council.data ? <CouncilStatusBar detail={council.data} compact /> : null}
      <ItemWorkArea councilId={councilId} itemId={itemId} variant="full" />
    </div>
  );
}
