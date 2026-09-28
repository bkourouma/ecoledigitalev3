"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Ancienne adresse des formations professionnelles. Leur onglet de
 * « Catalogue » a été retiré le 23/09/2026 : la redirection mène désormais à
 * l'écran nu, sans `vue=formations`, qui désignerait un onglet disparu.
 */
export default function OwnerFormationsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("vue");
    const qs = next.toString();
    router.replace(`/owner/structure${qs ? `?${qs}` : ""}`);
  }, [router, searchParams]);

  return <div className="text-muted-foreground">Redirection vers « Catalogue »…</div>;
}
