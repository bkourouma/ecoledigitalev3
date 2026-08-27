"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  OWNER_ANNEE_OBLIGATOIRE,
  OWNER_PERIOD_OPTIONS,
  OwnerFilterBar,
  ownerFilterScopeFor,
} from "./OwnerFilterBar";

/**
 * Emplacement de la barre de filtre, sous la frontière Suspense du layout.
 *
 * Le layout ne peut pas appeler `useSearchParams` lui-même : c'est lui qui pose
 * le `<Suspense>` qu'exige ce hook côté App Router, il est donc au-dessus de la
 * frontière. Or la portée des filtres dépend désormais de `?vue=`, l'onglet
 * courant des écrans fusionnés. Ce composant fait la lecture du bon côté.
 *
 * Il ne rend rien quand l'écran (ou l'onglet) n'accepte aucun paramètre : une
 * barre vide vaudrait promesse de filtrage.
 */
export function OwnerFilterSlot() {
  const pathname = usePathname();
  const vue = useSearchParams().get("vue");
  const dimensions = ownerFilterScopeFor(pathname, vue);

  if (dimensions.length === 0) return null;

  return (
    <div className="mb-6">
      <OwnerFilterBar
        dimensions={dimensions}
        periods={OWNER_PERIOD_OPTIONS[pathname]}
        anneeObligatoire={OWNER_ANNEE_OBLIGATOIRE.has(pathname)}
      />
    </div>
  );
}
