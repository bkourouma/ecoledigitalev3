"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useClassroom, useUpdateClassroom } from "@/lib/hooks/use-classrooms";
import { ClassroomForm } from "@/components/academic/ClassroomForm";
import { UpdateClassroom } from "@ecoledigitale/contracts";

export default function EditClassroomPage() {
  const router = useRouter();
  const params = useParams();
  const classroomId = params.id as string;
  // `useClassroom` renvoie l'enveloppe `{ data: Classroom }` de l'API : sans ce
  // déballage, le formulaire s'ouvrait vide et le titre affichait un nom absent.
  const { data: classroomEnvelope, isLoading, error } = useClassroom(classroomId);
  const classroom = classroomEnvelope?.data;
  const updateClassroomMutation = useUpdateClassroom();

  const handleSubmit = async (data: UpdateClassroom) => {
    try {
      await updateClassroomMutation.mutateAsync({
        id: classroomId,
        data,
      });
      router.push("/academic/classrooms");
    } catch (error) {
      console.error("Error updating classroom:", error);
    }
  };

  const handleCancel = () => {
    router.push("/academic/classrooms");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations de la salle...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !classroom) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Salle introuvable</h3>
                <p className="text-muted-foreground">
                  La salle demandée n'existe pas ou vous n'avez pas les permissions pour la modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/academic/classrooms")}>
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
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/academic/classrooms")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Modifier la salle de classe
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Modifiez les informations de {classroom.name}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de la salle</CardTitle>
          <CardDescription>
            Modifiez les informations de la salle de classe
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClassroomForm
            initialData={classroom}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateClassroomMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

