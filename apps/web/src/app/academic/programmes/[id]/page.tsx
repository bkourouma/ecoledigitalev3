"use client";

import { useParams, useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ecoledigitale/ui";
import { ArrowLeft, BookOpen, Edit, Loader2 } from "lucide-react";
import { useFiliere } from "@/lib/hooks/use-filieres";

/** Détail d'une filière : son nom et son domaine. */
export default function FiliereDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";

  const { data: filiere, isLoading, error } = useFiliere(id);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !filiere) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <h1 className="text-xl sm:text-2xl font-bold text-red-600">Filière non trouvée</h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          La filière demandée n&apos;existe pas ou a été supprimée.
        </p>
        <Button onClick={() => router.push("/academic/programmes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux filières
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Button variant="outline" onClick={() => router.push("/academic/programmes")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-pink-600 to-orange-600 bg-clip-text text-transparent leading-tight text-2xl md:text-3xl">
              {filiere.name}
            </h1>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              {filiere.domaine || "Domaine non renseigné"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push(`/academic/programmes/${id}/edit`)}
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      {/* Informations */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-pink-600" /> Informations de la filière
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between border-b pb-2">
            <span className="text-sm text-muted-foreground">Nom</span>
            <span className="text-sm font-medium">{filiere.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Domaine</span>
            <span className="text-sm font-medium">{filiere.domaine || "—"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
