"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateExamSchedule } from "@/lib/hooks/use-exam-schedules";
import { CreateExamSchedule } from "@/lib/hooks/use-exam-schedules";
import { ExamScheduleForm } from "@/components/academic/ExamScheduleForm";

export default function NewExamSchedulePage() {
  const router = useRouter();
  const createExamScheduleMutation = useCreateExamSchedule();

  const handleSubmit = async (data: CreateExamSchedule) => {
    try {
      const cleanData: CreateExamSchedule = {
        courseId: data.courseId,
        academicYearId: data.academicYearId,
        name: data.name,
        type: data.type,
        examDate: data.examDate,
        examTime: data.examTime || undefined,
        duration: data.duration || undefined,
        location: data.location || undefined,
      };
      await createExamScheduleMutation.mutateAsync(cleanData);
      router.push("/annee-academique/horaires-examens");
    } catch (error) {
      console.error("Error creating exam schedule:", error);
    }
  };

  const handleCancel = () => {
    router.push("/annee-academique/horaires-examens");
  };

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
            Nouvel horaire d'examen
          </h1>
          <p className="text-muted-foreground mt-2">
            Créez un nouvel horaire d'examen avec toutes les informations nécessaires
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de l'horaire d'examen</CardTitle>
          <CardDescription>
            Remplissez les informations pour créer un nouvel horaire d'examen
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExamScheduleForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createExamScheduleMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

