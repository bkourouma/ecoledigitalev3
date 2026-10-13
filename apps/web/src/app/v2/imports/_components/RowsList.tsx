"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportColumnDef, ImportIssue } from "@ecoledigitale/contracts/v2/imports";
import { buttonClass, EmptyBlock, ErrorBlock, LoadingBlock, StatusBadge } from "@/platform/ui";
import { useImportRows, type ImportRowsQuery } from "@/platform/v2/imports";
import { INPUT_CLASS } from "./import-utils";
import { AntSelect } from "@/platform/ui/FormField";

/**
 * Tableau des problèmes par ligne et par colonne, FILTRABLE (champ, code, seulement les lignes à problème) et paginé côté
 * serveur. Une seule structure (liste de cartes) pour tous les écrans : lisible sur mobile (consultation du rapport) et en
 * grille sur grand écran. Les valeurs du fichier sont du TEXTE (jamais interprétées).
 */
export function RowsList({ jobId, columns, headers, base, defaultOnlyProblems = true }: { jobId: string; columns: readonly ImportColumnDef[]; headers: readonly string[]; base: ImportRowsQuery; defaultOnlyProblems?: boolean }) {
  const t = useTranslations("v2Imports.rows");
  const [column, setColumn] = useState("");
  const [code, setCode] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(defaultOnlyProblems);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const rows = useImportRows(jobId, { ...base, ...(onlyProblems ? { onlyProblems: true } : {}), ...(column ? { column } : {}), ...(code.trim() ? { code: code.trim() } : {}), limit: pageSize, offset: (page - 1) * pageSize });
  const total = rows.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const labelOf = (key: string | null): string => (key ? (columns.find((c) => c.key === key)?.label ?? key) : t("wholeRow"));

  function issueNode(i: ImportIssue, k: number) {
    return (
      <li key={`${i.code}-${k}`} className="text-sm">
        <StatusBadge label={i.severity === "ERROR" ? t("error") : t("warning")} tone={i.severity === "ERROR" ? "danger" : "warning"} />{" "}
        <span className="font-medium">{labelOf(i.column)}</span>
        {i.header ? <span className="text-muted-foreground"> ({t("column", { name: i.header })})</span> : null} — {i.message} <code className="text-xs text-muted-foreground">{i.code}</code>
      </li>
    );
  }

  return (
    <section aria-label={t("title")} className="space-y-3">
      <form className="grid gap-3 rounded-2xl border border-white/10 bg-card/40 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label={t("filters")}>
        <div>
          <label htmlFor="rows-filter-column" className="mb-1 block text-sm font-medium">
            {t("filterColumn")}
          </label>
          <AntSelect
            id="rows-filter-column"
            className={INPUT_CLASS}
            value={column}
            onChange={(e) => {
              setColumn(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("all")}</option>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </AntSelect>
        </div>
        <div>
          <label htmlFor="rows-filter-code" className="mb-1 block text-sm font-medium">
            {t("filterCode")}
          </label>
          <input
            id="rows-filter-code"
            type="text"
            className={INPUT_CLASS}
            value={code}
            placeholder="imports.required"
            onChange={(e) => {
              setCode(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={onlyProblems}
            onChange={(e) => {
              setOnlyProblems(e.target.checked);
              setPage(1);
            }}
          />
          {t("onlyProblems")}
        </label>
      </form>

      {rows.isError ? <ErrorBlock error={rows.error} onRetry={() => void rows.refetch()} /> : null}
      {rows.isLoading ? <LoadingBlock /> : null}
      {!rows.isLoading && !rows.isError && (rows.data?.items.length ?? 0) === 0 ? <EmptyBlock title={t("empty")} /> : null}

      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {t("count", { total })}
      </p>
      <ul className="space-y-3" aria-label={t("list")}>
        {(rows.data?.items ?? []).map((r) => (
          <li key={r.rowNo} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 md:grid md:grid-cols-[6rem_1fr] md:gap-4">
            <div className="mb-2 md:mb-0">
              <span className="text-sm font-semibold">{t("line", { n: r.rowNo })}</span>
            </div>
            <div className="min-w-0 space-y-2">
              <ul className="space-y-1" aria-label={t("issues", { n: r.rowNo })}>
                {[...r.issues, ...r.outcomeIssues].length === 0 ? <li className="text-sm text-muted-foreground">{t("noIssue")}</li> : [...r.issues, ...r.outcomeIssues].map(issueNode)}
              </ul>
              {r.raw ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("showValues")}</summary>
                  <dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
                    {headers.map((h, i) => (
                      <div key={h} className="contents">
                        <dt className="font-medium">{h}</dt>
                        <dd className="break-words">{r.raw?.[i] || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : (
                <p className="text-xs text-muted-foreground">{t("purged")}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav aria-label={t("pagination")} className="flex items-center justify-between gap-2">
          <button type="button" className={buttonClass.secondary} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("previous")}
          </button>
          <span className="text-sm">{t("page", { page, pages })}</span>
          <button type="button" className={buttonClass.secondary} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("next")}
          </button>
        </nav>
      ) : null}
    </section>
  );
}
