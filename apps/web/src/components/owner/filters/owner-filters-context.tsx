"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOwnerStatsFilters } from "@/lib/hooks/use-owner-stats-filters";

/**
 * Filtre global de l'espace propriétaire : année · cycle · filières · période.
 *
 * POURQUOI UN ÉTAT PARTAGÉ
 * Chaque page portait son propre `useState`. Trois conséquences : on reperdait
 * sa sélection en changeant d'écran, deux pages voisines pouvaient afficher des
 * périmètres différents sans le dire, et surtout DEUX VOCABULAIRES D'ANNÉE
 * cohabitaient — `academicYearId` (un UUID, table `academic_years`, côté
 * scolaire) et `anneeScolaire` (une chaîne « 2025-2026 » dérivée par pivot
 * septembre, côté professionnel). Le même écran pouvait donc filtrer sur deux
 * années différentes selon le bloc regardé.
 *
 * Ce contexte tient UNE sélection d'année et en dérive les deux formes, en
 * rapprochant le nom de l'année académique de la liste des années scolaires
 * renvoyée par `/owner/filters`. Quand le rapprochement échoue, `anneeScolaire`
 * vaut `undefined` : mieux vaut ne pas filtrer que filtrer sur une année
 * devinée.
 *
 * POURQUOI DANS L'URL
 * La sélection vit dans les paramètres de l'adresse, pas dans un état React :
 * un lien envoyé à son directeur des études ouvre le même périmètre, et un
 * rechargement ne perd rien. C'est aussi ce qui permet aux liens profonds des
 * alertes de pointer vers un écran déjà filtré.
 */

export const OWNER_FILTER_ALL = "__all__";

/** Fenêtre temporelle, vocabulaire commun aux endpoints qui en acceptent une. */
export type OwnerPeriod = "month" | "quarter" | "year" | "custom";

export interface OwnerFiltersState {
  /** `academic_years.id`, ou `undefined` pour « toutes ». */
  academicYearId?: string;
  /** Nom de l'année académique sélectionnée (« 2025-2026 »). */
  academicYearName?: string;
  /**
   * Même année exprimée dans le vocabulaire du module professionnel.
   * `undefined` quand aucune année scolaire connue ne correspond.
   */
  anneeScolaire?: string;
  cycleId?: string;
  filiereIds: string[];
  period: OwnerPeriod;
  /** Bornes lues uniquement quand `period === 'custom'`. */
  dateDebut?: string;
  dateFin?: string;
}

interface OwnerFiltersContextValue extends OwnerFiltersState {
  setAcademicYearId: (value: string | undefined) => void;
  setCycleId: (value: string | undefined) => void;
  setFiliereIds: (value: string[]) => void;
  setPeriod: (value: OwnerPeriod) => void;
  setCustomRange: (from: string | undefined, to: string | undefined) => void;
  reset: () => void;
  /** `true` dès qu'un filtre s'écarte de la valeur par défaut. */
  isFiltered: boolean;
  /** Options du référentiel, partagées pour éviter un fetch par page. */
  options: ReturnType<typeof useOwnerStatsFilters>["data"];
  optionsLoading: boolean;
}

const OwnerFiltersContext = createContext<OwnerFiltersContextValue | null>(null);

/** Clés d'URL courtes : l'adresse reste lisible quand on la partage. */
const PARAM = {
  year: "ay",
  cycle: "cy",
  filieres: "fil",
  period: "per",
  from: "du",
  to: "au",
} as const;

const PERIODS: OwnerPeriod[] = ["month", "quarter", "year", "custom"];

function parsePeriod(raw: string | null): OwnerPeriod {
  return PERIODS.includes(raw as OwnerPeriod) ? (raw as OwnerPeriod) : "year";
}

export function OwnerFiltersProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: options, isLoading: optionsLoading } = useOwnerStatsFilters();

  const academicYearId = searchParams.get(PARAM.year) ?? undefined;
  const cycleId = searchParams.get(PARAM.cycle) ?? undefined;
  const period = parsePeriod(searchParams.get(PARAM.period));
  const dateDebut = searchParams.get(PARAM.from) ?? undefined;
  const dateFin = searchParams.get(PARAM.to) ?? undefined;

  const filiereIds = useMemo(() => {
    const raw = searchParams.get(PARAM.filieres);
    if (!raw) return [];
    return raw.split(",").filter(Boolean);
  }, [searchParams]);

  /**
   * Réconciliation des deux vocabulaires d'année.
   *
   * `academic_years.name` et les libellés d'années scolaires du module
   * professionnel s'écrivent tous deux « AAAA-AAAA+1 ». Quand les deux
   * coïncident, on peut filtrer les deux moitiés de l'établissement sur la même
   * année. Sinon on laisse le professionnel non filtré plutôt que d'inventer une
   * correspondance.
   */
  const { academicYearName, anneeScolaire } = useMemo(() => {
    if (!academicYearId || !options) return {};
    const year = options.academicYears.find((y) => y.id === academicYearId);
    if (!year) return {};
    const match = options.anneesScolaires.find((a) => a === year.name);
    return { academicYearName: year.name, anneeScolaire: match };
  }, [academicYearId, options]);

  /** Écrit la sélection dans l'URL sans empiler d'entrées d'historique. */
  const patch = useCallback(
    (changes: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === "" || value === OWNER_FILTER_ALL) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const value = useMemo<OwnerFiltersContextValue>(
    () => ({
      academicYearId,
      academicYearName,
      anneeScolaire,
      cycleId,
      filiereIds,
      period,
      dateDebut,
      dateFin,
      setAcademicYearId: (v) => patch({ [PARAM.year]: v }),
      setCycleId: (v) => patch({ [PARAM.cycle]: v }),
      // Changer de cycle ou de filière invalide un semestre choisi ailleurs :
      // les pages concernées remettent leur propre sélection à « tous ».
      setFiliereIds: (v) => patch({ [PARAM.filieres]: v.length ? v.join(",") : undefined }),
      setPeriod: (v) =>
        patch({
          [PARAM.period]: v,
          // Sortir de « personnalisée » nettoie les bornes, sinon elles
          // resteraient dans l'URL et réapparaîtraient au retour.
          ...(v === "custom" ? {} : { [PARAM.from]: undefined, [PARAM.to]: undefined }),
        }),
      setCustomRange: (from, to) =>
        patch({ [PARAM.period]: "custom", [PARAM.from]: from, [PARAM.to]: to }),
      reset: () =>
        patch({
          [PARAM.year]: undefined,
          [PARAM.cycle]: undefined,
          [PARAM.filieres]: undefined,
          [PARAM.period]: undefined,
          [PARAM.from]: undefined,
          [PARAM.to]: undefined,
        }),
      isFiltered:
        !!academicYearId || !!cycleId || filiereIds.length > 0 || period !== "year",
      options,
      optionsLoading,
    }),
    [
      academicYearId,
      academicYearName,
      anneeScolaire,
      cycleId,
      filiereIds,
      period,
      dateDebut,
      dateFin,
      patch,
      options,
      optionsLoading,
    ]
  );

  return <OwnerFiltersContext.Provider value={value}>{children}</OwnerFiltersContext.Provider>;
}

export function useOwnerFilters(): OwnerFiltersContextValue {
  const ctx = useContext(OwnerFiltersContext);
  if (!ctx) {
    throw new Error("useOwnerFilters doit être utilisé sous <OwnerFiltersProvider>");
  }
  return ctx;
}
