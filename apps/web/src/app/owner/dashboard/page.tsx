"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOwnerDashboard } from "@/lib/hooks/use-owner-dashboard";
import { KpiGrid } from "@/components/owner/KpiGrid";
import { RecoveryByCycleChart } from "@/components/owner/RecoveryByCycleChart";
import { AlertsPanel } from "@/components/owner/AlertsPanel";
import { AcademicSummaryCard } from "@/components/owner/AcademicSummaryCard";
import { StaffSummaryCard } from "@/components/owner/StaffSummaryCard";
import { FormationsSummaryCard } from "@/components/owner/FormationsSummaryCard";
import { ProfessionalSummaryCard } from "@/components/owner/ProfessionalSummaryCard";

export default function OwnerDashboardPage() {
  const { data, isLoading, error } = useOwnerDashboard();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement du tableau de bord…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-700">
          {error instanceof Error ? error.message : "Impossible de charger les indicateurs."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Tableau de bord</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Indicateurs consolidés (données temps réel depuis l&apos;API).
        </p>
      </div>

      <KpiGrid
        revenueMonth={data.finances.revenueCurrentMonth}
        recoveryRate={data.finances.recoveryRate}
        totalStudents={data.academic.totalStudents}
        attendanceRate={data.academic.attendanceRate}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recouvrement par cycle</CardTitle>
          </CardHeader>
          <CardContent>
            <RecoveryByCycleChart rows={data.finances.recoveryByCycle} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alertes prioritaires</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertsPanel alerts={data.alerts} />
          </CardContent>
        </Card>
      </div>

      {/* Quatre cartes désormais : le module professionnel rejoint l'académique,
          les RH et les formations courtes. */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <AcademicSummaryCard
          averageGrade={data.academic.averageGrade}
          successRate={data.academic.successRate}
          assignmentsGradedRate={data.academic.assignmentsGradedRate}
        />
        <StaffSummaryCard
          activeTeachers={data.staff.activeTeachers}
          pendingPayrollValidations={data.staff.pendingPayrollValidations}
          coursesWithoutTeacher={data.staff.coursesWithoutTeacher}
        />
        <FormationsSummaryCard
          activeSessions={data.formations.activeSessions}
          totalEnrollments={data.formations.totalEnrollments}
          revenueFormations={data.formations.revenueFormations}
          clientCompanies={data.formations.clientCompanies}
        />
        {/* Rendu sous condition : une API antérieure à l'ajout de ce bloc renvoie
            un payload sans `professional`. Sans cette garde, un simple décalage de
            version entre le serveur et le client fait tomber TOUT le tableau de
            bord, alors que les trois autres cartes sont parfaitement affichables. */}
        {data.professional ? (
          <ProfessionalSummaryCard
            enrolledStudents={data.professional.enrolledStudents}
            enrolledStudentsPrevMonth={data.professional.enrolledStudentsPrevMonth}
            recoveryRate={data.professional.recoveryRate}
            successRateLastSemester={data.professional.successRateLastSemester}
            attendanceRate30d={data.professional.attendanceRate30d}
          />
        ) : null}
      </div>
    </div>
  );
}
