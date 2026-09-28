"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Ancienne adresse du catalogue, devenue « Cycles, filières & classes »
 * (`/owner/structure`).
 *
 * Le mot « référentiel » décrit une table, pas une question de fondateur.
 * Depuis que chaque classe y porte son économie — ouvertures, barème, CA
 * théorique, encaissé —, l'écran répond à « laquelle tourne, laquelle dort,
 * laquelle facture », ce que le mot « référentiel » n'annonçait pas.
 *
 * Conservée en redirection, avec ses paramètres : un favori doit rouvrir le même
 * périmètre et le même onglet, pas l'écran nu.
 */
export default function OwnerReferentielRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(`/owner/structure${qs ? `?${qs}` : ""}`);
  }, [router, searchParams]);

  return <div className="text-muted-foreground">Redirection vers « Cycles, filières &amp; classes »…</div>;
}
