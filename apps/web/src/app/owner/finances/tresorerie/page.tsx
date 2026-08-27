"use client";

import { ImpayesProfessionnel } from "./ImpayesProfessionnel";

/**
 * Impayés — recouvrement du module professionnel.
 *
 * L'écran a longtemps porté deux onglets, « Scolaire » et « Professionnel ». Le
 * premier a été retiré : son titre annonçait la scolarité, mais ses blocs —
 * balance âgée, courbe de trésorerie, écarts et journal de caisse — étaient
 * alimentés par les commandes d'UE, la moitié scolaire n'ayant aucune échéance
 * saisie. Un onglet qui promet une chose et en montre une autre coûte plus cher
 * qu'il ne rapporte.
 *
 * Ces quatre blocs n'ont pas disparu avec lui : ils vivent maintenant dans
 * `ImpayesProfessionnel`, là où leurs données étaient déjà. Le jour où la
 * scolarité aura ses propres échéanciers, la balance âgée les fera apparaître
 * d'elle-même — elle est restée consolidée, et sa série « Scolarité » n'attend
 * que des données.
 */
export default function OwnerImpayesPage() {
  return <ImpayesProfessionnel />;
}
