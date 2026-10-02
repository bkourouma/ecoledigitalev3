/**
 * Feux d'avancement d'une classe (direction) : règle d'AFFICHAGE simple, documentée ici, calculée à partir des COMPTAGES BRUTS
 * renvoyés par l'API (`GET /progress`). Ce n'est NI un seuil réglementaire NI une décision : aucun pourcentage, aucune échéance.
 *
 *   - ROUGE  : des compétences sont attendues et RIEN n'est saisi ;
 *   - VERT   : tout est saisi ET tout est validé, et tous les bilans existants sont scellés ;
 *   - ORANGE : tout le reste (saisie commencée, validation ou scellement en cours) ;
 *   - SANS OBJET : aucune compétence attendue (pas de référentiel ou classe vide).
 *
 * Le feu n'est jamais le seul signal : l'écran affiche aussi un texte et une icône, et les comptages eux-mêmes.
 */

import type { PrimaryProgressDto } from "@ecoledigitale/contracts/v2/primary_school";

export type Light = "red" | "orange" | "green" | "none";
export type LightReason = "nothing_entered" | "in_progress" | "complete" | "no_expectation";

export interface LightView {
  light: Light;
  reason: LightReason;
}

export function lightOf(p: Pick<PrimaryProgressDto, "competencies" | "reviews">): LightView {
  const { expected, recorded, validated } = p.competencies;
  if (expected === 0) return { light: "none", reason: "no_expectation" };
  if (recorded === 0) return { light: "red", reason: "nothing_entered" };
  const allEntered = recorded >= expected;
  const allValidated = validated >= expected;
  const allSealed = p.reviews.total === 0 || p.reviews.sealed >= p.reviews.total;
  if (allEntered && allValidated && allSealed) return { light: "green", reason: "complete" };
  return { light: "orange", reason: "in_progress" };
}
