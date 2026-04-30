"use client";

import { Button } from "@/components/ui/button";

export interface CatalogueFilterState {
  categorie: string;
  niveau: string;
  mode: string;
  prixMin: string;
  prixMax: string;
}

export function FiltersSidebar({
  filters,
  onChange,
  onReset,
}: {
  filters: CatalogueFilterState;
  onChange: (key: keyof CatalogueFilterState, value: string) => void;
  onReset: () => void;
}) {
  return (
    <aside className="rounded-[1.75rem] border border-border/70 bg-white/80 p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Filtres</h2>
        <button type="button" className="text-sm text-primary" onClick={onReset}>
          Réinitialiser
        </button>
      </div>

      <div className="space-y-4 text-sm">
        <FilterSelect
          label="Catégorie"
          value={filters.categorie}
          onChange={(value) => onChange("categorie", value)}
          options={["Data", "Développement", "Gestion", "Marketing"]}
        />
        <FilterSelect
          label="Niveau"
          value={filters.niveau}
          onChange={(value) => onChange("niveau", value)}
          options={["Débutant", "Intermédiaire", "Avancé"]}
        />
        <FilterSelect
          label="Mode"
          value={filters.mode}
          onChange={(value) => onChange("mode", value)}
          options={["PRESENTIAL", "REMOTE", "HYBRID", "ELEARNING"]}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Prix min
            </label>
            <input
              className="h-11 w-full rounded-2xl border border-input bg-white px-4"
              value={filters.prixMin}
              onChange={(event) => onChange("prixMin", event.target.value)}
              inputMode="numeric"
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Prix max
            </label>
            <input
              className="h-11 w-full rounded-2xl border border-input bg-white px-4"
              value={filters.prixMax}
              onChange={(event) => onChange("prixMax", event.target.value)}
              inputMode="numeric"
              placeholder="500000"
            />
          </div>
        </div>
        <Button variant="outline" className="w-full">
          Catalogue mis à jour en temps réel
        </Button>
      </div>
    </aside>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-2xl border border-input bg-white px-4"
      >
        <option value="">Toutes</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
