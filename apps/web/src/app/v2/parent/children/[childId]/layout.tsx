import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ChildHeader } from "@/platform/portal/ChildScope";
import { isUuid } from "@/platform/portal/ids";

/**
 * Habillage d'un enfant : sélecteur d'enfant et onglets des sections. L'identifiant d'URL mal formé est un 404 immédiat ; un
 * identifiant bien formé mais NON rattaché au compte est refusé par l'écran (liste des enfants liés) avant toute lecture, et par
 * chaque module de l'API (404 ou 403 uniformes) à chaque requête.
 */
export default async function ChildLayout({ children, params }: { children: ReactNode; params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  if (!isUuid(childId)) notFound();
  return (
    <>
      <ChildHeader childId={childId} />
      {children}
    </>
  );
}
