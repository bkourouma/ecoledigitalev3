"use client";

import { useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ecoledigitale/ui";
import { FileText, FileType, Loader2 } from "lucide-react";

export interface ExportChoice {
  key: string;
  label: string;
  /** Précision affichée sous le libellé. */
  hint?: string;
  /** Choix imposé : coché et non décochable (colonnes d'identification). */
  locked?: boolean;
}

export interface ExportOptionsDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Cases proposées, dans l'ordre d'affichage. Groupées par `groupLabel`. */
  groups: Array<{ groupLabel?: string; choices: ExportChoice[] }>;
  selected: Set<string>;
  onToggle: (key: string) => void;
  /** Exporte selon la sélection courante. */
  onExport: (format: "pdf" | "word") => Promise<void> | void;
  /** Formats proposés, dans l'ordre des boutons. Par défaut : PDF et Word. */
  formats?: Array<"pdf" | "word">;
  /** Bloque les boutons (aucune donnée à exporter, par exemple). */
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Boîte de dialogue « Exporter » : l'utilisateur choisit les données à inclure,
 * puis le format. Le document produit s'adapte à la sélection.
 *
 * Partagée par les écrans dont l'export mérite un tri préalable (UE, notes…) —
 * les écrans à export unique gardent leurs deux boutons directs.
 */
export function ExportOptionsDialog({
  open,
  onClose,
  title,
  description,
  groups,
  selected,
  onToggle,
  onExport,
  formats = ["pdf", "word"],
  disabled,
  disabledReason,
}: ExportOptionsDialogProps) {
  const [busy, setBusy] = useState<"pdf" | "word" | null>(null);

  const lancer = async (format: "pdf" | "word") => {
    setBusy(format);
    try {
      await onExport(format);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto space-y-5 py-2">
          {groups.map((groupe, gi) => (
            <div key={groupe.groupLabel ?? gi} className="space-y-3">
              {groupe.groupLabel && (
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {groupe.groupLabel}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {groupe.choices.map((choix) => {
                  const coche = choix.locked || selected.has(choix.key);
                  return (
                    <label
                      key={choix.key}
                      className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                        choix.locked
                          ? "border-gray-200 bg-gray-50 cursor-default"
                          : coche
                            ? "border-emerald-300 bg-emerald-50/60 cursor-pointer"
                            : "border-gray-200 hover:bg-gray-50 cursor-pointer"
                      }`}
                    >
                      <Checkbox
                        checked={coche}
                        disabled={choix.locked}
                        onCheckedChange={() => !choix.locked && onToggle(choix.key)}
                        className="mt-0.5"
                      />
                      <span className="text-sm">
                        <span className="font-medium text-gray-900">{choix.label}</span>
                        {choix.hint && <span className="block text-xs text-gray-500">{choix.hint}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {disabled && disabledReason && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {disabledReason}
          </p>
        )}

        <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            Annuler
          </Button>
          {formats.includes("pdf") && (
            <Button
              variant="outline"
              onClick={() => lancer("pdf")}
              disabled={disabled || busy !== null}
              className="bg-red-50 border-red-200 hover:bg-red-100 text-red-700 hover:text-red-800"
            >
              {busy === "pdf" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              PDF
            </Button>
          )}
          {formats.includes("word") && (
            <Button
              variant="outline"
              onClick={() => lancer("word")}
              disabled={disabled || busy !== null}
              className="bg-blue-50 border-blue-200 hover:bg-blue-100 text-blue-700 hover:text-blue-800"
            >
              {busy === "word" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <FileType className="h-4 w-4 mr-2" />
              )}
              Word
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
