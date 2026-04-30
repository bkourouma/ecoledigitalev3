"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useClass, useUpdateClass } from "@/lib/hooks/use-classes";
import { ClassForm } from "@/components/academic/ClassForm";
import { UpdateClass } from "@/lib/hooks/use-classes";

export default function EditClassPage() {
  const router = useRouter();
  const params = useParams();
  const classId = params.id as string;
  const { data: classData, isLoading, error } = useClass(classId, true);
  const updateClassMutation = useUpdateClass();

  const handleSubmit = async (data: any) => {
    try {
      const cleanData: UpdateClass = {
        ...data,
        programmeId: data.programmeId || undefined,
        classroomId: data.classroomId || undefined,
      };
      await updateClassMutation.mutateAsync({
        id: classId,
        data: cleanData,
      });
      router.push("/annee-academique/ajouter-classe");
    } catch (error) {
      console.error("Error updating class:", error);
    }
  };

  const handleCancel = () => {
    router.push("/annee-academique/ajouter-classe");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-violet-100 to-indigo-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations de la classe...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !classData?.data) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Classe introuvable</h3>
                <p className="text-muted-foreground">
                  La classe demandée n'existe pas ou vous n'avez pas les permissions pour la modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/annee-academique/ajouter-classe")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const classItem = classData.data;

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/annee-academique/ajouter-classe")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            Modifier la classe
          </h1>
          <p className="text-muted-foreground mt-2">
            Modifiez les informations de {classItem.name}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de la classe</CardTitle>
          <CardDescription>
            Modifiez les informations de la classe
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClassForm
            classItem={classItem}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateClassMutation.isPending}
            isEdit={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}

