"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateTeacherAssignment } from "@/lib/hooks/use-teacher-assignments";
import { CreateAssignmentInput } from "@/lib/hooks/use-teacher-assignments";
import { TeacherAssignmentForm } from "@/components/academic/TeacherAssignmentForm";

export default function NewTeacherAssignmentPage() {
  const router = useRouter();
  const createAssignmentMutation = useCreateTeacherAssignment();

  const handleSubmit = async (data: CreateAssignmentInput) => {
    try {
      await createAssignmentMutation.mutateAsync(data);
      // Wait a bit for the cache to update before redirecting
      await new Promise(resolve => setTimeout(resolve, 500));
      router.push("/academic/assignments");
    } catch (error) {
      console.error("Error creating assignment:", error);
    }
  };

  const handleCancel = () => {
    router.push("/academic/assignments");
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/academic/assignments")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-red-600 to-rose-600 bg-clip-text text-transparent">
            Nouvelle affectation
          </h1>
          <p className="text-muted-foreground mt-2">
            Créez une nouvelle affectation de cours à un enseignant avec toutes les informations nécessaires
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de l'affectation</CardTitle>
          <CardDescription>
            Remplissez les informations pour créer une nouvelle affectation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TeacherAssignmentForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createAssignmentMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

