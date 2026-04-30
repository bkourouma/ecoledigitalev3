"use client";

import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import { Progress } from "@/components/ui/progress";
import { Eye, Edit, CheckCircle, Clock, AlertTriangle, FileText, User, Calendar } from "lucide-react";
import { useAutoGradeSubmission, type SubmissionWithStudent } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface SubmissionsListProps {
  assignmentId: string;
  submissions: SubmissionWithStudent[];
  showActions?: boolean;
}

export default function SubmissionsList({ assignmentId, submissions, showActions = false }: SubmissionsListProps) {
  const autoGradeMutation = useAutoGradeSubmission();

  const getStatusBadge = (status: string) => {
    const variants = {
      in_progress: "secondary",
      submitted: "default",
      graded: "outline"
    } as const;

    const labels = {
      in_progress: "En cours",
      submitted: "Soumis",
      graded: "Corrigé"
    };

    const icons = {
      in_progress: Clock,
      submitted: AlertTriangle,
      graded: CheckCircle
    };

    const Icon = icons[status as keyof typeof icons] || Clock;

    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {labels[status as keyof typeof labels] || status}
      </Badge>
    );
  };

  const getScoreDisplay = (submission: SubmissionWithStudent) => {
    if (submission.final_score !== null && submission.final_score !== undefined) {
      return `${submission.final_score}/20`;
    }
    if (submission.auto_score !== null && submission.auto_score !== undefined) {
      return `${submission.auto_score}/20 (auto)`;
    }
    if (submission.manual_score !== null && submission.manual_score !== undefined) {
      return `${submission.manual_score}/20`;
    }
    return "Non noté";
  };

  const getScoreColor = (score: number | null | undefined) => {
    if (score === null || score === undefined) return "text-muted-foreground";
    if (score >= 16) return "text-green-600";
    if (score >= 12) return "text-blue-600";
    if (score >= 8) return "text-yellow-600";
    return "text-red-600";
  };

  const handleAutoGrade = async (submissionId: string) => {
    try {
      await autoGradeMutation.mutateAsync({
        assignmentId,
        submissionId,
      });
    } catch (error) {
      alert('Erreur lors de la correction automatique: ' + String(error));
    }
  };

  const formatTime = (seconds: number | null) => {
    if (!seconds) return "N/A";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  if (submissions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 bg-muted rounded-full flex items-center justify-center">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-medium">Aucune soumission</h3>
              <p className="text-muted-foreground">
                Aucun étudiant n'a encore soumis ce devoir.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {submissions.map((submission) => (
        <Card key={submission.id} className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{submission.student_name}</CardTitle>
                  {getStatusBadge(submission.status)}
                  {submission.is_late && (
                    <Badge variant="destructive" className="text-xs">
                      En retard
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{submission.student_number}</span>
                  <span>{submission.student_email}</span>
                  <span>Tentative {submission.attempt_number}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {showActions && (
                  <>
                    {submission.assignment_type === 'evaluation' && submission.status === 'submitted' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAutoGrade(submission.id)}
                        disabled={autoGradeMutation.isPending}
                      >
                        Correction auto
                      </Button>
                    )}
                    <Link href={`/academic/evaluations/${assignmentId}/grading/${submission.id}`}>
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </Link>
                  </>
                )}
                <Link href={`/academic/evaluations/${assignmentId}/submissions/${submission.id}`}>
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </CardHeader>
          
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
              {/* Score */}
              <div>
                <p className="font-medium">Note</p>
                <p className={getScoreColor(submission.final_score || submission.auto_score || submission.manual_score)}>
                  {getScoreDisplay(submission)}
                </p>
              </div>

              {/* Submission date */}
              <div>
                <p className="font-medium">Soumis le</p>
                <p className="text-muted-foreground">
                  {submission.submitted_at ? (
                    <>
                      {format(new Date(submission.submitted_at), "dd/MM/yyyy à HH:mm", { locale: fr })}
                      <br />
                      <span className="text-xs">
                        {formatDistanceToNow(new Date(submission.submitted_at), { addSuffix: true, locale: fr })}
                      </span>
                    </>
                  ) : (
                    "Non soumis"
                  )}
                </p>
              </div>

              {/* Time spent (for evaluations) */}
              {submission.assignment_type === 'evaluation' && (
                <div>
                  <p className="font-medium">Temps passé</p>
                  <p className="text-muted-foreground">
                    {formatTime(submission.time_spent_seconds)}
                  </p>
                </div>
              )}

              {/* File info (for homework) */}
              {submission.assignment_type === 'homework' && submission.submitted_file_name && (
                <div>
                  <p className="font-medium">Fichier</p>
                  <p className="text-muted-foreground">
                    {submission.submitted_file_name}
                    <br />
                    <span className="text-xs">
                      {submission.submitted_file_size_mb?.toFixed(2)}MB
                    </span>
                  </p>
                </div>
              )}

              {/* Grading info */}
              {submission.status === 'graded' && (
                <div>
                  <p className="font-medium">Corrigé le</p>
                  <p className="text-muted-foreground">
                    {submission.graded_at && format(new Date(submission.graded_at), "dd/MM/yyyy à HH:mm", { locale: fr })}
                  </p>
                </div>
              )}
            </div>

            {/* Progress bar for score */}
            {(submission.final_score !== null && submission.final_score !== undefined) && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Score</span>
                  <span>{((submission.final_score / 20) * 100).toFixed(0)}%</span>
                </div>
                <Progress value={(submission.final_score / 20) * 100} className="h-2" />
              </div>
            )}

            {/* Feedback preview */}
            {submission.feedback && (
              <div className="mt-4 p-3 bg-muted rounded-md">
                <p className="text-sm font-medium mb-1">Commentaires</p>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {submission.feedback}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Summary stats */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="font-medium">Total</p>
              <p className="text-muted-foreground">{submissions.length} soumission{submissions.length > 1 ? 's' : ''}</p>
            </div>
            <div>
              <p className="font-medium">Soumis</p>
              <p className="text-muted-foreground">
                {submissions.filter(s => s.status === 'submitted' || s.status === 'graded').length}
              </p>
            </div>
            <div>
              <p className="font-medium">Corrigé</p>
              <p className="text-muted-foreground">
                {submissions.filter(s => s.status === 'graded').length}
              </p>
            </div>
            <div>
              <p className="font-medium">Note moyenne</p>
              <p className="text-muted-foreground">
                {(() => {
                  const gradedSubmissions = submissions.filter(s => s.final_score !== null && s.final_score !== undefined);
                  if (gradedSubmissions.length === 0) return "N/A";
                  const average = gradedSubmissions.reduce((sum, s) => sum + (s.final_score || 0), 0) / gradedSubmissions.length;
                  return `${average.toFixed(1)}/20`;
                })()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
