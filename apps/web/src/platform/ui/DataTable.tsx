"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { EmptyBlock, ErrorBlock } from "./states";
import { AntSelect } from "./FormField";

export type SortDirection = "asc" | "desc";
export interface SortState {
  id: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  /** Identifiant stable ; sert aussi de clé de tri envoyée au serveur. */
  id: string;
  /** Libellé déjà traduit. */
  header: ReactNode;
  /** Texte brut de l'en-tête pour l'étiquette accessible du bouton de tri (défaut : `id`). */
  headerLabel?: string;
  cell: (row: T) => ReactNode;
  /** Tri CÔTÉ SERVEUR : le composant ne trie jamais lui-même. */
  sortable?: boolean;
  /** Classes Tailwind de la colonne (ex. `hidden md:table-cell` pour masquer sur mobile). */
  className?: string;
  align?: "left" | "right" | "center";
  /** Rend la cellule comme en-tête de ligne (`<th scope="row">`) : une seule colonne par tableau. */
  rowHeader?: boolean;
}

export interface PaginationState {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
}

export interface DataTableProps<T> {
  /** Nom accessible du tableau (légende masquée visuellement + région défilante). */
  caption: string;
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  getRowId: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  pagination?: PaginationState;
  className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Tableau de données accessible : légende, `aria-sort`, tri / pagination CÔTÉ SERVEUR (le composant n'altère jamais les
 * lignes reçues), états chargement / erreur / vide, défilement horizontal focusable pour le mobile (375 px).
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  isLoading = false,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyAction,
  sort,
  onSortChange,
  pagination,
  className,
}: DataTableProps<T>) {
  const t = useTranslations("v2Ui.table");

  if (error) return <ErrorBlock error={error} onRetry={onRetry} className={className} />;

  const showSkeleton = isLoading && rows.length === 0;
  const showEmpty = !isLoading && rows.length === 0;

  function nextSort(column: DataTableColumn<T>): SortState | null {
    if (!sort || sort.id !== column.id) return { id: column.id, direction: "asc" };
    if (sort.direction === "asc") return { id: column.id, direction: "desc" };
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto rounded-2xl border border-white/10 bg-card/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full min-w-[32rem] border-collapse text-sm" aria-busy={isLoading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-white/[0.04]">
            <tr>
              {columns.map((column) => {
                const active = sort?.id === column.id ? sort : null;
                const ariaSort = column.sortable ? (active ? (active.direction === "asc" ? "ascending" : "descending") : "none") : undefined;
                const label = column.headerLabel ?? column.id;
                return (
                  <th key={column.id} scope="col" aria-sort={ariaSort} className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground", ALIGN[column.align ?? "left"], column.className)}>
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(column))}
                        aria-label={t(active ? (active.direction === "asc" ? "sortDescending" : "sortClear") : "sortAscending", { column: label })}
                        className="inline-flex items-center gap-1 rounded uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {column.header}
                        {active ? active.direction === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={cn(isLoading && rows.length > 0 && "opacity-60")}>
            {showSkeleton
              ? [0, 1, 2].map((i) => (
                  <tr key={`sk-${i}`} data-testid="skeleton-row" className="border-t">
                    {columns.map((c) => (
                      <td key={c.id} className={cn("px-3 py-3", c.className)}>
                        <span className="block h-4 w-3/4 animate-pulse rounded bg-muted" aria-hidden="true" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr key={getRowId(row)} className="border-t border-white/5 transition-colors hover:bg-white/[0.04]">
                    {columns.map((c) =>
                      c.rowHeader ? (
                        <th key={c.id} scope="row" className={cn("px-3 py-2 font-medium", ALIGN[c.align ?? "left"], c.className)}>
                          {c.cell(row)}
                        </th>
                      ) : (
                        <td key={c.id} className={cn("px-3 py-2 align-middle", ALIGN[c.align ?? "left"], c.className)}>
                          {c.cell(row)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
        {showSkeleton ? <p role="status" className="sr-only">{t("loading")}</p> : null}
      </div>
      {showEmpty ? <EmptyBlock title={emptyTitle ?? t("empty")} description={emptyDescription} action={emptyAction} /> : null}
      {pagination && pagination.total > 0 ? <Pager {...pagination} /> : null}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPageChange, pageSizeOptions, onPageSizeChange }: PaginationState) {
  const t = useTranslations("v2Ui.table");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const btn = "inline-flex h-10 min-w-[2.5rem] items-center justify-center gap-1 rounded-[10px] border border-[#3d4450] bg-[#2c3139] px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
  return (
    <nav aria-label={t("pagination")} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p aria-live="polite" className="text-muted-foreground">
        {t("range", { first, last, total })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {pageSizeOptions && onPageSizeChange ? (
          <label className="flex items-center gap-2 text-muted-foreground">
            <span>{t("rowsPerPage")}</span>
            <AntSelect value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className="h-10 rounded-[10px] border border-[#3d4450] bg-[#2c3139] px-2 hover:border-violet-400/60 focus-visible:border-violet-400 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-violet-500/25">
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </AntSelect>
          </label>
        ) : null}
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t("previous")}</span>
        </button>
        <span className="px-1">
          {t("pageOf", { page, pageCount })}
        </span>
        <button type="button" className={btn} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <span>{t("next")}</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
