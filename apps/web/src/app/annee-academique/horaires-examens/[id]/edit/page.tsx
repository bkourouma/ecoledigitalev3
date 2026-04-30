"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useExamSchedule, useUpdateExamSchedule } from "@/lib/hooks/use-exam-schedules";
import { ExamScheduleForm } from "@/components/academic/ExamScheduleForm";
import { UpdateExamSchedule } from "@/lib/hooks/use-exam-schedules";

export default function EditExamSchedulePage() {
  const router = useRouter();
  const params = useParams();
  const examScheduleId = params.id as string;
  const { data: examScheduleData, isLoading, error } = useExamSchedule(examScheduleId);
  const updateExamScheduleMutation = useUpdateExamSchedule();

  const handleSubmit = async (data: UpdateExamSchedule) => {
    try {
      const cleanData: UpdateExamSchedule = {
        courseId: data.courseId,
        academicYearId: data.academicYearId,
        name: data.name,
        type: data.type,
        examDate: data.examDate,
        examTime: data.examTime || undefined,
        duration: data.duration || undefined,
        location: data.location || undefined,
      };
      await updateExamScheduleMutation.mutateAsync({
        id: examScheduleId,
        data: cleanData,
      });
      router.push("/annee-academique/horaires-examens");
    } catch (error) {
      console.error("Error updating exam schedule:", error);
    }
  };

  const handleCancel = () => {
    router.push("/annee-academique/horaires-examens");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-orange-100 to-amber-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
            </div>
            <p className="text-foreground/80 text-lg">Chargement des informations de l'horaire d'examen...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !examScheduleData) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Horaire d'examen introuvable</h3>
                <p className="text-muted-foreground">
                  L'horaire d'examen demandé n'existe pas ou vous n'avez pas les permissions pour le modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/annee-academique/horaires-examens")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const examSchedule = examScheduleData;

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/annee-academique/horaires-examens")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">
            Modifier l'horaire d'examen
          </h1>
          <p className="text-muted-foreground mt-2">
            Modifiez les informations de {examSchedule.name}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de l'horaire d'examen</CardTitle>
          <CardDescription>
            Modifiez les informations de l'horaire d'examen
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExamScheduleForm
            examSchedule={examSchedule}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateExamScheduleMutation.isPending}
            isEdit={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}

