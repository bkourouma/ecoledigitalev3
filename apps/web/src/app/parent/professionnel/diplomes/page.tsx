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
import { Users, Award, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { useProfessionalChildren } from "@/lib/hooks/use-professional-parent";
import { useParentChildDiplomas } from "@/lib/hooks/use-professional-diplomas";

/**
 * Espace parent — Diplômes professionnels d'un enfant (feature 029, US5).
 * Lecture seule : sélection d'un enfant + progression de ses diplômes.
 */
export default function ParentDiplomasPage() {
  const [childId, setChildId] = useState("");

  const childrenQuery = useProfessionalChildren();
  const diplomasQuery = useParentChildDiplomas(childId || null);

  const children: any[] = (childrenQuery.data as any[]) ?? [];
  const items: any[] = Array.isArray(diplomasQuery.data) ? diplomasQuery.data : [];

  const obtenus = items.filter((d) => d.statut_octroi === "obtenu");
  const enCours = items.filter((d) => d.statut_octroi !== "obtenu");

  return (
    <div className="space-y-8 max-w-5xl mx-auto p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
          Diplômes de mon enfant
        </h1>
        <p className="text-muted-foreground mt-2">
          Consultation en lecture seule des diplômes professionnels et de leur progression.
        </p>
      </div>

      {/* Sélection de l'enfant */}
      <Card className="shadow-lg">
        <CardContent className="p-6">
          <div className="w-full lg:w-[32rem]">
            <label className="text-sm font-medium mb-1.5 block">Enfant</label>
            <Select value={childId || undefined} onValueChange={setChildId}>
              <SelectTrigger className="h-11">
                <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Choisir un enfant" />
              </SelectTrigger>
              <SelectContent>
                {children.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                    {c.student_number ? ` (${c.student_number})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!childId && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-full w-20 h-20 flex items-center justify-center">
              <Users className="h-10 w-10 text-green-600" />
            </div>
            <p className="text-muted-foreground">
              Sélectionnez un enfant pour consulter ses diplômes.
            </p>
          </CardContent>
        </Card>
      )}

      {childId && diplomasQuery.isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            <p className="text-gray-600 mt-4">Chargement des diplômes…</p>
          </CardContent>
        </Card>
      )}

      {childId && diplomasQuery.isError && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <p className="text-muted-foreground mt-4">
              {(diplomasQuery.error as Error)?.message ?? "Impossible de charger les diplômes."}
            </p>
          </CardContent>
        </Card>
      )}

      {childId && !diplomasQuery.isLoading && !diplomasQuery.isError && items.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <Award className="h-10 w-10 text-green-600" />
            <p className="text-muted-foreground">
              Aucun diplôme disponible dans les programmes de cet enfant.
            </p>
          </CardContent>
        </Card>
      )}

      {childId && obtenus.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Diplômes obtenus</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {obtenus.map((d) => (
              <ParentDiplomaCard key={d.diploma.id} summary={d} obtained />
            ))}
          </div>
        </section>
      )}

      {childId && enCours.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">En cours</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {enCours.map((d) => (
              <ParentDiplomaCard key={d.diploma.id} summary={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ParentDiplomaCard({
  summary,
  obtained = false,
}: {
  summary: any;
  obtained?: boolean;
}) {
  const d = summary.diploma;
  const pct = Math.max(0, Math.min(100, summary.pourcentage ?? 0));
  return (
    <Card className="shadow-lg">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Award className="h-5 w-5 text-green-600" />
            {d.libelle}
          </h3>
          {obtained ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Obtenu
            </span>
          ) : (
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
              {pct}%
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-gray-500">{d.code}</p>
        <div>
          <div className="h-2.5 w-full rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-blue-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {pct}% — cible {d.uv_required} UV
          </p>
        </div>
        {obtained && summary.reference && (
          <p className="text-xs text-gray-500">Référence : {summary.reference}</p>
        )}
      </CardContent>
    </Card>
  );
}
