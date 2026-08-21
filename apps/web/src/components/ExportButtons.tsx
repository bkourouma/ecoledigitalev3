"use client";

import { useState } from "react";
import { Button } from "@ecoledigitale/ui";
import { FileText, FileType, Loader2 } from "lucide-react";
import { ouvrirOngletPdf, POPUP_BLOQUEE } from "@/lib/utils/report-pdf";

export interface ExportButtonsProps {
  /** Compose et affiche le PDF dans `win`, l'onglet ouvert au clic. */
  onExportPdf: (win: Window) => Promise<void>;
  /** Inutile quand `formats` ne contient pas « word ». */
  onExportWord?: () => Promise<void>;
  /** Formats proposés, dans l'ordre des boutons. Par défaut : PDF et Word. */
  formats?: Array<"pdf" | "word">;
  disabled?: boolean;
  /** Remonte l'erreur à l'écran (popup bloquée, échec de composition). */
  onError?: (message: string) => void;
  /** Libellés courts pour les barres d'outils denses. */
  labels?: { pdf?: string; word?: string };
  size?: "sm" | "default";
}

/**
 * Paire de boutons « PDF » / « Word » des écrans à export direct.
 *
 * L'onglet du PDF est ouvert dans le geste de clic : ouvert après la
 * composition (asynchrone, parfois précédée d'appels API), il serait bloqué
 * comme popup.
 */
export function ExportButtons({
  onExportPdf,
  onExportWord,
  formats = ["pdf", "word"],
  disabled,
  onError,
  labels,
  size = "default",
}: ExportButtonsProps) {
  const [busy, setBusy] = useState<"pdf" | "word" | null>(null);

  const signaler = (e: any) => {
    const message = e?.message ?? "Erreur lors de l'export.";
    if (onError) onError(message);
    else alert(message);
  };

  const exporterPdf = async () => {
    const win = ouvrirOngletPdf();
    if (!win) {
      signaler(new Error(POPUP_BLOQUEE));
      return;
    }
    setBusy("pdf");
    try {
      await onExportPdf(win);
    } catch (e) {
      signaler(e);
    } finally {
      setBusy(null);
    }
  };

  const exporterWord = async () => {
    if (!onExportWord) return;
    setBusy("word");
    try {
      await onExportWord();
    } catch (e) {
      signaler(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {formats.includes("pdf") && (
        <Button
          variant="outline"
          size={size}
          onClick={exporterPdf}
          disabled={disabled || busy !== null}
          className="bg-red-50 border-red-200 hover:bg-red-100 text-red-700 hover:text-red-800 shadow-sm"
        >
          {busy === "pdf" ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <FileText className="h-4 w-4 mr-2" />
          )}
          {labels?.pdf ?? "PDF"}
        </Button>
      )}
      {formats.includes("word") && (
        <Button
          variant="outline"
          size={size}
          onClick={exporterWord}
          disabled={disabled || busy !== null}
          className="bg-blue-50 border-blue-200 hover:bg-blue-100 text-blue-700 hover:text-blue-800 shadow-sm"
        >
          {busy === "word" ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <FileType className="h-4 w-4 mr-2" />
          )}
          {labels?.word ?? "Word"}
        </Button>
      )}
    </>
  );
}
