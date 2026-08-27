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
import { Users, RotateCcw, GraduationCap } from "lucide-react";
import {
  useProfessionalChildren,
  useChildRattrapages,
} from "@/lib/hooks/use-professional-parent";
import { RattrapagesView, type RattrapageRow } from "@/components/RattrapagesView";

/**
 * Rattrapages de mon enfant — espace parent (Module Professionnel).
 *
 * Même vue que celle de l'étudiant (`/professionnel/etudiant/rattrapages`),
 * précédée du choix de l'enfant : le parent voit si son enfant est convoqué en
 * Session 2 et quelles ECUE il doit repasser. Lecture seule — les notes sont
 * saisies par l'administration.
 */
export default function ParentRattrapagesPage() {
  const [childId, setChildId] = useState("");

  const childrenQuery = useProfessionalChildren();
  const query = useChildRattrapages(childId || null);

  const children: any[] = (childrenQuery.data as any[]) ?? [];
  const toutes: RattrapageRow[] = (query.data as RattrapageRow[]) ?? [];
  // Le parent peut suivre plusieurs enfants : nommer celui affiché évite de
  // lire une convocation en pensant à l'autre.
  const enfant = children.find((c) => c.id === childId);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent flex items-center gap-2">
          <RotateCcw className="h-7 w-7 text-amber-500" />
          Rattrapages de mon enfant
        </h1>
        <p className="text-muted-foreground mt-2">
          Les ECUE que votre enfant doit repasser en Session 2.
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
            <div className="rounded-full bg-amber-500/15 p-4">
              <RotateCcw className="h-8 w-8 text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold">Choisissez un enfant</h3>
            <p className="text-muted-foreground max-w-md">
              Sélectionnez un enfant ci-dessus pour savoir s&apos;il est concerné par la Session 2.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {enfant && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GraduationCap className="h-4 w-4 text-amber-500" />
              Rattrapages de{" "}
              <span className="font-semibold text-foreground">
                {`${enfant.first_name ?? ""} ${enfant.last_name ?? ""}`.trim()}
              </span>
            </div>
          )}

          <RattrapagesView
            toutes={toutes}
            isLoading={query.isLoading}
            isError={query.isError}
            errorMessage={(query.error as Error)?.message}
            onRetry={() => query.refetch()}
            sujet="enfant"
          />
        </>
      )}
    </div>
  );
}
