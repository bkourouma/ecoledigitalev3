"use client";

import { useParams, useRouter } from "next/navigation";
import { Button, Card, CardContent } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2 } from "lucide-react";
import { FiliereForm } from "@/components/academic/FiliereForm";
import { useFiliere, useUpdateFiliere } from "@/lib/hooks/use-filieres";

export default function EditFilierePage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";

  const { data: filiere, isLoading, error } = useFiliere(id);
  const updateMutation = useUpdateFiliere();

  async function handleSubmit(data: { name: string; domaine: string | null }) {
    await updateMutation.mutateAsync({ id, data });
    router.push("/academic/programmes");
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
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
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h3 className="text-lg font-medium">Filière introuvable</h3>
        <p className="text-muted-foreground">
          La filière demandée n&apos;existe pas ou vous n&apos;avez pas les
          permissions pour la modifier.
        </p>
        <Button onClick={() => router.push("/academic/programmes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux filières
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => router.push("/academic/programmes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-600 to-orange-600 bg-clip-text text-transparent">
            Modifier la filière
          </h1>
          <p className="text-muted-foreground mt-1">{filiere.name}</p>
        </div>
      </div>

      <FiliereForm
        filiere={filiere}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/academic/programmes")}
        isLoading={updateMutation.isPending}
      />
    </div>
  );
}
