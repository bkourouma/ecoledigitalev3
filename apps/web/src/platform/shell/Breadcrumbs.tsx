"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Crumb } from "./modules";

/** Fil d'Ariane accessible : `nav` nommée, liste ordonnée, page courante en `aria-current="page"` (jamais un lien). */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  const t = useTranslations("v2Shell");
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label={t("breadcrumb")} className="mb-3 text-sm text-muted-foreground print:hidden" data-testid="v2-breadcrumb">
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {crumb.href && !last ? (
                <Link href={crumb.href} className="rounded underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-foreground" : undefined}>
                  {crumb.label}
                </span>
              )}
              {!last ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
