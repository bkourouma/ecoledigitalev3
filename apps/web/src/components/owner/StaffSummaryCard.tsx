"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  activeTeachers: number;
  pendingPayrollValidations: number;
  coursesWithoutTeacher: number;
};

export function StaffSummaryCard({
  activeTeachers,
  pendingPayrollValidations,
  coursesWithoutTeacher,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ressources humaines</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Enseignants actifs</span>
          <span className="font-medium">{activeTeachers}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Validations paie en attente</span>
          <span className="font-medium">{pendingPayrollValidations}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Cours sans titulaire</span>
          <span className="font-medium">{coursesWithoutTeacher}</span>
        </div>
      </CardContent>
    </Card>
  );
}
