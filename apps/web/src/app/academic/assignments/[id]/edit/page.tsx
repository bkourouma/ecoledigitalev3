"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useTeacherAssignment, useUpdateTeacherAssignment } from "@/lib/hooks/use-teacher-assignments";
import { TeacherAssignmentForm } from "@/components/academic/TeacherAssignmentForm";
import { CreateAssignmentInput } from "@/lib/hooks/use-teacher-assignments";

export default function EditTeacherAssignmentPage() {
  const router = useRouter();
  const params = useParams();
  const assignmentId = params.id as string;
  const { data: assignmentData, isLoading, error } = useTeacherAssignment(assignmentId);
  const updateAssignmentMutation = useUpdateTeacherAssignment();

  const handleSubmit = async (data: CreateAssignmentInput) => {
    try {
      const cleanData: Partial<CreateAssignmentInput> = {
        classId: data.classId,
        courseId: data.courseId,
        teacherId: data.teacherId,
        contractType: data.contractType,
        datebut: data.datebut,
        datefin: data.datefin,
        courseAmount: data.courseAmount,
        status: data.status,
      };
      await updateAssignmentMutation.mutateAsync({
        id: assignmentId,
        data: cleanData,
      });
      router.push("/academic/assignments");
    } catch (error) {
      console.error("Error updating assignment:", error);
    }
  };

  const handleCancel = () => {
    router.push("/academic/assignments");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-red-100 to-rose-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-red-600" />
            </div>
            <p className="text-foreground/80 text-lg">Chargement des informations de l'affectation...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !assignmentData) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Affectation introuvable</h3>
                <p className="text-muted-foreground">
                  L'affectation demandée n'existe pas ou vous n'avez pas les permissions pour la modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/academic/assignments")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const assignment = assignmentData;

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/academic/assignments")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-red-600 to-rose-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Modifier l'affectation
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Modifiez les informations de l'affectation de {assignment.teacherName || 'l\'enseignant'}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de l'affectation</CardTitle>
          <CardDescription>
            Modifiez les informations de l'affectation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TeacherAssignmentForm
            assignment={assignment}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateAssignmentMutation.isPending}
            isEdit={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}

