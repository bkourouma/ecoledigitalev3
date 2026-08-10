"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OwnerStatsFiltersResponse } from "@ecoledigitale/contracts";

type Filiere = OwnerStatsFiltersResponse["filieres"][number];

type FiliereFilterProps = {
  filieres: Filiere[];
  /** Sélection vide = « toutes les filières », le défaut voulu pour un owner. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/**
 * Multi-sélection de filières, homogène sur toutes les pages de statistiques.
 *
 * Le défaut est délibérément « toutes » : le propriétaire doit voir son
 * établissement entier avant d'affiner — c'est précisément ce que les écrans
 * admin du module professionnel ne permettent pas, puisqu'ils imposent de
 * choisir une filière.
 */
export function FiliereFilter({ filieres, value, onChange, disabled }: FiliereFilterProps) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  const label =
    value.length === 0
      ? "Toutes les filières"
      : value.length === 1
        ? (filieres.find((f) => f.id === value[0])?.name ?? "1 filière")
        : `${value.length} filières`;

  function toggle(id: string) {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full justify-between font-normal"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0" aria-hidden />
      </Button>

      {open ? (
        <>
          {/* Capture le clic extérieur sans piéger le focus. */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-multiselectable
            className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {value.length > 0 ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Tout effacer
              </button>
            ) : null}
            {filieres.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Aucune filière.</p>
            ) : (
              filieres.map((f) => {
                const isSelected = selected.has(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggle(f.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left hover:bg-accent",
                      isSelected && "bg-accent/50"
                    )}
                  >
                    <Check
                      className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    <span className="truncate">{f.name}</span>
                    {f.cycleName ? (
                      <span className="ml-auto text-xs text-muted-foreground shrink-0">
                        {f.cycleName}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
