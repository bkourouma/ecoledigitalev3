"use client";

import { useEffect, useMemo } from "react";
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
import { SearchableSelect } from "@/components/SearchableSelect";
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

export type OwnerFilterDimension =
  | "year"
  | "cycle"
  /** Multi-sélection à cases : croiser plusieurs classes d'un coup. */
  | "filieres"
  /**
   * Sélection UNIQUE et recherchable de la classe — le contrôle de l'écran
   * Paiements du module professionnel.
   *
   * Même donnée et même paramètre d'URL que `filieres` : `programmes` EST la
   * classe, le module professionnel l'appelle encore « filière ». Ce qui change
   * est la forme et le mot. Un écran choisit l'un ou l'autre, jamais les deux.
   */
  | "nomClasse"
  | "semestre"
  | "categorie"
  | "period";

/**
 * Dimensions réellement prises en compte par chaque écran.
 *
 * Une route absente de cette table n'affiche pas de barre du tout.
 *
 * ÉCRANS À ONGLETS : la clé porte le suffixe `:onglet`, parce que les deux
 * moitiés d'un écran fusionné n'acceptent pas les mêmes paramètres. « Impayés »
 * accepte l'année scolaire côté professionnel et pas côté scolaire ; afficher
 * l'année sur les deux ferait croire à une restriction qui n'aurait pas lieu
 * sur l'un des onglets. La clé sans suffixe décrit l'onglet ouvert par défaut.
 */
export const OWNER_FILTER_SCOPE: Record<string, OwnerFilterDimension[]> = {
  "/owner/dashboard": ["year"],
  // Encaissements — module professionnel seul : le cycle est un axe scolaire.
  "/owner/finances": ["year", "filieres", "period"],

  /*
    Impayés — cascade année → nom de classe → semestre, calquée sur l'écran
    Paiements du module professionnel.

    PAS DE PÉRIODE ICI, volontairement. L'écran est adossé à l'année scolaire :
    superposer « Ce trimestre » à « 2023-2024 » posait deux questions de temps
    à la fois, dont une seule commandait vraiment les chiffres. La fenêtre est
    désormais celle de l'année choisie, de bout en bout.
  */
  "/owner/finances/tresorerie": ["year", "nomClasse", "semestre"],

  // Résultats — onglet « scolaire » par défaut, et cet onglet n'accepte aucun
  // paramètre côté API : pas de barre du tout.
  "/owner/pedagogie:professionnel": ["year", "filieres", "semestre", "categorie"],

  // Catalogue — onglet « offre diplômante » par défaut ; « formations pro »
  // n'accepte aucun paramètre.
  "/owner/referentiel": ["cycle", "filieres", "categorie"],
  "/owner/referentiel:referentiel": ["cycle", "filieres", "categorie"],

  // Points de vigilance — écran unique depuis le retrait des alertes.
  "/owner/risque": ["filieres"],

  "/owner/assiduite": ["filieres", "semestre", "period"],
  "/owner/personnes": ["year", "filieres"],
  "/owner/remplissage": ["year", "filieres"],
  "/owner/economie": ["year", "filieres"],
  "/owner/recrutement": ["period"],
  // `/owner/staff` n'est pas ici : la masse salariale se filtre par période de
  // PAIE, une dimension qui n'a de sens que sur cet écran — elle vit donc sur
  // l'écran, pas dans cette barre.
};

/**
 * Dimensions applicables à une route et à son onglet courant.
 *
 * `vue` vient de `?vue=` (cf. `OwnerTabs`). La recherche va du plus précis au
 * plus général : sans correspondance, aucune barre — jamais une barre par
 * défaut, qui serait un filtre inopérant.
 */
export function ownerFilterScopeFor(
  pathname: string,
  vue: string | null
): OwnerFilterDimension[] {
  if (vue) {
    const precis = OWNER_FILTER_SCOPE[`${pathname}:${vue}`];
    if (precis) return precis;
    // Un onglet explicitement demandé et absent de la table n'accepte rien :
    // retomber sur la clé générale rendrait la barre de l'onglet par défaut.
    return [];
  }
  return OWNER_FILTER_SCOPE[pathname] ?? [];
}

const PERIOD_LABELS: Record<OwnerPeriod, string> = {
  month: "Ce mois",
  quarter: "Ce trimestre",
  year: "Année scolaire",
  custom: "Personnalisée",
};

const ALL_PERIODS: OwnerPeriod[] = ["month", "quarter", "year", "custom"];

/**
 * Millésime de l'année en cours, au même pivot de septembre que le serveur.
 * Sert uniquement à marquer « en cours » dans la liste : aucun calcul métier
 * n'en dépend, le serveur refait le sien.
 */
function anneeEnCoursLocale(): string {
  const d = new Date();
  const n = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${n}-${n + 1}`;
}

/** Catégories d'UE, vocabulaire du module professionnel. */
const CATEGORIE_LABELS: Record<string, string> = {
  fondamentale: "Fondamentale",
  specialite: "Spécialité",
  culture_generale: "Culture générale",
};

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

/**
 * Écrans où une année scolaire doit TOUJOURS être choisie.
 *
 * Le tableau de bord répond à « comment va l'école ? ». Additionner cinq
 * rentrées ne répond à cette question pour aucune d'entre elles : l'écran
 * demande donc une année, et prend celle en cours par défaut.
 */
export const OWNER_ANNEE_OBLIGATOIRE = new Set([
  "/owner/dashboard",
  /*
    Impayés : depuis le retrait du sélecteur de période, l'année scolaire est la
    SEULE dimension de temps de l'écran. « Toutes les années » y additionnerait
    cinq recouvrements en un chiffre qui ne décrit aucune rentrée — et, la
    cascade en aval étant commandée par l'année, laisserait le sélecteur de
    classe proposer les quarante lignes du catalogue.
  */
  "/owner/finances/tresorerie",
]);

/**
 * Années d'une option, en tolérant leur absence.
 *
 * Le type promet `string[]`, le réseau ne le garantit pas : une API pas encore
 * redémarrée, un déploiement en cours ou une réponse servie depuis le cache de
 * React Query renvoient des options d'avant ce champ. Y lire `.length`
 * directement fait tomber toute la barre de filtres — et avec elle l'écran.
 */
function anneesDe(option: { annees?: string[] }): string[] {
  return option.annees ?? [];
}

export function OwnerFilterBar({
  dimensions,
  periods = ALL_PERIODS,
  anneeObligatoire = false,
}: {
  dimensions: OwnerFilterDimension[];
  periods?: OwnerPeriod[];
  /**
   * L'écran exige TOUJOURS une année : « Toutes les années » n'est pas proposé,
   * et l'année en cours — à défaut la plus récente — est sélectionnée d'office.
   */
  anneeObligatoire?: boolean;
}) {
  const {
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
    setAnneeScolaire,
    setCycleId,
    setFiliereIds,
    setNomClasse,
    setSemestreId,
    setCategorie,
    setPeriod,
    setCustomRange,
    reset,
    isFiltered,
    options,
    optionsLoading,
  } = useOwnerFilters();

  const anneeEnCours = anneeEnCoursLocale();
  const anneesOffertes = options?.anneesScolaires ?? [];

  /**
   * Année par défaut sur un écran qui en exige une : celle en cours si elle
   * porte de l'activité, sinon la plus récente — la liste arrive déjà triée du
   * plus récent au plus ancien.
   *
   * `undefined` tant que le référentiel n'est pas chargé : on n'écrit rien dans
   * l'URL avant de savoir quelles années existent.
   */
  const anneeParDefaut = anneesOffertes.includes(anneeEnCours)
    ? anneeEnCours
    : anneesOffertes[0];

  /**
   * La sélection par défaut est ÉCRITE DANS L'URL, pas seulement affichée.
   *
   * Sans cette écriture, le champ montrerait « 2025-2026 » pendant que la page
   * interrogerait l'API sans année — les chiffres décriraient le présent sous
   * une étiquette d'année. Un `replace` : la valeur par défaut ne mérite pas une
   * entrée d'historique, sinon « Précédent » ne sortirait jamais de l'écran.
   */
  useEffect(() => {
    if (!anneeObligatoire || anneeScolaire || !anneeParDefaut) return;
    setAnneeScolaire(anneeParDefaut);
  }, [anneeObligatoire, anneeScolaire, anneeParDefaut, setAnneeScolaire]);

  const show = (d: OwnerFilterDimension) => dimensions.includes(d);

  /**
   * L'ANNÉE COMMANDE LES LISTES EN AVAL — cascade année → classe → semestre,
   * le modèle de l'écran Paiements du module professionnel.
   *
   * Une classe n'existe que dans les années où elle a ouvert des sessions. La
   * proposer sur une autre année offre un croisement qui ne ramènera jamais
   * rien, et l'écran vide qui en résulte se lit comme une absence de données
   * plutôt que comme un filtre impossible.
   *
   * Constaté sur cette base : 40 classes au catalogue, 6 avec de l'activité ;
   * 120 semestres, 16 avec des sessions. Sans la cascade, choisir 2023-2024
   * proposait quand même les 40 et les 120.
   *
   * `aCascade` est un GARDE-FOU, pas une optimisation : si la requête du
   * référentiel échoue, toutes les entrées reviennent sans année, et scoper
   * sur l'année viderait le sélecteur au lieu de le restreindre. Tant qu'aucune
   * entrée ne porte d'année, on n'applique rien — un filtre dégradé vaut mieux
   * qu'une liste vide inexplicable.
   */
  const dansAnnee = (annees: string[], aCascade: boolean) =>
    !show("year") || !anneeScolaire || !aCascade || annees.includes(anneeScolaire);

  /**
   * Filières proposées : restreintes au cycle choisi quand l'écran filtre aussi
   * par cycle, et à l'année retenue.
   */
  const filiereOptions = useMemo(() => {
    const liste = options?.filieres ?? [];
    const aCascade = liste.some((f) => anneesDe(f).length > 0);
    return liste.filter(
      (f) =>
        (!show("cycle") || !cycleId || f.cycleId === cycleId) &&
        dansAnnee(anneesDe(f), aCascade)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.filieres, cycleId, anneeScolaire, dimensions]);

  /**
   * Noms de classe proposés — LA dimension de filtrage des écrans admin.
   *
   * Ce champ affichait jusqu'ici la liste des FILIÈRES sous l'étiquette « Nom
   * de classe » : sur cette base les deux coïncident, mais une filière portant
   * deux classes (« LICENCE 1 TRANSPORT LOGISTIQUE » et « … B » existent sur la
   * même) rendait les deux indiscernables, et sélectionner l'une ramenait les
   * deux. La liste vient désormais du référentiel, dérivée du libellé des
   * ouvertures par la même règle que les pages Paiements et Étudiants inscrits.
   */
  const nomClasseOptions = useMemo(() => {
    const liste = options?.nomsDeClasse ?? [];
    const aCascade = liste.some((n) => n.annees.length > 0);
    return liste.filter((n) => dansAnnee(n.annees, aCascade));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.nomsDeClasse, anneeScolaire, dimensions]);

  /** Semestres atteignables depuis la classe retenue — dernier maillon. */
  const semestresDeLaClasse = useMemo(
    () => nomClasseOptions.find((n) => n.value === nomClasse)?.semestreIds ?? null,
    [nomClasseOptions, nomClasse]
  );

  /**
   * Semestres proposés : ceux des filières retenues et de l'année retenue.
   *
   * Sans ce filtrage, la liste mélangerait les « Semestre 1 » de toutes les
   * filières de l'établissement — indiscernables à l'écran, et dont un seul
   * ramènerait des données une fois combiné au filtre de filière.
   */
  const semestreOptions = useMemo(() => {
    const liste = options?.semestres ?? [];
    const aCascade = liste.some((s) => anneesDe(s).length > 0);
    return liste.filter(
      (s) =>
        (filiereIds.length === 0 || filiereIds.includes(s.filiereId)) &&
        // Cascade de la page Paiements : la classe retenue commande la liste
        // des semestres, et non l'inverse.
        (!semestresDeLaClasse || semestresDeLaClasse.includes(s.id)) &&
        dansAnnee(anneesDe(s), aCascade)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.semestres, filiereIds, semestresDeLaClasse, anneeScolaire, dimensions]);

  /**
   * Une sélection que la nouvelle année ne propose plus est ABANDONNÉE, pas
   * conservée en silence.
   *
   * Passer de 2023-2024 à 2024-2025 change la classe disponible : garder
   * l'ancienne laisserait le champ afficher un nom absent de sa propre liste,
   * et la page interroger l'API sur un croisement vide.
   *
   * On ne remet pas à zéro comme le fait le changement de cycle : une classe
   * ouverte deux années de suite reste sélectionnée, seules les entrées
   * devenues impossibles tombent. Rien n'est écrit tant que le référentiel n'a
   * pas répondu — sinon le chargement effacerait une sélection venue de l'URL.
   */
  useEffect(() => {
    if (!options || optionsLoading) return;

    // Seules les dimensions que l'écran AFFICHE sont nettoyées. Un `filieres=`
    // hérité de l'écran précédent n'a pas à être effacé par un tableau de bord
    // qui ne l'utilise pas : il doit survivre au retour en arrière.
    if (dimensions.includes("filieres") || dimensions.includes("nomClasse")) {
      const filieresValides = filiereIds.filter((id) =>
        filiereOptions.some((f) => f.id === id)
      );
      if (filieresValides.length !== filiereIds.length) {
        setFiliereIds(filieresValides);
        return; // Le semestre sera revu au rendu suivant, sur la liste à jour.
      }
    }

    if (
      dimensions.includes("nomClasse") &&
      nomClasse &&
      !nomClasseOptions.some((n) => n.value === nomClasse)
    ) {
      setNomClasse(undefined);
      return; // Le semestre sera revu au rendu suivant, sur la liste à jour.
    }

    if (
      dimensions.includes("semestre") &&
      semestreId &&
      !semestreOptions.some((s) => s.id === semestreId)
    ) {
      setSemestreId(undefined);
    }
  }, [
    dimensions,
    options,
    optionsLoading,
    filiereIds,
    filiereOptions,
    nomClasse,
    nomClasseOptions,
    semestreId,
    semestreOptions,
    setFiliereIds,
    setNomClasse,
    setSemestreId,
  ]);

  if (dimensions.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-end gap-4">
        {show("year") && (
          <div className="flex-1 min-w-[180px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Année scolaire</Label>
            <Select
              value={anneeScolaire ?? OWNER_FILTER_ALL}
              onValueChange={(v) =>
                setAnneeScolaire(v === OWNER_FILTER_ALL ? undefined : v)
              }
              disabled={optionsLoading}
            >
              <SelectTrigger>
                {/*
                  Sur un écran à année obligatoire, « Toutes » ne peut pas être
                  la mention d'attente : c'est justement le choix qui n'existe
                  pas. Le champ ne reste vide que le temps du chargement, ou si
                  aucune classe n'a jamais été ouverte.
                */}
                <SelectValue
                  placeholder={
                    anneeObligatoire
                      ? anneesOffertes.length === 0 && !optionsLoading
                        ? "Aucune année"
                        : "…"
                      : "Toutes"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {/*
                  « Toutes les années » n'est proposé que là où l'agrégat de
                  plusieurs années a un sens. Sur le tableau de bord, il n'en a
                  pas : additionner cinq rentrées ne décrit aucune situation, et
                  la question posée — « comment va l'école ? » — appelle une
                  année précise.
                */}
                {!anneeObligatoire && (
                  <SelectItem value={OWNER_FILTER_ALL}>Toutes les années</SelectItem>
                )}
                {/*
                  Les années DÉRIVÉES des ouvertures de classe, pas les lignes de
                  `academic_years`. Chaque entrée correspond donc à au moins une
                  classe réellement ouverte : la liste ne propose jamais une
                  année vide, et n'en cache jamais une qui a de l'activité.
                */}
                {anneesOffertes.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                    {a === anneeEnCours ? " · en cours" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {show("cycle") && (
          <div className="flex-1 min-w-[180px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cycle</Label>
            <Select
              value={cycleId ?? OWNER_FILTER_ALL}
              // Le nettoyage des filières et du semestre est fait par
              // `setCycleId` lui-même. L'enchaîner ici avec un second appel
              // écraserait le premier : les deux lisent la même URL de départ.
              onValueChange={(v) => setCycleId(v === OWNER_FILTER_ALL ? undefined : v)}
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
          <div className="flex-1 min-w-[200px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Filières</Label>
            <FiliereFilter
              filieres={filiereOptions}
              value={filiereIds}
              onChange={setFiliereIds}
              disabled={optionsLoading}
            />
          </div>
        )}

        {show("nomClasse") && (
          <div className="flex-1 min-w-[260px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nom de classe</Label>
            {/*
              Sélection unique et recherchable, comme sur l'écran Paiements : la
              liste est déjà restreinte à l'année, et l'établissement compte
              assez de classes pour qu'on veuille les chercher au clavier.

              La valeur vit dans son propre paramètre d'URL (`cls`) et porte la
              clé « filiereId|nom » de la page Paiements — deux filières peuvent
              avoir donné le même nom à une classe.
            */}
            <SearchableSelect
              value={nomClasse ?? OWNER_FILTER_ALL}
              onChange={(v) => setNomClasse(v === OWNER_FILTER_ALL ? undefined : v)}
              placeholder="Tous les noms de classe"
              searchPlaceholder="Rechercher un nom de classe…"
              disabled={optionsLoading}
              options={[
                { value: OWNER_FILTER_ALL, label: "Tous les noms de classe" },
                ...nomClasseOptions.map((n) => ({ value: n.value, label: n.nom })),
              ]}
            />
          </div>
        )}

        {show("semestre") && (
          <div className="flex-1 min-w-[190px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Semestre</Label>
            <Select
              value={semestreId ?? OWNER_FILTER_ALL}
              onValueChange={(v) => setSemestreId(v === OWNER_FILTER_ALL ? undefined : v)}
              disabled={optionsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tous" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OWNER_FILTER_ALL}>Tous les semestres</SelectItem>
                {semestreOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {show("categorie") && (
          <div className="flex-1 min-w-[180px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Catégorie d&apos;UE</Label>
            <Select
              value={categorie ?? OWNER_FILTER_ALL}
              onValueChange={(v) => setCategorie(v === OWNER_FILTER_ALL ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Toutes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OWNER_FILTER_ALL}>Toutes les catégories</SelectItem>
                {Object.entries(CATEGORIE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {show("period") && (
          <div className="flex-1 min-w-[160px] space-y-1.5">
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

        {/*
          Sur un écran à année obligatoire, l'année par défaut n'est PAS un
          filtre : c'est l'état normal de l'écran. Compter cette sélection comme
          une restriction afficherait un bouton « Réinitialiser » qui, une fois
          cliqué, remettrait aussitôt la même année — un bouton qui ne fait rien
          se lit comme un bouton cassé.
        */}
        {isFiltered && !(anneeObligatoire && anneeScolaire === anneeParDefaut) && (
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
