"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Ancienne adresse du remplissage, devenue « Ouvertures, salles & planning ».
 *
 * Le mot « remplissage » ne décrivait qu'une colonne de l'écran. Depuis que
 * chaque ouverture y est une LIGNE ÉCONOMIQUE — inscrits, attendu, encaissé,
 * reste dû —, le taux de remplissage n'est plus qu'un indicateur parmi six, et
 * l'adresse annonçait moins que la page.
 *
 * Conservée en redirection : les liens profonds du pouls pointent encore ici,
 * et une adresse morte perd le lecteur au lieu de le déplacer. Les paramètres
 * de filtre sont transmis tels quels — un favori doit rouvrir le même
 * périmètre, pas l'écran nu.
 */
export default function OwnerRemplissageRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(`/owner/ouvertures${qs ? `?${qs}` : ""}`);
  }, [router, searchParams]);

  return <div className="text-muted-foreground">Redirection vers « Ouvertures »…</div>;
}
