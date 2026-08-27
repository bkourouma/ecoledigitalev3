"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Ancienne adresse des synthèses académiques, devenue l'onglet « Scolaire » de
 * « Résultats ». Conservée en redirection : le pouls et les alertes pointent
 * encore ici, et une adresse morte perd le lecteur au lieu de le déplacer.
 */
export default function OwnerAcademiqueRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("vue", "scolaire");
    router.replace(`/owner/pedagogie?${next.toString()}`);
  }, [router, searchParams]);

  return <div className="text-muted-foreground">Redirection vers « Résultats »…</div>;
}
