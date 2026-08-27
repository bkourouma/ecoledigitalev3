"use client";

import { CalendarCheck } from "lucide-react";
import { useMyAttendanceHistory } from "@/lib/hooks/use-professional-student";
import { PresencesView } from "@/components/PresencesView";

/**
 * Présences & absences — espace étudiant (Module Professionnel).
 *
 * Pendant de la section « Présences & absences » du détail enfant côté parent,
 * borné à l'étudiant connecté. Les compteurs, les filtres et l'historique
 * vivent dans `PresencesView`, partagé avec l'écran équivalent de l'espace
 * parent (`/parent/presences`).
 */
export default function MesPresencesPage() {
  const query = useMyAttendanceHistory();
  const toutes: any[] = (query.data as any[]) ?? [];

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
          <CalendarCheck className="h-7 w-7 text-emerald-500" />
          Présences &amp; absences
        </h1>
        <p className="text-muted-foreground mt-2">
          Votre assiduité séance par séance, telle que pointée par vos enseignants.
        </p>
      </div>

      <PresencesView
        toutes={toutes}
        isLoading={query.isLoading}
        isError={query.isError}
        errorMessage={(query.error as Error)?.message}
      />
    </div>
  );
}
