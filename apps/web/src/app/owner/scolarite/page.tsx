"use client";

import { Scolarite } from "./Scolarite";

/**
 * Scolarité — inscriptions et effectifs inscrits.
 *
 * Le menu administrateur a « Scolarité » depuis toujours ; l'espace
 * propriétaire n'en avait aucun pendant, et `/owner/finances` avait
 * délibérément sorti la scolarité de son périmètre. Le poste le plus lourd de
 * l'école n'apparaissait donc nulle part côté fondateur.
 */
export default function OwnerScolaritePage() {
  return <Scolarite />;
}
