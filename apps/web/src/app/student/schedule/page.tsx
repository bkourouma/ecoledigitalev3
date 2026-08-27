"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2, AlertCircle, CalendarClock, Layers, CalendarRange } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { EmploiTempsGrid } from "@/components/professional/EmploiTempsGrid";
import { useStudentEmploiTemps } from "@/lib/hooks/use-professional-emploi-temps";

/**
 * Mon emploi du temps — Espace étudiant.
 * Affiche, sous forme de grille hebdomadaire (identique au planning admin /
 * consultation), les créneaux des sessions où l'étudiant est inscrit.
 */

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

export default function StudentSchedulePage() {
  const { data, isLoading, isError, error } = useStudentEmploiTemps();
  // Cascade : l'année scolaire commande les classes, qui commandent les
  // semestres, qui commandent l'affichage. Rien ne s'affiche avant le bout.
  const [annee, setAnnee] = useState("");
  const [nomClasse, setNomClasse] = useState("");
  const [semestreId, setSemestreId] = useState("");

  const slots: any[] = (data as any[]) ?? [];

  // Années scolaires couvertes par l'emploi du temps de l'étudiant.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) if (s.annee_scolaire) set.add(s.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [slots]);

  // Noms de classe suivis par l'étudiant sur l'année retenue.
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

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(error as Error)?.message ?? "Impossible de charger votre emploi du temps."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2">
            <CalendarClock className="h-7 w-7 text-indigo-500" />
            Mon emploi du temps
          </h1>
          <p className="text-muted-foreground mt-2">
            Vos cours de la semaine, d'après le planning configuré par l'administration.
          </p>
        </div>
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
      </div>

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
                ? "Sélectionnez une année scolaire ci-dessus, puis votre classe et son semestre, pour afficher vos cours."
                : !nomClasse
                  ? "Sélectionnez une classe ci-dessus, puis son semestre, pour afficher vos cours."
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
              Aucun créneau n'est encore programmé pour vos sessions. Il apparaîtra ici dès que
              l'administration aura configuré l'emploi du temps.
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
