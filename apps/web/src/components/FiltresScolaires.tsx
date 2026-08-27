"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { CalendarRange, Layers } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";

/**
 * Filtres scolaires en cascade — année scolaire → nom de classe → semestre —
 * partagés par les écrans des espaces parent et étudiant. Chaque écran fournit
 * des lignes portant ce contexte ; le hook en déduit les options et la
 * sélection.
 */
/* ---------------------------- Filtres ---------------------------- */

export const TOUS = "all";

export type Contexte = {
  annee_scolaire?: string | null;
  classe_nom?: string | null;
  semestre_id?: string | null;
  semestre_libelle?: string | null;
};

/**
 * Cascade année scolaire → nom de classe → semestre, calculée sur une liste
 * de lignes portant ce contexte. Les deux onglets s'en servent : bulletins
 * (un semestre par ligne) et reçus (le contexte de la commande réglée).
 */
export function useFiltresScolaires<T extends Contexte>(lignes: T[]) {
  const [annee, setAnnee] = useState<string>(TOUS);
  const [classe, setClasse] = useState<string>(TOUS);
  const [semestre, setSemestre] = useState<string>(TOUS);

  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of lignes) if (l.annee_scolaire) set.add(l.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [lignes]);

  const classeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of lignes) {
      if (annee !== TOUS && l.annee_scolaire !== annee) continue;
      if (l.classe_nom) set.add(l.classe_nom);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((value) => ({ value, label: value }));
  }, [lignes, annee]);

  const semestreOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lignes) {
      if (!l.semestre_id) continue;
      if (annee !== TOUS && l.annee_scolaire !== annee) continue;
      if (classe !== TOUS && l.classe_nom !== classe) continue;
      map.set(l.semestre_id, l.semestre_libelle ?? "Semestre");
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr", { numeric: true })
    );
  }, [lignes, annee, classe]);

  const visibles = useMemo(
    () =>
      lignes.filter(
        (l) =>
          (annee === TOUS || l.annee_scolaire === annee) &&
          (classe === TOUS || l.classe_nom === classe) &&
          (semestre === TOUS || l.semestre_id === semestre)
      ),
    [lignes, annee, classe, semestre]
  );

  const barre = (
    <FiltresScolaires
      annee={annee}
      classe={classe}
      semestre={semestre}
      anneeOptions={anneeOptions}
      classeOptions={classeOptions}
      semestreOptions={semestreOptions}
      onAnnee={(v) => {
        setAnnee(v);
        // Classes et semestres dépendent de l'année.
        setClasse(TOUS);
        setSemestre(TOUS);
      }}
      onClasse={(v) => {
        setClasse(v);
        setSemestre(TOUS);
      }}
      onSemestre={setSemestre}
    />
  );

  return { visibles, barre, filtre: annee !== TOUS || classe !== TOUS || semestre !== TOUS };
}

function FiltresScolaires({
  annee,
  classe,
  semestre,
  anneeOptions,
  classeOptions,
  semestreOptions,
  onAnnee,
  onClasse,
  onSemestre,
}: {
  annee: string;
  classe: string;
  semestre: string;
  anneeOptions: { value: string; label: string }[];
  classeOptions: { value: string; label: string }[];
  semestreOptions: { value: string; label: string }[];
  onAnnee: (v: string) => void;
  onClasse: (v: string) => void;
  onSemestre: (v: string) => void;
}) {
  if (anneeOptions.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* L'année ouvre la cascade : elle occupe sa propre ligne. */}
        <div className="md:col-span-2">
          <label className="text-sm font-medium">Année scolaire</label>
          <div className="mt-1.5">
            <SearchableSelect
              value={annee}
              onChange={onAnnee}
              icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}
              placeholder="Toutes les années"
              searchPlaceholder="Rechercher une année…"
              options={[{ value: TOUS, label: "Toutes les années" }, ...anneeOptions]}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">Nom de classe</label>
          <div className="mt-1.5">
            <SearchableSelect
              value={classe}
              onChange={onClasse}
              icon={<Layers className="h-4 w-4 text-muted-foreground" />}
              placeholder="Tous les noms de classe"
              searchPlaceholder="Rechercher un nom de classe…"
              options={[{ value: TOUS, label: "Tous les noms de classe" }, ...classeOptions]}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">Semestre</label>
          <div className="mt-1.5">
            <SearchableSelect
              value={semestre}
              onChange={onSemestre}
              icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}
              placeholder="Tous les semestres"
              searchPlaceholder="Rechercher un semestre…"
              options={[{ value: TOUS, label: "Tous les semestres" }, ...semestreOptions]}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

