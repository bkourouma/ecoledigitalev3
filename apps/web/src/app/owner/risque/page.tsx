"use client";

import { QualiteRisque } from "./QualiteRisque";

/**
 * Points de vigilance — qui risque de décrocher, et qu'est-ce qui n'est pas
 * saisi.
 *
 * L'écran a porté un temps deux onglets : une file d'alertes de pilotage et
 * cette analyse. Les alertes ont été RETIRÉES de l'espace propriétaire sur
 * décision métier ; il ne reste donc qu'un contenu, et un sélecteur d'onglet
 * unique serait un clic pour rien.
 */
export default function OwnerVigilancePage() {
  return <QualiteRisque />;
}
