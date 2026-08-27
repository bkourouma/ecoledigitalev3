"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Ancienne adresse des formations professionnelles, devenue le second onglet de
 * « Catalogue ».
 */
export default function OwnerFormationsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("vue", "formations");
    router.replace(`/owner/referentiel?${next.toString()}`);
  }, [router, searchParams]);

  return <div className="text-muted-foreground">Redirection vers « Catalogue »…</div>;
}
