"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useEnrollment, useUpdateEnrollment } from "@/lib/hooks/use-enrollments";
import { EnrollmentForm } from "@/components/academic/EnrollmentForm";
import { UpdateStudentEnrollment } from "@/lib/hooks/use-enrollments";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";

export default function EditEnrollmentPage() {
  const router = useRouter();
  const params = useParams();
  const enrollmentId = params.id as string;
  const { data: enrollmentData, isLoading, error } = useEnrollment(enrollmentId);
  const updateEnrollmentMutation = useUpdateEnrollment();
  const { data: activeYearData } = useActiveAcademicYear();

  const handleSubmit = async (data: any) => {
    try {
      const cleanData: UpdateStudentEnrollment = {
        classId: data.classId,
        originSchool: data.originSchool || undefined,
        lv2: data.lv2 || undefined,
        scholarshipLevel: data.scholarshipLevel || "non",
        isRepeating: data.isRepeating ?? false,
        isTransfer: data.isTransfer ?? false,
        isInscribed: data.isInscribed ?? true,
        transferDecision: data.transferDecision || undefined,
        affectationStatus: data.affectationStatus || "affecte",
        affectationDecision: data.affectationDecision || undefined,
        cepeCode: data.cepeCode || undefined,
        enrollmentDate: data.enrollmentDate,
        status: data.status,
        fees: {
          inscription: data.fees.inscription || 0,
          scolarite: data.fees.scolarite || 0,
          annexes: data.fees.annexes || 0,
          autres: data.fees.autres || 0,
          currency: data.fees.currency || 'FCFA',
        },
      };
      await updateEnrollmentMutation.mutateAsync({
        id: enrollmentId,
        data: cleanData,
      });
      router.push("/annee-academique/inscription");
    } catch (error) {
      console.error("Error updating enrollment:", error);
    }
  };

  const handleCancel = () => {
    router.push("/annee-academique/inscription");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-cyan-100 to-blue-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations de l'inscription...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !enrollmentData?.data) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Inscription introuvable</h3>
                <p className="text-muted-foreground">
                  L'inscription demandée n'existe pas ou vous n'avez pas les permissions pour la modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/annee-academique/inscription")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const enrollment = enrollmentData.data;
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
              Vous devez d'abord créer et activer une année académique.
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
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/annee-academique/inscription")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
            Modifier l'inscription
          </h1>
          <p className="text-muted-foreground mt-2">
            Modifiez les informations de l'inscription
            {enrollment.student && ` de ${enrollment.student.firstName} ${enrollment.student.lastName}`}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations d'inscription</CardTitle>
          <CardDescription>
            Modifiez les informations de l'inscription
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EnrollmentForm
            enrollment={enrollment}
            academicYearId={activeYear.id}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateEnrollmentMutation.isPending}
            isEdit={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}
