"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FiliereFilter } from "@/components/owner/charts/FiliereFilter";
import {
  OWNER_FILTER_ALL,
  useOwnerFilters,
  type OwnerPeriod,
} from "./owner-filters-context";

/**
 * Barre de filtre unique de l'espace propriétaire.
 *
 * Règle de conception : on n'affiche JAMAIS une dimension qui n'agit pas sur
 * l'écran regardé. Un filtre inopérant est pire qu'un filtre absent — il laisse
 * croire que le chiffre affiché a été restreint. D'où la table de portée
 * ci-dessous, explicite et relue d'un coup d'œil, plutôt qu'une déclaration
 * dispersée dans chaque page.
 */

export type OwnerFilterDimension = "year" | "cycle" | "filieres" | "period";

/**
 * Dimensions réellement prises en compte par chaque écran.
 * Une route absente de cette table n'affiche pas de barre du tout.
 */
export const OWNER_FILTER_SCOPE: Record<string, OwnerFilterDimension[]> = {
  "/owner/finances": ["year", "cycle", "period"],
  "/owner/finances/professionnel": ["year", "filieres", "period"],
  "/owner/finances/tresorerie": ["filieres", "period"],
  "/owner/pedagogie": ["year", "filieres"],
  "/owner/assiduite": ["filieres"],
  "/owner/referentiel": ["cycle", "filieres"],
  "/owner/personnes": ["filieres"],
  "/owner/remplissage": ["filieres"],
  "/owner/risque": ["filieres"],
  "/owner/economie": ["filieres"],
  "/owner/recrutement": ["period"],
  // `/owner/dashboard` et `/owner/academique` n'acceptent aucun paramètre côté
  // API : leur donner une barre laisserait croire qu'on peut les restreindre.
};

const PERIOD_LABELS: Record<OwnerPeriod, string> = {
  month: "Ce mois",
  quarter: "Ce trimestre",
  year: "Année scolaire",
  custom: "Personnalisée",
};

const ALL_PERIODS: OwnerPeriod[] = ["month", "quarter", "year", "custom"];

/**
 * Périodes réellement acceptées par chaque écran.
 *
 * `/owner/finances` ne connaît pas les bornes libres : lui proposer
 * « Personnalisée » afficherait un sélecteur de dates sans effet. Une route
 * absente accepte les quatre.
 */
export const OWNER_PERIOD_OPTIONS: Record<string, OwnerPeriod[]> = {
  "/owner/finances": ["month", "quarter", "year"],
};

export function OwnerFilterBar({
  dimensions,
  periods = ALL_PERIODS,
}: {
  dimensions: OwnerFilterDimension[];
  periods?: OwnerPeriod[];
}) {
  const {
    academicYearId,
    academicYearName,
    anneeScolaire,
    cycleId,
    filiereIds,
    period,
    dateDebut,
    dateFin,
    setAcademicYearId,
    setCycleId,
    setFiliereIds,
    setPeriod,
    setCustomRange,
    reset,
    isFiltered,
    options,
    optionsLoading,
  } = useOwnerFilters();

  if (dimensions.length === 0) return null;

  const show = (d: OwnerFilterDimension) => dimensions.includes(d);

  /**
   * Filières proposées : restreintes au cycle choisi quand l'écran filtre aussi
   * par cycle, sinon toutes.
   */
  const filiereOptions = (options?.filieres ?? []).filter(
    (f) => !show("cycle") || !cycleId || f.cycleId === cycleId
  );

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-end gap-4">
        {show("year") && (
          <div className="min-w-[180px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Année scolaire</Label>
            <Select
              value={academicYearId ?? OWNER_FILTER_ALL}
              onValueChange={(v) =>
                setAcademicYearId(v === OWNER_FILTER_ALL ? undefined : v)
              }
              disabled={optionsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Toutes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OWNER_FILTER_ALL}>Toutes les années</SelectItem>
                {(options?.academicYears ?? []).map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.name}
                    {y.isActive ? " · en cours" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {show("cycle") && (
          <div className="min-w-[180px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cycle</Label>
            <Select
              value={cycleId ?? OWNER_FILTER_ALL}
              onValueChange={(v) => {
                setCycleId(v === OWNER_FILTER_ALL ? undefined : v);
                // Les filières retenues peuvent ne plus appartenir au cycle :
                // les garder filtrerait sur un périmètre vide, sans le dire.
                if (filiereIds.length > 0) setFiliereIds([]);
              }}
              disabled={optionsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tous" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OWNER_FILTER_ALL}>Tous les cycles</SelectItem>
                {(options?.cycles ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {show("filieres") && (
          <div className="min-w-[200px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Filières</Label>
            <FiliereFilter
              filieres={filiereOptions}
              value={filiereIds}
              onChange={setFiliereIds}
              disabled={optionsLoading}
            />
          </div>
        )}

        {show("period") && (
          <div className="min-w-[160px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Période</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as OwnerPeriod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {show("period") && period === "custom" && (
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Du</Label>
              <input
                type="date"
                value={dateDebut ?? ""}
                onChange={(e) => setCustomRange(e.target.value || undefined, dateFin)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
                aria-label="Date de début"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Au</Label>
              <input
                type="date"
                value={dateFin ?? ""}
                onChange={(e) => setCustomRange(dateDebut, e.target.value || undefined)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
                aria-label="Date de fin"
              />
            </div>
          </div>
        )}

        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={reset} className="ml-auto">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Réinitialiser
          </Button>
        )}
      </div>

      {/*
        Une année académique sans année scolaire professionnelle correspondante
        ne filtre que la moitié scolaire de l'établissement. Le taire ferait
        passer un périmètre partiel pour un périmètre complet.
      */}
      {show("year") && academicYearName && !anneeScolaire && (
        <p className="mt-2 text-xs text-muted-foreground">
          Aucune année du module professionnel ne correspond à «&nbsp;{academicYearName}&nbsp;» :
          les indicateurs professionnels de cet écran ne sont pas restreints à cette année.
        </p>
      )}
    </div>
  );
}
