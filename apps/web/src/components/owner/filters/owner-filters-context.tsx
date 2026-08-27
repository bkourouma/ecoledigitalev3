"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useOwnerStatsFilters } from "@/lib/hooks/use-owner-stats-filters";

/**
 * Filtre global de l'espace propriétaire : année · cycle · filières · semestre ·
 * catégorie d'UE · période.
 *
 * POURQUOI UN ÉTAT PARTAGÉ
 * Chaque page portait son propre `useState` : on reperdait sa sélection en
 * changeant d'écran, et deux pages voisines pouvaient afficher des périmètres
 * différents sans le dire.
 *
 * QUELLE ANNÉE FAIT FOI
 * L'ANNÉE DÉRIVÉE, celle qui se lit sur la date de début des ouvertures de
 * classe avec un pivot en septembre. Le module professionnel n'a pas de table
 * d'années scolaires : une année existe parce qu'une classe a été ouverte.
 *
 * La table `academic_years` a été essayée comme référentiel et abandonnée : sur
 * une base réelle elle ignorait trois années portant douze ouvertures chacune
 * et déclarait une année qui n'en portait aucune. Elle n'est plus lue que par
 * rapprochement de nom, pour les rares écrans qui exigent encore un UUID.
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
  /**
   * Nom de classe « filiereId|nom », dimension de filtrage des écrans admin
   * Paiements et Étudiants inscrits. Ce n'est PAS la filière : une filière peut
   * porter plusieurs classes.
   */
  nomClasse?: string;
  /** `semestres.id` du module professionnel. */
  semestreId?: string;
  /** Catégorie d'UE : fondamentale, spécialité, culture générale. */
  categorie?: string;
  period: OwnerPeriod;
  /** Bornes lues uniquement quand `period === 'custom'`. */
  dateDebut?: string;
  dateFin?: string;
}

interface OwnerFiltersContextValue extends OwnerFiltersState {
  /** Millésime « AAAA-AAAA+1 » dérivé des ouvertures, ou `undefined` pour toutes. */
  setAnneeScolaire: (value: string | undefined) => void;
  setCycleId: (value: string | undefined) => void;
  setFiliereIds: (value: string[]) => void;
  setNomClasse: (value: string | undefined) => void;
  setSemestreId: (value: string | undefined) => void;
  setCategorie: (value: string | undefined) => void;
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
  nomClasse: "cls",
  semestre: "sem",
  categorie: "cat",
  period: "per",
  from: "du",
  to: "au",
} as const;

const PERIODS: OwnerPeriod[] = ["month", "quarter", "year", "custom"];

function parsePeriod(raw: string | null): OwnerPeriod {
  return PERIODS.includes(raw as OwnerPeriod) ? (raw as OwnerPeriod) : "year";
}

export function OwnerFiltersProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: options, isLoading: optionsLoading } = useOwnerStatsFilters();

  /**
   * Copie locale de la query string.
   *
   * Le provider vit dans le *layout* `/owner`. Sous Next.js 15, `router.replace`
   * pour changer uniquement `?ay=` ne rerend pas le layout : `useSearchParams()`
   * restait figé, le sélecteur affichait la nouvelle année (état interne Radix)
   * et le tableau de bord continuait d'appeler l'API sans filtre.
   *
   * On écrit l'URL avec `history.replaceState` — intercepté par Next 15, ça
   * met à jour `useSearchParams` sans navigation RSC — et on tient une copie
   * React pour que les consommateurs voient le changement dans le même tick,
   * même si le layout ne se relance pas.
   */
  const [queryString, setQueryString] = useState(() => searchParams.toString());

  useEffect(() => {
    const lire = () => {
      const q = window.location.search.startsWith("?")
        ? window.location.search.slice(1)
        : window.location.search;
      setQueryString(q);
    };
    // Retour arrière / lien interne : l'URL a changé sans passer par `patch`.
    lire();
    window.addEventListener("popstate", lire);
    return () => window.removeEventListener("popstate", lire);
  }, [pathname]);

  const params = useMemo(() => new URLSearchParams(queryString), [queryString]);

  /**
   * L'année scolaire SÉLECTIONNÉE, au format « AAAA-AAAA+1 ».
   *
   * C'est désormais la chaîne dérivée des ouvertures de classe qui vit dans
   * l'URL, et non l'identifiant d'une ligne de `academic_years`. Le module
   * professionnel n'a pas de table d'années : une année existe parce qu'une
   * classe a été ouverte. S'adosser à la table donnait un filtre qui masquait
   * trois années d'activité réelle et en proposait une vide.
   */
  const anneeScolaire = params.get(PARAM.year) ?? undefined;
  const cycleId = params.get(PARAM.cycle) ?? undefined;
  const nomClasse = params.get(PARAM.nomClasse) ?? undefined;
  const semestreId = params.get(PARAM.semestre) ?? undefined;
  const categorie = params.get(PARAM.categorie) ?? undefined;
  const period = parsePeriod(params.get(PARAM.period));
  const dateDebut = params.get(PARAM.from) ?? undefined;
  const dateFin = params.get(PARAM.to) ?? undefined;

  const filiereIds = useMemo(() => {
    const raw = params.get(PARAM.filieres);
    if (!raw) return [];
    return raw.split(",").filter(Boolean);
  }, [params]);

  /**
   * Rapprochement vers la table, pour les rares écrans qui l'exigent encore.
   *
   * Le sens compte : l'année DÉRIVÉE fait foi, et l'on cherche la ligne de
   * `academic_years` qui porte le même millésime — l'inverse de ce qui se
   * faisait avant. `academicYearId` reste `undefined` quand aucune ligne ne
   * correspond, et l'écran concerné n'est alors pas filtré : mieux vaut un
   * écran non restreint qu'un écran restreint sur une année devinée.
   *
   * Seul `/owner/finances` consomme encore cet identifiant.
   */
  const { academicYearId, academicYearName } = useMemo(() => {
    if (!anneeScolaire) return {};
    const ligne = options?.academicYears.find((y) => y.name === anneeScolaire);
    return { academicYearId: ligne?.id, academicYearName: anneeScolaire };
  }, [anneeScolaire, options]);

  /** Écrit la sélection dans l'URL sans empiler d'entrées d'historique. */
  const patch = useCallback(
    (changes: Record<string, string | undefined>) => {
      const next = new URLSearchParams(queryString);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === "" || value === OWNER_FILTER_ALL) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      // `replaceState`, pas `router.replace` : voir le commentaire sur
      // `queryString`. Next 15 intercepte cet appel et aligne `useSearchParams`.
      window.history.replaceState(window.history.state, "", href);
      setQueryString(qs);
    },
    [pathname, queryString]
  );

  const value = useMemo<OwnerFiltersContextValue>(
    () => ({
      academicYearId,
      academicYearName,
      anneeScolaire,
      cycleId,
      filiereIds,
      nomClasse,
      semestreId,
      categorie,
      period,
      dateDebut,
      dateFin,
      // Changer d'année invalide la classe retenue — les listes de la page
      // Paiements sont commandées par l'année — et donc le semestre avec elle.
      setAnneeScolaire: (v) =>
        patch({ [PARAM.year]: v, [PARAM.nomClasse]: undefined, [PARAM.semestre]: undefined }),
      // Changer de cycle restreint les filières proposées : une filière retenue
      // hors du nouveau cycle filtrerait sur un périmètre vide sans le dire.
      setCycleId: (v) => patch({ [PARAM.cycle]: v, [PARAM.filieres]: undefined, [PARAM.semestre]: undefined }),
      // Un semestre appartient à une filière : changer de filière invalide le
      // semestre retenu. Le nettoyer ici évite que chaque page le refasse — et
      // qu'une page oublie de le faire.
      setFiliereIds: (v) =>
        patch({
          [PARAM.filieres]: v.length ? v.join(",") : undefined,
          [PARAM.semestre]: undefined,
        }),
      // Dernier maillon avant le semestre : changer de classe invalide le
      // semestre, exactement comme la cascade de la page admin Paiements.
      setNomClasse: (v) => patch({ [PARAM.nomClasse]: v, [PARAM.semestre]: undefined }),
      setSemestreId: (v) => patch({ [PARAM.semestre]: v }),
      setCategorie: (v) => patch({ [PARAM.categorie]: v }),
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
          [PARAM.nomClasse]: undefined,
          [PARAM.semestre]: undefined,
          [PARAM.categorie]: undefined,
          [PARAM.period]: undefined,
          [PARAM.from]: undefined,
          [PARAM.to]: undefined,
        }),
      isFiltered:
        // L'année vit dans `anneeScolaire` (chaîne dérivée), pas dans
        // `academicYearId` (UUID de `academic_years`, souvent absent). Tester
        // l'UUID faisait passer une année choisie pour « pas de filtre ».
        !!anneeScolaire ||
        !!cycleId ||
        filiereIds.length > 0 ||
        !!nomClasse ||
        !!semestreId ||
        !!categorie ||
        period !== "year",
      options,
      optionsLoading,
    }),
    [
      academicYearId,
      academicYearName,
      anneeScolaire,
      cycleId,
      filiereIds,
      nomClasse,
      semestreId,
      categorie,
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
