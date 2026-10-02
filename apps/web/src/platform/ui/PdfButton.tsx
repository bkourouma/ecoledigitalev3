"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { buttonClass } from "./PageHeader";
import { downloadPdf, type PdfOptions } from "./pdf";
import { ErrorBlock, Notice } from "./states";

/**
 * Bouton de téléchargement d'un PDF servi par l'API (jeton dans l'en-tête). États annoncés : préparation, document encore en
 * cours de rendu (réessayer), erreur de l'API affichée telle quelle (404 hors périmètre, 409 rendu échoué…).
 */
export function PdfButton({
  path,
  fileName,
  label,
  ariaLabel,
  variant = "secondary",
  options,
}: {
  path: string;
  fileName: string;
  label: string;
  ariaLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  options?: PdfOptions;
}) {
  const t = useTranslations("v2Portal.pdf");
  const [state, setState] = useState<"idle" | "busy" | "pending">("idle");
  const [error, setError] = useState<unknown>(null);

  async function run() {
    setState("busy");
    setError(null);
    try {
      const out = await downloadPdf(path, fileName, options);
      setState(out.state === "pending" ? "pending" : "idle");
    } catch (e) {
      setError(e);
      setState("idle");
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={buttonClass[variant]} onClick={() => void run()} disabled={state === "busy"} aria-label={ariaLabel} aria-busy={state === "busy" || undefined}>
        {state === "busy" ? t("preparing") : label}
      </button>
      {state === "pending" ? <Notice kind="info" className="max-w-xs">{t("pending")}</Notice> : null}
      {error ? <ErrorBlock error={error} className="max-w-xs" /> : null}
    </span>
  );
}
