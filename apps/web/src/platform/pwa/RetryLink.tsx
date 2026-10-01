"use client";

import { useEffect, useState } from "react";
import { safeReturnPath } from "./offline";

/** Lien « Réessayer » de la page hors ligne : revient à la page demandée (`?from=`), sinon à l'accueil. */
export function RetryLink({ label }: { label: string }) {
  const [href, setHref] = useState("/");
  useEffect(() => {
    setHref(safeReturnPath(new URLSearchParams(window.location.search).get("from")));
  }, []);
  return (
    // Lien simple (navigation complète) : fonctionne aussi sans JavaScript, avec "/" pour cible.
    <a href={href} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
      {label}
    </a>
  );
}
