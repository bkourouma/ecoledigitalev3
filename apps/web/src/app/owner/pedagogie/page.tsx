"use client";

import { OwnerTabs } from "@/components/owner/OwnerTabs";
import { ResultatsScolaire } from "./ResultatsScolaire";
import { ResultatsProfessionnel } from "./ResultatsProfessionnel";

/**
 * Résultats — une seule question, deux moteurs pédagogiques.
 *
 * Le scolaire note par période sur des moyennes de classe ; le professionnel
 * valide des UE en crédits, avec des décisions de jury et une session de
 * rattrapage. Aucune moyenne commune n'a de sens entre les deux — une « moyenne
 * générale de l'établissement » qui mélangerait un /20 de troisième et une
 * validation d'UE LMD ne voudrait rien dire.
 *
 * D'où deux onglets plutôt qu'un tableau consolidé : le propriétaire pose une
 * seule question, l'écran lui donne la réponse dans le vocabulaire du moteur
 * concerné.
 */
export default function OwnerResultatsPage() {
  return (
    <OwnerTabs
      tabs={[
        { value: "scolaire", label: "Scolaire", content: <ResultatsScolaire /> },
        {
          value: "professionnel",
          label: "Professionnel",
          content: <ResultatsProfessionnel />,
        },
      ]}
    />
  );
}
