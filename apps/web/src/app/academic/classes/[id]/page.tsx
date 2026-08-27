"use client";

import { useParams, useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ecoledigitale/ui";
import { ArrowLeft, BookOpen, Edit, GraduationCap, Layers, Loader2 } from "lucide-react";
import { useProgramme } from "@/lib/hooks/use-programmes";

/** Détail d'une classe : ses informations et sa filière de rattachement. */
export default function ClasseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";

  const { data: classe, isLoading, error } = useProgramme(id);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !classe) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <h1 className="text-xl sm:text-2xl font-bold text-red-600">Classe non trouvée</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          La classe demandée n&apos;existe pas ou a été supprimée.
        </p>
        <Button onClick={() => router.push("/academic/classes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux classes
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => router.push("/academic/classes")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
              {classe.name}
            </h1>
            <p className="text-muted-foreground mt-1">
              {classe.filiere?.name ?? "Filière non rattachée"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push(`/academic/classes/${id}/edit`)}
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      {/* Résumé */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-violet-500 to-purple-600 p-6 rounded-xl text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-xs">Code</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">{classe.code}</p>
            </div>
            <Layers className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-6 rounded-xl text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-xs">Filière</p>
              <p className="text-base sm:text-lg font-bold mt-1">
                {classe.filiere?.name ?? "—"}
              </p>
            </div>
            <BookOpen className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-6 rounded-xl text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-xs">Cycle</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">
                {classe.cycle?.name ?? "—"}
              </p>
            </div>
            <GraduationCap className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Informations */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-violet-600" /> Informations de la classe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between border-b pb-2">
            <span className="text-sm text-muted-foreground">Nom</span>
            <span className="text-sm font-medium">{classe.name}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-sm text-muted-foreground">Code</span>
            <span className="text-sm font-medium">{classe.code}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-sm text-muted-foreground">Filière</span>
            <span className="text-sm font-medium">
              {classe.filiere?.name ? (
                <button
                  className="text-violet-600 hover:underline"
                  onClick={() =>
                    router.push(`/academic/programmes/${classe.filiereId}`)
                  }
                >
                  {classe.filiere.name}
                </button>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Cycle</span>
            <span className="text-sm font-medium">{classe.cycle?.name ?? "—"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
