"use client";

import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  enrolledStudents: number;
  enrolledStudentsPrevMonth: number;
  recoveryRate: number;
  successRateLastSemester: number | null;
  attendanceRate30d: number;
};

export function ProfessionalSummaryCard({
  enrolledStudents,
  enrolledStudentsPrevMonth,
  recoveryRate,
  successRateLastSemester,
  attendanceRate30d,
}: Props) {
  const delta = enrolledStudents - enrolledStudentsPrevMonth;
  const flat = delta === 0;
  const DeltaIcon = delta > 0 ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Module professionnel</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Étudiants inscrits</span>
          <span className="font-medium flex items-center gap-1.5">
            {enrolledStudents}
            {flat ? null : (
              // La flèche double la couleur : le sens ne repose jamais sur la teinte.
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs",
                  delta > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                )}
              >
                <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
                {delta > 0 ? "+" : ""}
                {delta}
              </span>
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Recouvrement UE</span>
          <span className="font-medium">{recoveryRate.toFixed(1)} %</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Réussite (dernier semestre)</span>
          <span className="font-medium">
            {successRateLastSemester === null
              ? "—"
              : `${successRateLastSemester.toFixed(1)} %`}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Présence (30 j.)</span>
          <span className="font-medium">{attendanceRate30d.toFixed(1)} %</span>
        </div>
        <Link
          href="/owner/pedagogie"
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          Voir le détail
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
