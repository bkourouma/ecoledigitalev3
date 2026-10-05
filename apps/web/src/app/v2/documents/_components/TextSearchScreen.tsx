"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText, RefreshCw } from "lucide-react";
import type { DocumentTextHitDto, DocumentTextSnippetSegment } from "@ecoledigitale/contracts/v2/documents";
import { DOCUMENT_TEXT_INDEX_STATUSES, DOCUMENT_TEXT_SEARCH_LIMITS } from "@ecoledigitale/contracts/v2/documents";
import { useDocumentCategories, useDocumentTextSearch, useMyDocumentsContext, useReindexDocumentTexts, useTextIndexStatus } from "@/platform/v2/documents";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { StepUpDialog } from "@/platform/ui/StepUpDialog";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useDebounced } from "@/platform/ui/useDebounced";
import { useStepUp } from "@/platform/ui/useStepUp";
import { confidentialityTone } from "./documents-utils";

/**
 * Extrait d'un résultat : les segments sont du TEXTE BRUT (l'API ne renvoie jamais de HTML) ; les mots trouvés sont enveloppés dans
 * `<mark>` par React, sans `dangerouslySetInnerHTML`. Un contenu qui ressemble à du HTML s'affiche donc tel quel.
 */
export function Snippet({ segments }: { segments: readonly DocumentTextSnippetSegment[] }) {
  return (
    <p className="text-sm leading-relaxed text-foreground/90" data-testid="snippet">
      {segments.map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-500/40">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

function Hit({ hit }: { hit: DocumentTextHitDto }) {
  const t = useTranslations("v2Documents");
  const d = hit.document;
  return (
    <li>
      <Link href={`/v2/documents/${d.id}`} className="block space-y-1.5 rounded-lg border p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{d.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {d.categoryLabel}
              {d.ownerName ? ` · ${d.ownerName}` : ""}
            </p>
          </div>
          {d.confidentiality !== "INTERNAL" ? <StatusBadge label={t(`confidentiality.${d.confidentiality}`)} tone={confidentialityTone(d.confidentiality)} /> : null}
        </div>
        <Snippet segments={hit.snippet} />
        {hit.truncated ? (
          <p className="text-xs text-muted-foreground">{t("textSearch.truncated", { read: hit.pagesIndexed ?? 0, total: hit.pageCount ?? 0 })}</p>
        ) : null}
      </Link>
    </li>
  );
}

/** Pied de page de la gestion : état de l'index et réindexation (MFA). */
function IndexAdmin() {
  const t = useTranslations("v2Documents.textAdmin");
  const status = useTextIndexStatus();
  const reindex = useReindexDocumentTexts();
  const stepUp = useStepUp();
  const [confirmAll, setConfirmAll] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);

  const run = (scope: "FAILED" | "ALL") => {
    setQueued(null);
    void stepUp
      .run(() => reindex.mutateAsync({ scope }))
      .then(
        (r) => {
          setQueued(r.queued);
          setConfirmAll(false);
        },
        () => undefined,
      );
  };

  return (
    <section aria-labelledby="text-index-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="text-index-title" className="text-base font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {status.isPending ? (
        <LoadingBlock />
      ) : status.isError ? (
        <ErrorBlock error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DOCUMENT_TEXT_INDEX_STATUSES.map((s) => (
              <div key={s} className="rounded-md bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground">{t(`counts.${s}`)}</dt>
                <dd className="text-xl font-semibold tabular-nums">{status.data.counts[s]}</dd>
              </div>
            ))}
          </dl>
          {status.data.failures.length > 0 ? (
            <ul aria-label={t("failuresLabel")} className="space-y-1 text-sm">
              {status.data.failures.map((f) => (
                <li key={f.errorCode}>
                  {t("failure", { cause: t.has(`errors.${f.errorCode}`) ? t(`errors.${f.errorCode}`) : f.errorCode, count: f.count })}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass.secondary} onClick={() => run("FAILED")} disabled={reindex.isPending}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t("retryFailed")}
        </button>
        {confirmAll ? (
          <>
            <button type="button" className={buttonClass.primary} onClick={() => run("ALL")} disabled={reindex.isPending}>
              {t("confirmAll")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setConfirmAll(false)}>
              {t("cancel")}
            </button>
          </>
        ) : (
          <button type="button" className={buttonClass.secondary} onClick={() => setConfirmAll(true)} disabled={reindex.isPending}>
            {t("reindexAll")}
          </button>
        )}
      </div>
      {confirmAll ? <Notice kind="warning">{t("confirmAllHint")}</Notice> : null}
      {queued !== null ? <Notice kind="success">{t("queued", { count: queued })}</Notice> : null}
      {reindex.isError && !stepUp.dialogProps.open ? <ErrorBlock error={reindex.error} /> : null}
      <StepUpDialog {...stepUp.dialogProps} />
    </section>
  );
}

/**
 * Recherche dans le contenu des PDF : champ de recherche, filtre de catégorie, résultats avec extraits surlignés, « Afficher plus ».
 * Ce qui est listé est ce que l'API autorise pour CE compte : aucun filtre ne fait office de droit, un document illisible n'apparaît pas
 * (et n'est pas signalé).
 */
export function TextSearchScreen() {
  const t = useTranslations("v2Documents");
  const ctx = useMyDocumentsContext();
  const categories = useDocumentCategories();
  const [text, setText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const q = useDebounced(text.trim(), 350);
  const tooShort = q.length > 0 && q.length < DOCUMENT_TEXT_SEARCH_LIMITS.queryMin;
  const search = useDocumentTextSearch(q, categoryId ? { categoryId } : {});
  const items = search.data?.pages.flatMap((p) => p.items) ?? [];
  const searching = q.length >= DOCUMENT_TEXT_SEARCH_LIMITS.queryMin;

  return (
    <div className="space-y-4">
      <PageHeader title={t("textSearch.title")} description={t("textSearch.description")} />

      <section aria-label={t("explorer.filters")} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
        <FormField label={t("textSearch.search")} className="sm:col-span-2" hint={t("textSearch.hint")}>
          {(c) => <TextControl {...c} type="search" value={text} onChange={setText} placeholder={t("textSearch.placeholder")} maxLength={DOCUMENT_TEXT_SEARCH_LIMITS.queryMax} />}
        </FormField>
        <FormField label={t("explorer.category")}>
          {(c) => <NativeSelect {...c} value={categoryId} placeholder={t("explorer.all")} options={(categories.data?.items ?? []).map((x) => ({ value: x.id, label: x.label }))} onChange={setCategoryId} />}
        </FormField>
      </section>

      <p className="text-xs text-muted-foreground">{t("textSearch.scopeNote")}</p>

      {!searching ? (
        tooShort ? (
          <Notice kind="info">{t("textSearch.tooShort")}</Notice>
        ) : (
          <EmptyBlock title={t("textSearch.idle")} description={t("textSearch.idleHint")} />
        )
      ) : search.isPending ? (
        <LoadingBlock />
      ) : search.isError ? (
        <ErrorBlock error={search.error} onRetry={() => void search.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={t("textSearch.empty")} description={t("textSearch.emptyHint")} />
      ) : (
        <>
          <ul aria-label={t("textSearch.resultsLabel")} className="space-y-2">
            {items.map((hit) => (
              <Hit key={hit.document.id} hit={hit} />
            ))}
          </ul>
          {search.hasNextPage ? (
            <div className="flex justify-center">
              <button type="button" onClick={() => void search.fetchNextPage()} disabled={search.isFetchingNextPage} className={buttonClass.secondary}>
                {search.isFetchingNextPage ? t("explorer.loading") : t("textSearch.more")}
              </button>
            </div>
          ) : null}
        </>
      )}

      {ctx.data?.caps.manage ? <IndexAdmin /> : null}
    </div>
  );
}
