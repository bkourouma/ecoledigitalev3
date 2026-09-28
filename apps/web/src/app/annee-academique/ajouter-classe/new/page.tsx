"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateClass } from "@/lib/hooks/use-classes";
import { CreateClass } from "@/lib/hooks/use-classes";
import { ClassForm } from "@/components/academic/ClassForm";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";

export default function NewClassPage() {
  const router = useRouter();
  const createClassMutation = useCreateClass();
  const { data: activeYearData } = useActiveAcademicYear();

  const handleSubmit = async (data: any) => {
    if (!activeYearData?.data) {
      alert("Aucune année académique active trouvée");
      return;
    }

    try {
      const classData: CreateClass = {
        ...data,
        academicYearId: activeYearData.data.id,
      };
      await createClassMutation.mutateAsync(classData);
      router.push("/annee-academique/ajouter-classe");
    } catch (error) {
      console.error("Error creating class:", error);
    }
  };

  const handleCancel = () => {
    router.push("/annee-academique/ajouter-classe");
  };

  const activeYear = activeYearData?.data;

  if (!activeYear) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-orange-800">Aucune Année Académique Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-orange-700 mb-4">
              Vous devez d'abord créer et activer une année académique avant de pouvoir ajouter des classes.
            </p>
            <Button
              onClick={() => router.push('/annee-academique/demarrer')}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Démarrer une Année Académique
            </Button>
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
          onClick={() => router.push("/annee-academique/ajouter-classe")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouvelle classe
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Créez une nouvelle classe pour l'année académique {activeYear.name}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de la classe</CardTitle>
          <CardDescription>
            Remplissez les informations pour créer une nouvelle classe
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClassForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createClassMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

