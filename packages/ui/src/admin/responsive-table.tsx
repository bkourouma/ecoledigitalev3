import * as React from "react";
import { cn } from "../utils";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Libellé texte de la colonne, répété devant chaque valeur en mobile. Défaut : `header` s'il est textuel. */
  label?: string;
  cell: (row: T) => React.ReactNode;
  /** Colonne masquée en mobile (information secondaire). */
  hideOnMobile?: boolean;
  className?: string;
}

export interface ResponsiveTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Légende accessible (lue par les lecteurs d'écran). */
  caption: string;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}

/**
 * Tableau « empilé » : tableau classique dès `md`, cartes (une ligne = une carte, chaque valeur précédée de son
 * libellé) en dessous. Un seul DOM — les rôles ARIA tableau sont posés explicitement car `display: block` retire
 * la sémantique native dans certains navigateurs.
 */
export function ResponsiveTable<T>({ columns, rows, rowKey, caption, className, rowClassName }: ResponsiveTableProps<T>) {
  return (
    <div role="table" aria-label={caption} className={cn("w-full text-sm md:overflow-hidden md:rounded-2xl md:border md:border-white/10 md:bg-card/40", className)}>
      <div role="rowgroup" className="hidden md:block">
        <div role="row" className="grid grid-flow-col auto-cols-fr gap-4 border-b border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {columns.map((c) => (
            <div key={c.key} role="columnheader" className={c.className}>
              {c.header}
            </div>
          ))}
        </div>
      </div>
      <div role="rowgroup" className="space-y-3 md:space-y-0">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            role="row"
            className={cn(
              "rounded-2xl border border-white/10 bg-card/40 p-3 md:grid md:grid-flow-col md:auto-cols-fr md:items-center md:gap-4 md:rounded-none md:border-0 md:border-b md:border-white/5 md:bg-transparent md:px-3 md:py-2.5 md:transition-colors md:hover:bg-white/[0.04] md:last:border-b-0",
              rowClassName?.(row),
            )}
          >
            {columns.map((c) => (
              <div
                key={c.key}
                role="cell"
                data-label={c.label ?? (typeof c.header === "string" ? c.header : undefined)}
                className={cn(
                  "flex min-w-0 items-start justify-between gap-3 py-1 before:shrink-0 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] md:block md:py-0 md:before:hidden",
                  c.hideOnMobile && "hidden md:block",
                  c.className,
                )}
              >
                <div className="min-w-0 break-words text-right md:text-left">{c.cell(row)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
