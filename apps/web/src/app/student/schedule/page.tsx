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
  const [filiere, setFiliere] = useState("all");

  const slots: any[] = (data as any[]) ?? [];

  // Filières distinctes présentes dans l'emploi du temps de l'étudiant.
  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of slots) {
      if (s.filiere_code) {
        map.set(s.filiere_code, `${s.filiere_nom ?? s.filiere_code} (${s.filiere_code})`);
      }
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [slots]);

  const visibleSlots = useMemo(
    () => (filiere === "all" ? slots : slots.filter((s) => s.filiere_code === filiere)),
    [slots, filiere]
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2">
            <CalendarClock className="h-7 w-7 text-indigo-500" />
            Mon emploi du temps
          </h1>
          <p className="text-muted-foreground mt-2">
            Vos cours de la semaine, d'après le planning configuré par l'administration.
          </p>
        </div>
        {filiereOptions.length > 1 && (
          <div className="w-full sm:w-72">
            <SearchableSelect
              value={filiere}
              onChange={setFiliere}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder="Filtrer par filière"
              options={[{ value: "all", label: "Toutes les filières" }, ...filiereOptions]}
            />
          </div>
        )}
      </div>

      {slots.length === 0 ? (
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
