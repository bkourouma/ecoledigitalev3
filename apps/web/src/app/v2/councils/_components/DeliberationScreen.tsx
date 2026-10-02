"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAgenda, useCouncil } from "@/platform/v2/councils";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice } from "@/platform/ui/states";
import { CouncilStatusBar } from "./CouncilParts";
import { CouncilSubNav, CouncilsBoundary, EnumLabel, PlaceholderBanner, councilTitle } from "./shared";
import { ItemWorkArea } from "./StudentItemScreen";

/**
 * Mode séance (mobile-first) : un élève à la fois, navigation précédent / suivant et saut direct, bandeau de quorum toujours
 * visible, faits résumés et saisie rapide d'une décision. Les composants sont ceux de la fiche élève.
 * L'élève courant n'est gardé qu'en mémoire de l'écran (aucune donnée du conseil dans le stockage du navigateur).
 */
export function DeliberationScreen({ councilId }: { councilId: string }) {
  const t = useTranslations("v2Councils.deliberation");
  const council = useCouncil(councilId);
  const agenda = useAgenda(councilId);
  const [index, setIndex] = useState(0);
  const items = [...(agenda.data?.items ?? [])].sort((a, b) => a.position - b.position);
  const safeIndex = Math.min(index, Math.max(items.length - 1, 0));
  const current = items[safeIndex];
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={council.data ? councilTitle(council.data.council) : t("description")} />
      <CouncilSubNav councilId={councilId} current="deliberation" />
      {council.data ? (
        <>
          <PlaceholderBanner ruleSourceKind={council.data.council.ruleSourceKind} />
          <div className="sticky top-0 z-10 bg-background/95 py-1 backdrop-blur">
            <CouncilStatusBar detail={council.data} compact />
          </div>
          {council.data.council.status !== "OPEN" ? <Notice kind="info">{t("notOpen")}</Notice> : null}
        </>
      ) : null}
      <CouncilsBoundary query={agenda} isEmpty={items.length === 0} empty={<EmptyBlock title={t("emptyTitle")} description={t("emptyHint")} action={<Link href={`/v2/councils/${councilId}`} className={buttonClass.secondary}>{t("backToFile")}</Link>} />}>
        {current ? (
          <div className="space-y-4">
            <nav aria-label={t("navLabel")} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end">
              <button type="button" className={buttonClass.secondary} disabled={safeIndex === 0} onClick={() => setIndex(safeIndex - 1)}>
                {t("previous")}
              </button>
              <FormField label={t("jump")} className="min-w-0 flex-1">
                {(c) => <NativeSelect {...c} value={current.id} onChange={(id) => setIndex(Math.max(items.findIndex((i) => i.id === id), 0))} options={items.map((i) => ({ value: i.id, label: `${i.position}. ${i.studentName}` }))} />}
              </FormField>
              <button type="button" className={buttonClass.primary} disabled={safeIndex >= items.length - 1} onClick={() => setIndex(safeIndex + 1)}>
                {t("next")}
              </button>
            </nav>
            <div aria-live="polite" className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{current.studentName}</h2>
              <span className="text-sm text-muted-foreground">{t("position", { position: safeIndex + 1, total: items.length })}</span>
              <EnumLabel group="agendaStatus" value={current.status} />
              <Link href={`/v2/councils/${councilId}/eleves/${current.id}`} className={buttonClass.ghost}>
                {t("openFile")}
              </Link>
            </div>
            <ItemWorkArea key={current.id} councilId={councilId} itemId={current.id} variant="session" />
          </div>
        ) : null}
      </CouncilsBoundary>
    </div>
  );
}
