"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateEnrollment } from "@/lib/hooks/use-enrollments";
import { CreateStudentEnrollment } from "@/lib/hooks/use-enrollments";
import { EnrollmentForm } from "@/components/academic/EnrollmentForm";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";

export default function NewEnrollmentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createEnrollmentMutation = useCreateEnrollment();
  const { data: activeYearData } = useActiveAcademicYear();
  const defaultStudentId = searchParams.get("studentId") || undefined;

  const handleSubmit = async (data: any) => {
    if (!activeYearData?.data) {
      alert("Aucune année académique active trouvée");
      return;
    }

    try {
      const enrollmentData: CreateStudentEnrollment = {
        studentId: data.studentId,
        classId: data.classId,
        academicYearId: activeYearData.data.id,
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
        enrollmentDate: data.enrollmentDate || new Date().toISOString().slice(0, 10),
        status: data.status || "active",
        fees: {
          inscription: data.fees.inscription || 0,
          scolarite: data.fees.scolarite || 0,
          annexes: data.fees.annexes || 0,
          autres: data.fees.autres || 0,
          currency: data.fees.currency || 'FCFA',
        },
      };
      await createEnrollmentMutation.mutateAsync(enrollmentData);
      router.push("/annee-academique/inscription");
    } catch (error) {
      console.error("Error creating enrollment:", error);
    }
  };

  const handleCancel = () => {
    router.push("/annee-academique/inscription");
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
              Vous devez d'abord créer et activer une année académique avant de pouvoir inscrire des étudiants.
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
            Nouvelle inscription
          </h1>
          <p className="text-muted-foreground mt-2">
            Inscrivez un étudiant pour l'année académique {activeYear.name}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations d'inscription</CardTitle>
          <CardDescription>
            Remplissez les informations pour créer une nouvelle inscription
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EnrollmentForm
            academicYearId={activeYear.id}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createEnrollmentMutation.isPending}
            defaultStudentId={defaultStudentId}
            showFeesSection={false}
            showStatusField={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}
