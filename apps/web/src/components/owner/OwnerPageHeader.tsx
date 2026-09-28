"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ExportButtons } from "@/components/ExportButtons";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { ownerFilterScopeFor } from "@/components/owner/filters/OwnerFilterBar";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import { openReportPdf } from "@/lib/utils/report-pdf";
import {
  buildOwnerReport,
  describeOwnerScope,
  ownerScopeLine,
  type OwnerReportContent,
} from "@/lib/utils/owner-report";

/**
 * En-tête unique des écrans de l'espace propriétaire.
 *
 * POURQUOI UN COMPOSANT PLUTÔT QU'UN PATRON RECOPIÉ
 * Les dix-sept écrans écrivaient chacun leur en-tête : titre à un niveau de
 * gras variable, phrase d'explication tantôt présente tantôt non, bouton
 * d'export tantôt à droite tantôt noyé dans une carte plus bas. Un propriétaire
 * qui balaie son espace réapprenait la page à chaque écran. Ici l'ordre est
 * fixe et le même partout : ce que l'écran est, la question qu'il répond, le
 * périmètre affiché, puis les exports — toujours en haut à droite.
 *
 * LE PÉRIMÈTRE EST ÉCRIT, PAS DEVINÉ
 * La ligne de périmètre reprend les filtres actifs, et uniquement ceux que
 * l'écran regardé applique réellement (`OWNER_FILTER_SCOPE`). Elle est reprise
 * telle quelle dans le PDF. Un chiffre lu à l'écran et le même chiffre imprimé
 * portent donc la même mention de restriction.
 *
 * L'ÉCRAN NE COMPOSE PAS SON PDF
 * La page fournit `pdf.blocks` — son contenu, rien d'autre. Titre, sous-titre,
 * date d'édition, bloc de périmètre, charte et nom de fichier horodaté sont
 * ajoutés ici. Aucun écran ne peut donc produire un rapport qui déroge.
 */

export interface OwnerPageHeaderProps {
  /** Nom de l'écran, identique à son entrée de menu. */
  title: string;
  /**
   * La question à laquelle l'écran répond, en une phrase.
   *
   * FACULTATIVE : certains écrans se passent de cette ligne, et un titre seul
   * vaut mieux qu'une phrase imposée. Le sous-titre du PDF suit — il est vide
   * quand l'écran n'en donne pas, plutôt que d'afficher « undefined ».
   */
  question?: string;
  /**
   * Précision propre à l'écran (fenêtre de dates calculée par l'API, source des
   * données…), affichée sous la question. Le périmètre des filtres, lui, est
   * ajouté automatiquement : ne pas le répéter ici.
   */
  precision?: string;
  /**
   * Contenu du rapport, construit au clic et non au rendu : composer les blocs
   * à chaque re-rendu d'une page qui en compte plusieurs milliers de lignes
   * coûterait cher pour un bouton parfois jamais pressé.
   */
  pdf?: () => OwnerReportContent | Promise<OwnerReportContent>;
  /** Export CSV existant de l'écran, quand l'API en propose un. */
  csv?: { endpoint: string; queryString?: string; filename: string };
}

export function OwnerPageHeader({
  title,
  question,
  precision,
  pdf,
  csv,
}: OwnerPageHeaderProps) {
  const pathname = usePathname();
  // L'onglet courant : la portée des filtres — donc le périmètre imprimé —
  // diffère entre les deux moitiés d'un écran fusionné.
  const vue = useSearchParams().get("vue");
  const filters = useOwnerFilters();
  const [erreur, setErreur] = useState<string | null>(null);

  const scope = describeOwnerScope(
    ownerFilterScopeFor(pathname, vue),
    {
      academicYearId: filters.academicYearId,
      academicYearName: filters.academicYearName,
      cycleId: filters.cycleId,
      filiereIds: filters.filiereIds,
      period: filters.period,
      dateDebut: filters.dateDebut,
      dateFin: filters.dateFin,
    },
    filters.options
  );

  const exporterPdf = async (win: Window) => {
    if (!pdf) return;
    /*
       Le contenu peut être ASYNCHRONE, et l'awaiter ici ne change rien aux
       écrans qui le rendent synchrone. Un écran dont le rapport doit contenir
       plus que ce qu'il affiche — le journal de caisse, paginé à 25 lignes —
       ne peut pas être forcé d'imprimer une page tronquée, ni de précharger
       l'intégralité à chaque visite pour un bouton parfois jamais pressé.
    */
    await openReportPdf(buildOwnerReport(title, question ?? "", scope, await pdf()), win);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {question ? (
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">{question}</p>
          ) : null}
          {precision ? (
            <p className="mt-1 text-sm text-muted-foreground">{precision}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          {pdf ? (
            <ExportButtons
              formats={["pdf"]}
              size="sm"
              labels={{ pdf: "PDF" }}
              onExportPdf={exporterPdf}
              onError={setErreur}
            />
          ) : null}
          {csv ? (
            <ExportCsvButton
              endpoint={csv.endpoint}
              queryString={csv.queryString}
              filename={csv.filename}
              label="CSV"
            />
          ) : null}
        </div>
      </div>

      {/* Bandeau de périmètre : la même phrase que celle imprimée en tête du PDF. */}
      <p className="text-xs text-muted-foreground">{ownerScopeLine(scope)}</p>

      {erreur ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
