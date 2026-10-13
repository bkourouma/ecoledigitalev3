"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cardDownloadPath, useFamilyReportCards } from "@/platform/v2/reportcards";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { DownloadButton } from "./shared";

/**
 * « Bulletins de mes enfants » / « Mes bulletins » : seulement les bulletins PUBLIÉS (jamais un brouillon, un provisoire ni un
 * bulletin révoqué) ; le lien de tutelle est revérifié par l'API à chaque lecture et à chaque téléchargement (journalisé).
 */
export function FamilyScreen() {
  const t = useTranslations("v2Reportcards.family");
  const date = useDateFormat();
  const query = useFamilyReportCards();
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const groups = useMemo(() => {
    const byStudent = new Map<string, { id: string; name: string; cards: typeof items }>();
    for (const c of items) {
      const g = byStudent.get(c.studentId) ?? { id: c.studentId, name: c.studentName, cards: [] };
      g.cards.push(c);
      byStudent.set(c.studentId, g);
    }
    return [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  }, [items]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`child-${g.id}`} className="space-y-2">
            <h2 id={`child-${g.id}`} className="text-lg font-semibold">
              {g.name}
            </h2>
            <ul className="space-y-2">
              {g.cards.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                  <span>
                    <span className="block font-medium">{c.title}</span>
                    <span className="block text-xs text-muted-foreground">{t("publishedOn", { date: date.instant(c.publishedAt) })}</span>
                  </span>
                  <DownloadButton path={cardDownloadPath(c.id)} label={t("download")} ariaLabel={t("downloadOf", { title: c.title, name: g.name })} variant="primary" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {query.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {t("more")}
          </button>
        </div>
      ) : null}
      {items.length > 0 ? <Notice kind="info" className="mt-6">{t("downloadNote")}</Notice> : null}
    </div>
  );
}
