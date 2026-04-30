"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from "@ecoledigitale/ui";
import { useTeacher } from "@/lib/hooks/use-teachers";
import { useTeacherAssignments } from "@/lib/hooks/use-teacher-assignments";
import { ArrowLeft, Calendar, User, BookOpen } from "lucide-react";

export default function TeacherAssignmentsPage() {
  const params = useParams();
  const router = useRouter();
  const teacherId = params.id as string;

  const { data: teacher, isLoading: loadingTeacher } = useTeacher(teacherId);
  const { data: assignmentsData, isLoading: loadingAssignments } = useTeacherAssignments({ teacherId, page: 1, limit: 50 });

  const assignments = assignmentsData?.data || [];

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
        <div className="text-right">
          <h2 className="text-2xl font-bold">Affectations</h2>
          {teacher && (
            <p className="text-muted-foreground text-sm flex items-center justify-end gap-2">
              <User className="h-4 w-4" /> {teacher.firstName} {teacher.lastName}
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Liste des affectations</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingAssignments ? (
            <p className="text-sm text-muted-foreground">Chargement...</p>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune affectation pour cet enseignant.</p>
          ) : (
            <div className="space-y-3">
              {assignments.map((a: any) => (
                <div key={a.id} className="border rounded p-3 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <BookOpen className="h-4 w-4" />
                      <span>Cours:</span>
                      <code>{a.course_id}</code>
                      <span className="ml-2">Classe:</span>
                      <code>{a.class_id}</code>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>{a.datebut} → {a.datefin}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={a.contract_type === "vacataire" ? "outline" : "secondary"}>{a.contract_type}</Badge>
                    {a.status && <Badge variant="default">{a.status}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

