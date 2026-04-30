"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateClassroom } from "@/lib/hooks/use-classrooms";
import { CreateClassroom } from "@ecoledigitale/contracts";
import { ClassroomForm } from "@/components/academic/ClassroomForm";

export default function NewClassroomPage() {
  const router = useRouter();
  const createClassroomMutation = useCreateClassroom();

  const handleSubmit = async (data: CreateClassroom) => {
    try {
      await createClassroomMutation.mutateAsync(data);
      router.push("/academic/classrooms");
    } catch (error) {
      console.error("Error creating classroom:", error);
    }
  };

  const handleCancel = () => {
    router.push("/academic/classrooms");
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/academic/classrooms")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Nouvelle salle de classe
          </h1>
          <p className="text-muted-foreground mt-2">
            Créez une nouvelle salle de classe avec toutes les informations nécessaires
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de la salle</CardTitle>
          <CardDescription>
            Remplissez les informations pour créer une nouvelle salle de classe
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClassroomForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createClassroomMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

