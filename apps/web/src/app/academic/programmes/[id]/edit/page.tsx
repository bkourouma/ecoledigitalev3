"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useProgramme, useUpdateProgramme } from "@/lib/hooks/use-programmes";
import { ProgrammeForm } from "@/components/academic/ProgrammeForm";

export default function EditProgrammePage() {
  const router = useRouter();
  const params = useParams();
  const programmeId = params.id as string;
  const { data: programme, isLoading, error } = useProgramme(programmeId);
  const updateProgrammeMutation = useUpdateProgramme();

  const handleSubmit = async (data: any) => {
    try {
      await updateProgrammeMutation.mutateAsync({
        id: programmeId,
        data,
      });
      router.push("/academic/programmes");
    } catch (error) {
      console.error("Error updating programme:", error);
    }
  };

  const handleCancel = () => {
    router.push("/academic/programmes");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations du programme...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !programme) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Programme introuvable</h3>
                <p className="text-muted-foreground">
                  Le programme demandé n'existe pas ou vous n'avez pas les permissions pour le modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/academic/programmes")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/academic/programmes")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Modifier le programme
          </h1>
          <p className="text-muted-foreground mt-2">
            Modifiez les informations de {programme.name}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations du programme</CardTitle>
          <CardDescription>
            Modifiez les informations du programme
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProgrammeForm
            programme={programme}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateProgrammeMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

