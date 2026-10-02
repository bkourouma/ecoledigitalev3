"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { requestDownload } from "@/platform/v2/reportcards";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock } from "@/platform/ui/states";

/**
 * Téléchargement contrôlé : l'API vérifie le droit puis renvoie une URL signée de courte durée, ouverte aussitôt dans un
 * nouvel onglet (jamais conservée ni affichée). Les erreurs (PDF non prêt, accès refusé) s'affichent sous le bouton.
 */
export function DownloadButton({ path, label, ariaLabel, variant = "secondary" }: { path: string; label: string; ariaLabel?: string; variant?: "primary" | "secondary" | "ghost" }) {
  const t = useTranslations("v2Reportcards.common");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const d = await requestDownload(path);
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={buttonClass[variant]} onClick={() => void download()} disabled={pending} aria-label={ariaLabel} title={t("downloadHint")}>
        {pending ? t("preparing") : label}
      </button>
      {error ? <ErrorBlock error={error} className="max-w-xs" /> : null}
    </span>
  );
}
