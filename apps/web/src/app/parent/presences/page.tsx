"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { Users, CalendarCheck } from "lucide-react";
import {
  useProfessionalChildren,
  useChildAttendanceHistory,
} from "@/lib/hooks/use-professional-parent";
import { PresencesView } from "@/components/PresencesView";

/**
 * Présences & absences de mon enfant — espace parent (Module Professionnel).
 *
 * Même vue que celle de l'étudiant (`/professionnel/etudiant/presences`),
 * précédée du choix de l'enfant. Les mêmes lignes existent déjà dans le détail
 * d'un enfant ; cet écran leur donne une entrée de menu directe, sans passer
 * par la fiche.
 */
export default function ParentPresencesPage() {
  const [childId, setChildId] = useState("");

  const childrenQuery = useProfessionalChildren();
  const query = useChildAttendanceHistory(childId || null);

  const children: any[] = (childrenQuery.data as any[]) ?? [];
  const toutes: any[] = (query.data as any[]) ?? [];

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      {/* Header */}
      <div>
        <h1 className="font-bold bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
          <CalendarCheck className="h-7 w-7 text-emerald-500" />
          Présences &amp; absences
        </h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          L&apos;assiduité de votre enfant séance par séance, telle que pointée par ses enseignants.
        </p>
      </div>

      {/* Sélection de l'enfant */}
      <Card className="shadow-lg">
        <CardContent className="p-6">
          <div className="w-full lg:w-[32rem]">
            <label className="text-sm font-medium text-foreground mb-1.5 block">Enfant</label>
            <Select value={childId || undefined} onValueChange={setChildId}>
              <SelectTrigger className="h-11">
                <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue
                  placeholder={childrenQuery.isLoading ? "Chargement…" : "Choisir un enfant"}
                />
              </SelectTrigger>
              <SelectContent>
                {children.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!childId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-emerald-500/15 p-4">
              <CalendarCheck className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="text-lg font-semibold">Choisissez un enfant</h3>
            <p className="text-muted-foreground max-w-md">
              Sélectionnez un enfant ci-dessus pour afficher son assiduité.
            </p>
          </CardContent>
        </Card>
      ) : (
        <PresencesView
          toutes={toutes}
          isLoading={query.isLoading}
          isError={query.isError}
          errorMessage={(query.error as Error)?.message}
        />
      )}
    </div>
  );
}
