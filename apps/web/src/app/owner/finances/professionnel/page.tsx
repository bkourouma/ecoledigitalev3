"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Ancienne adresse du recouvrement professionnel.
 *
 * L'écran est devenu « Impayés ». Cette route survit en redirection plutôt
 * qu'en suppression : elle est câblée dans des liens profonds — alertes de
 * pilotage, tuiles du pouls, favoris du propriétaire — et une adresse qui
 * renvoie 404 vaut moins qu'une adresse qui mène où il faut.
 *
 * Les paramètres de filtre sont recopiés : arriver ici depuis une alerte déjà
 * filtrée doit ouvrir le même périmètre de l'autre côté. Le `?vue=professionnel`
 * qu'ajoutait cette redirection du temps des onglets a disparu avec eux : la
 * barre de filtres ne reconnaît plus cet onglet et n'aurait affiché aucun
 * filtre (`ownerFilterScopeFor` refuse de retomber sur la clé générale).
 */
export default function OwnerRecouvrementProRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("vue");
    const qs = next.toString();
    router.replace(`/owner/finances/tresorerie${qs ? `?${qs}` : ""}`);
  }, [router, searchParams]);

  return <div className="text-muted-foreground">Redirection vers « Impayés »…</div>;
}
