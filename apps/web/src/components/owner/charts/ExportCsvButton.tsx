"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { createApiHeaders } from "@/lib/api-utils";

type ExportCsvButtonProps = {
  /** Chemin de l'endpoint d'export, ex. `/api/v1/owner/pedagogie/export`. */
  endpoint: string;
  /** Query string déjà construite, identique à celle de la page affichée. */
  queryString?: string;
  /** Nom du fichier proposé au téléchargement. */
  filename: string;
  label?: string;
};

/**
 * Téléchargement authentifié d'un export CSV.
 *
 * On ne peut pas se contenter d'un `<a href>` : l'appel doit porter les en-têtes
 * de session (tenant), qu'un lien natif n'envoie pas. On récupère donc le blob
 * puis on déclenche le téléchargement via une URL d'objet, révoquée ensuite.
 */
export function ExportCsvButton({
  endpoint,
  queryString,
  filename,
  label = "Exporter en CSV",
}: ExportCsvButtonProps) {
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    let url: string | null = null;
    try {
      const res = await fetch(
        queryString ? `${endpoint}?${queryString}` : endpoint,
        { headers: createApiHeaders(session) }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "L'export a échoué"
        );
      }
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'export a échoué");
    } finally {
      // Toujours révoquer : sans cela le blob reste en mémoire jusqu'au
      // rechargement de la page.
      if (url) URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={busy || !session}
        className="gap-2"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
        {busy ? "Génération…" : label}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
