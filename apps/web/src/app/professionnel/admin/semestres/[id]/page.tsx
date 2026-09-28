"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  Loader2,
  AlertCircle,
  CalendarRange,
  GraduationCap,
  Layers,
  BookOpen,
} from "lucide-react";
import { useProfessionalSemestre } from "@/lib/hooks/use-professional-semestres";

/**
 * Détail d'un semestre — Module Professionnel.
 * Tableau de bord (agrégats) + composition : chaque UE avec ses ECUE et crédits.
 */

const LIST_URL = "/professionnel/admin/semestres";

function StatCard({
  label,
  value,
  icon: Icon,
  gradient,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  gradient: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} p-5 rounded-xl text-white shadow-lg`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/80 text-xs font-medium">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div className="bg-white/20 p-2.5 rounded-lg">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function ProfessionalSemestreDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? "");

  const semestreQuery = useProfessionalSemestre(id || null);
  const detail: any = semestreQuery.data ?? null;

  if (semestreQuery.isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            <p className="text-gray-600 mt-3">Chargement du semestre…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (semestreQuery.isError || !detail) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <p className="text-muted-foreground mt-3">
              {(semestreQuery.error as Error)?.message ?? "Semestre introuvable."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ues: any[] = detail.ues ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent leading-tight text-2xl md:text-3xl">
              {detail.libelle}
            </h1>
            <p className="whitespace-nowrap text-muted-foreground flex items-center gap-1.5 text-sm md:text-base">
              <Layers className="h-4 w-4" />
              {detail.filiere_nom ?? "—"}
              {detail.filiere_code ? (
                <span className="font-mono text-xs">({detail.filiere_code})</span>
              ) : null}
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push(`${LIST_URL}/${id}/edit`)}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      {/* Tableau de bord */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Tableau de bord
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="UE"
            value={detail.nb_ue ?? 0}
            icon={Layers}
            gradient="from-indigo-500 to-purple-600"
          />
          <StatCard
            label="Crédits UE (UV)"
            value={detail.nb_uv ?? 0}
            icon={GraduationCap}
            gradient="from-purple-500 to-pink-600"
          />
          <StatCard
            label="Crédits ECUE"
            value={detail.nb_credits_ecue ?? 0}
            icon={BookOpen}
            gradient="from-blue-500 to-indigo-600"
          />
        </div>
      </div>

      {/* Composition : UE → ECUE */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Composition du semestre</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {ues.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Aucune UE rattachée à ce semestre.
            </p>
          ) : (
            ues.map((u) => {
              const ecues: any[] = u.ecues ?? [];
              return (
                <div key={u.id} className="rounded-lg border overflow-hidden">
                  {/* En-tête UE */}
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-3 border-b">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{u.code}</span>
                        <h3 className="font-semibold">{u.libelle}</h3>
                      </div>
                      {u.description ? (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {u.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 text-sm whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <GraduationCap className="h-4 w-4 text-indigo-600" />
                        {u.nb_uv ?? 0} crédit{(u.nb_uv ?? 0) > 1 ? "s" : ""} UE
                      </span>
                      {Number(u.prix) > 0 && (
                        <span className="text-muted-foreground">
                          {u.prix} {u.devise ?? "XOF"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ECUE de l'UE */}
                  {ecues.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-4 py-3">
                      Aucune ECUE rattachée à cette UE.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="py-2 px-4">Code</th>
                          <th className="py-2 pr-4">ECUE</th>
                          <th className="py-2 pr-4">Crédits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ecues.map((e) => (
                          <tr key={e.ecue_id} className="border-b last:border-0">
                            <td className="py-2 px-4 font-mono text-xs">{e.ecue_code}</td>
                            <td className="py-2 pr-4">{e.ecue_libelle}</td>
                            <td className="py-2 pr-4">{e.ecue_credits ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
