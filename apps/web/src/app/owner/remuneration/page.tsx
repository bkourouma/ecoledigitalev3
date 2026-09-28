"use client";

import { OwnerTabs } from "@/components/owner/OwnerTabs";
import { MasseSalariale } from "./MasseSalariale";
import { Configuration } from "./Configuration";

/**
 * Rémunération — refonte de `/owner/staff`.
 *
 * POURQUOI DEUX ONGLETS ET NON QUATRE
 *
 * Le plan prévoyait quatre onglets, miroir des quatre entrées du menu
 * administrateur : Configuration, Validation des séances, Bulletins de paiement,
 * Historique. Deux d'entre eux — les bulletins et l'historique — existaient déjà
 * dans l'écran « Masse salariale », avec leurs filtres de période, d'enseignant,
 * de statut et d'archivage. Les en extraire aurait produit deux onglets qui
 * partagent les mêmes filtres et le même tableau, pour la seule satisfaction de
 * compter jusqu'à quatre.
 *
 * Les deux qui manquaient vraiment — Configuration et Validation des séances —
 * sont réunis, parce qu'ils répondent à UNE question : pourquoi rien n'est
 * payable ? Trois verrous se posent dans l'ordre (une configuration, une
 * validation, un tarif en vigueur), et les séparer obligerait à visiter deux
 * écrans pour comprendre un seul blocage.
 */
export default function OwnerRemunerationPage() {
  return (
    <OwnerTabs
      tabs={[
        { value: "masse", label: "Masse salariale", content: <MasseSalariale /> },
        {
          value: "configuration",
          label: "Configuration & séances",
          content: <Configuration />,
        },
      ]}
    />
  );
}
