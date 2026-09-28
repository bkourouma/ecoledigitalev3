"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Ancienne adresse de la masse salariale, devenue « Rémunération »
 * (`/owner/remuneration`).
 *
 * « Staff » ne désignait qu'une population ; l'écran traite de ce qu'elle coûte
 * et de ce qui bloque son paiement. Depuis qu'il porte aussi la configuration de
 * la paie et la validation des séances, l'adresse annonçait moins que la page.
 *
 * Conservée en redirection, avec ses paramètres : un favori doit rouvrir la même
 * période et le même enseignant, pas l'écran nu.
 */
export default function OwnerStaffRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(`/owner/remuneration${qs ? `?${qs}` : ""}`);
  }, [router, searchParams]);

  return <div className="text-muted-foreground">Redirection vers « Rémunération »…</div>;
}
