"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Clock, FileText, Play, AlertTriangle, CheckCircle, Download } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useAssignment, useSubmission } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import { format, formatDistanceToNow, isAfter, isBefore } from "date-fns";
import { fr } from "date-fns/locale";

export default function StudentAssignmentPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;

  const { data: assignment, isLoading: assignmentLoading, error: assignmentError } = useAssignment(assignmentId);
  const { data: submission, isLoading: submissionLoading } = useSubmission(assignmentId);

  if (assignmentLoading || submissionLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href="/evaluations">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <h2 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">Chargement...</h2>
          </div>
        </div>
      </div>
    );
  }

  if (assignmentError || !assignment) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href="/evaluations">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <h2 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">Erreur</h2>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              {assignmentError ? String(assignmentError) : "Évaluation non trouvée"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const getAssignmentStatus = () => {
    const now = new Date();
    const startsAt = assignment.starts_at ? new Date(assignment.starts_at) : null;
    const endsAt = new Date(assignment.ends_at);

    if (assignment.status !== 'published') {
      return { status: 'unavailable', label: 'Non disponible', canStart: false };
    }

    if (startsAt && isBefore(now, startsAt)) {
      return { status: 'upcoming', label: 'À venir', canStart: false };
    }

    if (isAfter(now, endsAt)) {
      return { status: 'expired', label: 'Expiré', canStart: false };
    }

    return { status: 'available', label: 'Disponible', canStart: true };
  };

  const getTypeBadge = (type: string) => {
    const variants = {
      evaluation: "default",
      homework: "secondary"
    } as const;

    const labels = {
      evaluation: "Évaluation",
      homework: "Devoir"
    };

    return (
      <Badge variant={variants[type as keyof typeof variants] || "default"}>
        {labels[type as keyof typeof labels] || type}
      </Badge>
    );
  };

  const getSubmissionStatusBadge = () => {
    if (!submission) {
      return <Badge variant="outline">Non commencé</Badge>;
    }

    const variants = {
      in_progress: "secondary",
      submitted: "default",
      graded: "default"
    } as const;

    const labels = {
      in_progress: "En cours",
      submitted: "Soumis",
      graded: "Corrigé"
    };

    return (
      <Badge variant={variants[submission.status as keyof typeof variants] || "outline"}>
        {labels[submission.status as keyof typeof labels] || submission.status}
      </Badge>
    );
  };

  const { status, label, canStart } = getAssignmentStatus();
  const isEvaluation = assignment.type === 'evaluation';
  const isHomework = assignment.type === 'homework';

  const handleStartAssignment = () => {
    if (isEvaluation) {
      router.push(`/evaluations/${assignmentId}/take`);
    } else {
      router.push(`/evaluations/${assignmentId}/submit`);
    }
  };

  const canContinue = submission && submission.status === 'in_progress' && canStart;
  const isSubmitted = submission && submission.status !== 'in_progress';
  const hasAttempts = !submission || (submission.attempt_number < assignment.max_attempts);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Link href="/evaluations">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">{assignment.title}</h2>
            {getTypeBadge(assignment.type)}
            <Badge variant={status === 'available' ? 'default' : 'secondary'}>
              {label}
            </Badge>
            {getSubmissionStatusBadge()}
          </div>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            {assignment.course_title} ({assignment.course_code})
          </p>
        </div>
      </div>

      {/* Status Alerts */}
      {!canStart && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {status === 'upcoming' && assignment.starts_at && (
              <>Cette évaluation sera disponible le {format(new Date(assignment.starts_at), "PPP à HH:mm", { locale: fr })}</>
            )}
            {status === 'expired' && (
              <>Cette évaluation a expiré le {format(new Date(assignment.ends_at), "PPP à HH:mm", { locale: fr })}</>
            )}
            {status === 'unavailable' && (
              <>Cette évaluation n'est pas encore publiée</>
            )}
          </AlertDescription>
        </Alert>
      )}

      {isSubmitted && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            {submission?.status === 'submitted' && (
              <>Votre travail a été soumis le {submission.submitted_at && format(new Date(submission.submitted_at), "PPP à HH:mm", { locale: fr })}. En attente de correction.</>
            )}
            {submission?.status === 'graded' && (
              <>Votre travail a été corrigé. Note: {submission.final_score || submission.manual_score || submission.auto_score}/20</>
            )}
          </AlertDescription>
        </Alert>
      )}

      {!hasAttempts && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Vous avez utilisé toutes vos tentatives ({assignment.max_attempts}) pour cette évaluation.
          </AlertDescription>
        </Alert>
      )}

      {/* Assignment Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Échéance</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(assignment.ends_at), "PPP à HH:mm", { locale: fr })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(assignment.ends_at), { addSuffix: true, locale: fr })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isEvaluation && assignment.duration_minutes && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Durée</p>
                  <p className="text-sm text-muted-foreground">
                    {assignment.duration_minutes} minutes
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Tentatives</p>
                <p className="text-sm text-muted-foreground">
                  {submission ? submission.attempt_number : 0} / {assignment.max_attempts}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Assignment Content */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isEvaluation ? 'Instructions de l\'évaluation' : 'Sujet du devoir'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {assignment.description && (
              <div>
                <h4 className="font-medium mb-2">Description</h4>
                <p className="text-muted-foreground">{assignment.description}</p>
              </div>
            )}

            {isEvaluation && (
              <div className="space-y-2">
                <h4 className="font-medium">Paramètres de l'évaluation</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Tentatives autorisées:</span>
                    <span className="ml-2 text-muted-foreground">{assignment.max_attempts}</span>
                  </div>
                  <div>
                    <span className="font-medium">Questions mélangées:</span>
                    <span className="ml-2 text-muted-foreground">{assignment.shuffle_questions ? 'Oui' : 'Non'}</span>
                  </div>
                  <div>
                    <span className="font-medium">Affichage des résultats:</span>
                    <span className="ml-2 text-muted-foreground">
                      {assignment.show_results_mode === 'immediate' ? 'Immédiat' :
                       assignment.show_results_mode === 'after_end' ? 'Après la fin' :
                       'Après correction'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {isHomework && (
              <div className="space-y-4">
                {assignment.subject_content && (
                  <div>
                    <h4 className="font-medium mb-2">Consignes</h4>
                    <div className="bg-muted p-4 rounded-md">
                      <pre className="whitespace-pre-wrap text-sm">
                        {assignment.subject_content}
                      </pre>
                    </div>
                  </div>
                )}
                
                {assignment.subject_document_url && (
                  <div>
                    <h4 className="font-medium mb-2">Document joint</h4>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          // Extract tenant ID from the URL
                          const urlParts = assignment.subject_document_url.split('/');
                          const tenantIdFromUrl = urlParts[4]; // /api/v1/files/{tenantId}/...

                          // Create a proper download request with authentication headers
                          const response = await fetch(`http://localhost:4000${assignment.subject_document_url}`, {
                            headers: {
                              'X-Tenant': tenantIdFromUrl,
                                                            'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
                            },
                          });

                          if (!response.ok) {
                            throw new Error(`Erreur ${response.status}: ${response.statusText}`);
                          }

                          // Create blob and download
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `sujet-${assignment.title}.pdf`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          window.URL.revokeObjectURL(url);
                        } catch (error) {
                          console.error('Erreur lors du téléchargement:', error);
                          alert(`Erreur lors du téléchargement: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
                        }
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Télécharger le sujet
                    </Button>
                  </div>
                )}

                <div>
                  <h4 className="font-medium mb-2">Instructions de soumission</h4>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>• Format accepté: PDF uniquement</p>
                    <p>• Taille maximale: {assignment.max_file_size_mb}MB</p>
                    <p>• Retard autorisé: {assignment.late_submission_allowed ? 'Oui' : 'Non'}</p>
                    {assignment.late_submission_allowed && assignment.late_penalty_percent > 0 && (
                      <p>• Pénalité de retard: {assignment.late_penalty_percent}%</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-end gap-4">
        <Link href="/evaluations">
          <Button variant="outline">Retour à la liste</Button>
        </Link>
        
        {canStart && hasAttempts && (
          <Button onClick={handleStartAssignment} disabled={!canStart}>
            <Play className="h-4 w-4 mr-2" />
            {canContinue ? 'Continuer' : 
             isEvaluation ? 'Commencer l\'évaluation' : 
             'Soumettre le devoir'}
          </Button>
        )}
      </div>

      {/* Submission History */}
      {submission && (
        <Card>
          <CardHeader>
            <CardTitle>Historique des soumissions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span>Tentative {submission.attempt_number}</span>
                <span className="text-muted-foreground">
                  {submission.submitted_at ? 
                    `Soumis le ${format(new Date(submission.submitted_at), "PPP à HH:mm", { locale: fr })}` :
                    'En cours'
                  }
                </span>
              </div>
              
              {submission.final_score !== undefined && (
                <div className="flex justify-between items-center text-sm">
                  <span>Note finale</span>
                  <span className="font-medium">{submission.final_score}/20</span>
                </div>
              )}
              
              {submission.feedback && (
                <div className="mt-4">
                  <h5 className="font-medium mb-2">Commentaires</h5>
                  <div className="bg-muted p-3 rounded-md text-sm">
                    {submission.feedback}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
