"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateClassroom } from "@/lib/hooks/use-classrooms";
import { CreateClassroom, UpdateClassroom } from "@ecoledigitale/contracts";
import { ClassroomForm } from "@/components/academic/ClassroomForm";

export default function NewClassroomPage() {
  const router = useRouter();
  const createClassroomMutation = useCreateClassroom();

  const handleSubmit = async (data: CreateClassroom | UpdateClassroom) => {
    try {
      await createClassroomMutation.mutateAsync(data as CreateClassroom);
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
            Nouvelle salle de classe
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Créez une nouvelle salle de classe en renseignant son nom et son code
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de la salle</CardTitle>
          <CardDescription>
            Renseignez le nom et le code de la salle
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClassroomForm
            simplified
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createClassroomMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

