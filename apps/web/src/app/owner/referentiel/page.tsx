"use client";

import { OwnerTabs } from "@/components/owner/OwnerTabs";
import { SanteReferentiel } from "./SanteReferentiel";
import { FormationsPro } from "./FormationsPro";

/**
 * Catalogue — tout ce que l'établissement vend, et l'état de la structure qui
 * le décrit.
 *
 * Le référentiel (cycles → filières → UE → ECUE) porte l'offre diplômante ; les
 * formations professionnelles courtes portent l'offre en entreprise. Deux
 * tables, deux modèles économiques, une seule question de fondateur : « qu'est-ce
 * que je propose, et est-ce que c'est propre ? »
 */
export default function OwnerCataloguePage() {
  return (
    <OwnerTabs
      tabs={[
        { value: "referentiel", label: "Offre diplômante", content: <SanteReferentiel /> },
        { value: "formations", label: "Formations pro", content: <FormationsPro /> },
      ]}
    />
  );
}
