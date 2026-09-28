import type {
  OwnerComparaison,
  OwnerComparaisonBasis,
} from "@ecoledigitale/contracts";

/**
 * Fabrique unique des comparaisons avec l'année précédente.
 *
 * POURQUOI UN SEUL ENDROIT
 *
 * La règle « ne pas mentir quand l'an dernier n'existe pas » tient en quatre
 * cas, et chacun a déjà été réimplémenté de travers quelque part : un écran qui
 * affiche « -100 % » parce que la classe n'avait pas encore ouvert, un autre qui
 * affiche « +100 % » sur une base nulle, un troisième qui compare un exercice
 * entier à un exercice arrêté à date. Les quatre cas sont donc codés ici, une
 * fois, et les services n'ont plus qu'à fournir des nombres.
 *
 * CE QUE LE SERVEUR DÉCIDE, PAS L'ÉCRAN
 *
 * C'est le serveur qui tranche « mesurable ou non », parce qu'il est le seul à
 * savoir si l'an dernier portait de l'activité sur CE périmètre. D'où le
 * paramètre `lignesPrecedentes` : sans lui, on ne distingue pas « l'an dernier a
 * rapporté 0 FCFA » de « l'an dernier n'avait pas cette classe ». Le premier est
 * une contre-performance, le second n'est rien du tout, et les afficher pareil
 * est la faute que ce module existe pour empêcher.
 */

/** Arrondi à la décimale, celui de tous les taux de l'espace propriétaire. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Comparaison d'une valeur de l'exercice courant à celle de l'exercice
 * précédent.
 *
 * @param valeur             mesure de l'exercice demandé
 * @param precedent          mesure de l'exercice précédent, `null` si non calculée
 * @param lignesPrecedentes  nombre de lignes source de l'exercice précédent.
 *                           Zéro veut dire « rien à mesurer », et NON « zéro FCFA ».
 * @param opts.anneePrecedente millésime comparé, `null` si aucune année demandée
 * @param opts.basis         base de comparaison (cf. OwnerComparaisonBasisSchema)
 * @param opts.unite         suffixe d'unité pour la phrase, par exemple " FCFA"
 */
export function comparer(
  valeur: number,
  precedent: number | null,
  lignesPrecedentes: number,
  opts: {
    anneePrecedente: string | null;
    basis: OwnerComparaisonBasis;
    unite?: string;
  }
): OwnerComparaison {
  const { anneePrecedente, unite = "" } = opts;

  // 1. Aucune année demandée : il n'y a pas d'exercice précédent à désigner.
  //    « Toutes les années » moins une ne décrit aucune situation.
  if (anneePrecedente === null) {
    return {
      anneePrecedente: null,
      previousValue: null,
      previousLabel: "Comparaison possible en choisissant une année scolaire",
      delta: null,
      deltaPct: null,
      basis: "non_comparable",
      measured: false,
    };
  }

  // 2. L'exercice précédent n'a aucune ligne sur ce périmètre : la classe n'avait
  //    pas ouvert, ou n'existait pas. Aucun écart à afficher — pas même zéro.
  if (lignesPrecedentes === 0 || precedent === null) {
    return {
      anneePrecedente,
      previousValue: null,
      previousLabel: `Pas d'activité en ${anneePrecedente} sur ce périmètre`,
      delta: null,
      deltaPct: null,
      basis: "non_comparable",
      measured: false,
    };
  }

  const delta = round1(valeur - precedent);

  // 3. L'exercice précédent existait mais valait zéro. L'écart absolu a un sens,
  //    le rapport n'en a aucun : tout pourcentage sur une base nulle est inventé.
  if (precedent === 0) {
    return {
      anneePrecedente,
      previousValue: 0,
      previousLabel: `${anneePrecedente} : 0${unite}`,
      delta,
      deltaPct: null,
      basis: opts.basis,
      measured: true,
    };
  }

  // 4. Le cas ordinaire.
  return {
    anneePrecedente,
    previousValue: precedent,
    previousLabel: `${anneePrecedente} : ${precedent}${unite}`,
    delta,
    deltaPct: round1((100 * (valeur - precedent)) / precedent),
    basis: opts.basis,
    measured: true,
  };
}
