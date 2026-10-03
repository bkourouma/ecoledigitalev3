import { redirect } from "next/navigation";

/**
 * `/v2/owner` : l'atterrissage du propriétaire est le tableau de bord de la direction (`/v2/direction`). L'écran technique
 * « Fraîcheur des données de pilotage » est désormais `/v2/owner/fraicheur` (dernier onglet du pilotage).
 */
export default function OwnerHomePage() {
  redirect("/v2/direction");
}
