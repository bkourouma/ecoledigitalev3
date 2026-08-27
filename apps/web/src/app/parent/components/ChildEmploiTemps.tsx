"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2, AlertCircle, CalendarClock, Layers, CalendarRange } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { EmploiTempsGrid } from "@/components/professional/EmploiTempsGrid";
import { useChildEmploiTemps } from "@/lib/hooks/use-professional-emploi-temps";

/**
 * Emploi du temps d'un enfant — espace parent.
 *
 * Reprend la grille et la cascade de filtres de « Mon emploi du temps »
 * (espace étudiant, apps/web/src/app/student/schedule) : l'année scolaire
 * commande les classes, qui commandent les semestres, qui commandent
 * l'affichage.
 */

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

interface ChildEmploiTempsProps {
  childId?: string | null;
  /** Message affiché tant qu'aucun enfant n'est choisi (page multi-enfants). */
  noChildMessage?: string;
}

export function ChildEmploiTemps({ childId, noChildMessage }: ChildEmploiTempsProps) {
  const { data, isLoading, isError, error } = useChildEmploiTemps(childId);

  const [annee, setAnnee] = useState("");
  const [nomClasse, setNomClasse] = useState("");
  const [semestreId, setSemestreId] = useState("");

  // Changer d'enfant remet la cascade à zéro : les choix précédents portent sur
  // les cours d'un autre élève.
  useEffect(() => {
    setAnnee("");
    setNomClasse("");
    setSemestreId("");
  }, [childId]);

  const slots: any[] = (data as any[]) ?? [];

  // Années scolaires couvertes par l'emploi du temps de l'enfant.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) if (s.annee_scolaire) set.add(s.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [slots]);

  // Noms de classe suivis par l'enfant sur l'année retenue.
  const nomOptions = useMemo(() => {
    if (!annee) return [] as { value: string; label: string }[];
    const set = new Set<string>();
    for (const s of slots) {
      if (s.classe_nom && s.annee_scolaire === annee) set.add(s.classe_nom);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((value) => ({ value, label: value }));
  }, [slots, annee]);

  // Semestres de la classe retenue. Le libellé est générique (« Semestre 1 »)
  // mais la classe étant déjà choisie, il n'y a plus d'ambiguïté.
  const semestreOptions = useMemo(() => {
    if (!nomClasse) return [] as { value: string; label: string }[];
    const map = new Map<string, string>();
    for (const s of slots) {
      if (!s.semestre_id || s.classe_nom !== nomClasse) continue;
      if (annee && s.annee_scolaire !== annee) continue;
      map.set(s.semestre_id, s.semestre_libelle ?? "Semestre");
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );
  }, [slots, nomClasse, annee]);

  const visibleSlots = useMemo(
    () =>
      semestreId
        ? slots.filter((s) => s.semestre_id === semestreId && s.classe_nom === nomClasse)
        : [],
    [slots, semestreId, nomClasse]
  );

  // Intervalle de période couvert par les créneaux affichés.
  const period = useMemo(() => {
    const debuts = visibleSlots.map((s) => s.date_debut).filter(Boolean).sort();
    const fins = visibleSlots.map((s) => s.date_fin).filter(Boolean).sort();
    return {
      debut: debuts[0] ?? null,
      fin: fins.length ? fins[fins.length - 1] : null,
    };
  }, [visibleSlots]);

  if (!childId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <div className="rounded-full bg-indigo-50 p-4">
            <CalendarClock className="h-8 w-8 text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold">Choisissez un enfant</h3>
          <p className="text-muted-foreground max-w-md">
            {noChildMessage ?? "Sélectionnez un enfant pour afficher son emploi du temps."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-red-200">
        <CardContent className="flex items-center gap-3 py-8 text-red-700">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <p>
            {(error as Error)?.message ??
              "Impossible de charger l'emploi du temps de votre enfant."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Rien à choisir tant qu'aucun créneau n'est planifié. */}
      {anneeOptions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:max-w-2xl">
          {/* L'année ouvre la cascade : elle occupe sa propre ligne. */}
          <div className="sm:col-span-2">
            <label className="text-sm font-medium">Année scolaire</label>
            <div className="mt-1.5">
              <SearchableSelect
                value={annee}
                onChange={(v) => {
                  setAnnee(v);
                  // Classes et semestres dépendent de l'année : les choix
                  // précédents n'ont plus de sens.
                  setNomClasse("");
                  setSemestreId("");
                }}
                icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
                placeholder="Choisir une année"
                searchPlaceholder="Rechercher une année…"
                options={anneeOptions}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Nom de classe</label>
            <div className="mt-1.5">
              <SearchableSelect
                value={nomClasse}
                onChange={(v) => {
                  setNomClasse(v);
                  // Les semestres dépendent de la classe : le choix précédent
                  // n'a plus de sens.
                  setSemestreId("");
                }}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                disabled={!annee}
                placeholder="Choisir une classe"
                searchPlaceholder="Rechercher un nom de classe…"
                options={nomOptions}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Semestre</label>
            <div className="mt-1.5">
              <SearchableSelect
                value={semestreId}
                onChange={setSemestreId}
                icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
                disabled={!nomClasse}
                placeholder="Choisir un semestre"
                searchPlaceholder="Rechercher un semestre…"
                options={semestreOptions}
              />
            </div>
          </div>
        </div>
      )}

      {slots.length > 0 && (!annee || !nomClasse || !semestreId) ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <CalendarRange className="h-8 w-8 text-indigo-500" />
            </div>
            <h3 className="text-lg font-semibold">
              {!annee
                ? "Choisissez une année scolaire"
                : !nomClasse
                  ? "Choisissez une classe"
                  : "Choisissez un semestre"}
            </h3>
            <p className="text-muted-foreground max-w-md">
              {!annee
                ? "Sélectionnez une année scolaire ci-dessus, puis la classe et son semestre, pour afficher les cours."
                : !nomClasse
                  ? "Sélectionnez une classe ci-dessus, puis son semestre, pour afficher les cours."
                  : "Sélectionnez un semestre ci-dessus pour afficher les cours qui s'y rapportent."}
            </p>
          </CardContent>
        </Card>
      ) : slots.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <CalendarClock className="h-8 w-8 text-indigo-500" />
            </div>
            <h3 className="text-lg font-semibold">Aucun cours planifié</h3>
            <p className="text-muted-foreground max-w-md">
              Aucun créneau n'est encore programmé pour les sessions de votre enfant. Il
              apparaîtra ici dès que l'administration aura configuré l'emploi du temps.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {(period.debut || period.fin) && (
            <div className="flex items-center gap-2 text-sm">
              <CalendarRange className="h-4 w-4 text-indigo-500" />
              <span className="text-muted-foreground">Période :</span>
              <span className="font-medium text-foreground">
                Du {fmtDate(period.debut)} au {fmtDate(period.fin)}
              </span>
            </div>
          )}
          <Card className="shadow-lg overflow-hidden">
            <CardContent className="p-0">
              <EmploiTempsGrid slots={visibleSlots} showTeacher showFiliere />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
