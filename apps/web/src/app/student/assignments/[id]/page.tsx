"use client";

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  FileText,
  Clock,
  Calendar,
  AlertCircle,
  CheckCircle,
  Upload,
  Download,
  Eye,
  Loader2,
  User,
  BookOpen,
  Target,
  Timer,
  Send,
  Edit,
  Save,
} from "lucide-react";
import { useStudentAssignment } from "@/lib/hooks/use-student-data";
import ErrorBoundary from "@/components/ErrorBoundary";
import FileUploadSubmission from "@/components/assignments/FileUploadSubmission";
import TextResponseSubmission from "@/components/assignments/TextResponseSubmission";
import OnlineEvaluationSubmission from "@/components/assignments/OnlineEvaluationSubmission";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import Link from "next/link";
import AssignmentDownloadUnified from '@/components/assignments/AssignmentDownloadUnified';

function StudentAssignmentDetailPageContent() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const assignmentId = params.id as string;

  const { data: assignmentData, isLoading, error } = useStudentAssignment(assignmentId);
  const [submissionStatus, setSubmissionStatus] = useState<'pending' | 'in_progress' | 'submitted' | 'graded'>('pending');

  // Redirect if not authenticated or not student
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  const roles = (session as any)?.roles ?? [];
  const isStudent = Array.isArray(roles) && roles.some((r: string) => ['student', 'Étudiant'].includes(r));

  if (!isStudent) {
    redirect('/');
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/student/assignments">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Retour
              </Button>
            </Link>
            <div>
              <div className="h-8 bg-muted rounded w-64 animate-pulse mb-2" />
              <div className="h-4 bg-muted rounded w-32 animate-pulse" />
            </div>
          </div>
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="h-4 bg-muted rounded w-full animate-pulse" />
                  <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    // Parse error to determine type
    const errorMessage = error?.message || 'Erreur inconnue';
    const is404 = errorMessage.includes('404');
    const is500 = errorMessage.includes('500');
    const is403 = errorMessage.includes('403');
    
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
            <Link href="/student/assignments">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
            </Link>
            <div>
              <h2 className="whitespace-nowrap font-bold text-red-400 text-2xl leading-tight md:text-3xl">
                {is404 ? 'Devoir introuvable' : is403 ? 'Accès refusé' : 'Erreur de chargement'}
              </h2>
              <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
                {is404 
                  ? 'Ce devoir n\'existe pas ou n\'est pas assigné à vos cours' 
                  : is403
                  ? 'Vous n\'avez pas accès à ce devoir'
                  : 'Une erreur s\'est produite lors du chargement'}
              </p>
            </div>
          </div>
          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {is404 ? 'Devoir non accessible' : is500 ? 'Erreur serveur' : 'Erreur de chargement'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {is404 
                    ? 'Ce devoir n\'existe pas ou n\'est pas assigné à vos cours. Veuillez vérifier que vous êtes inscrit dans le cours concerné.' 
                    : is500
                    ? 'Une erreur s\'est produite sur le serveur. Veuillez réessayer dans quelques instants.'
                    : error?.message || 'Une erreur s\'est produite lors du chargement du devoir.'}
                </p>
                <div className="flex gap-3 justify-center">
                  <Link href="/student/assignments">
                    <Button variant="outline">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Retour aux devoirs
                    </Button>
                  </Link>
                  {!is404 && (
                    <Button onClick={() => window.location.reload()}>
                      <Loader2 className="h-4 w-4 mr-2" />
                      Réessayer
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!assignmentData?.data) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
            <Link href="/student/assignments">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
            </Link>
            <div>
              <h2 className="whitespace-nowrap font-bold text-foreground text-2xl leading-tight md:text-3xl">Devoir introuvable</h2>
              <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">Ce devoir n'existe pas ou vous n'y avez pas accès</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const assignment = assignmentData.data;

  // Handle submission status changes
  const handleSubmissionChange = (submission: any) => {
    if (submission?.status) {
      setSubmissionStatus(submission.status);
    }
  };

  // Helper functions
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200">
            En attente
          </Badge>
        );
      case 'in_progress':
        return (
          <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200">
            En cours
          </Badge>
        );
      case 'submitted':
        return (
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
            Soumis
          </Badge>
        );
      case 'graded':
        return (
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
            Noté
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
            {status}
          </Badge>
        );
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive">Priorité élevée</Badge>;
      case 'medium':
        return (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200">
            Priorité moyenne
          </Badge>
        );
      case 'low':
        return (
          <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
            Priorité faible
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
            {priority}
          </Badge>
        );
    }
  };

  const getSubmissionTypeBadge = (type: string) => {
    switch (type) {
      case 'file':
        return (
          <Badge variant="outline" className="border-violet-500/40 bg-violet-500/15 text-violet-200">
            <Upload className="h-3 w-3 mr-1 shrink-0" />
            Fichier
          </Badge>
        );
      case 'text':
        return (
          <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200">
            <Edit className="h-3 w-3 mr-1 shrink-0" />
            Texte
          </Badge>
        );
      case 'online':
        return (
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
            <Eye className="h-3 w-3 mr-1 shrink-0" />
            En ligne
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
            {type}
          </Badge>
        );
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'PPP à HH:mm', { locale: fr });
    } catch {
      return dateString;
    }
  };

  const isOverdue = () => {
    if (!assignment.due_date) return false;
    return new Date() > new Date(assignment.due_date);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3 sm:items-start sm:justify-between">
          <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
            <Link href="/student/assignments" className="shrink-0">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Retour
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                <h1 className="whitespace-nowrap font-bold text-foreground leading-tight text-2xl md:text-3xl">{assignment.title}</h1>
                {getStatusBadge(assignment.status)}
                {getPriorityBadge(assignment.priority)}
              </div>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                <div className="flex items-center gap-1 min-w-0">
                  <BookOpen className="h-4 w-4 shrink-0" />
                  <span className="truncate">{assignment.course.name} ({assignment.course.code})</span>
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  <User className="h-4 w-4 shrink-0" />
                  <span className="truncate">{assignment.instructor.first_name} {assignment.instructor.last_name}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="text-left sm:text-right shrink-0">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-1">
              <Calendar className="h-4 w-4 shrink-0" />
              <span>Échéance : {formatDate(assignment.due_date)}</span>
              {isOverdue() && <AlertCircle className="h-4 w-4 text-red-400 shrink-0" aria-label="En retard" />}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="h-4 w-4 shrink-0" />
              <span>{assignment.max_points} points</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="details" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 bg-muted/50">
            <TabsTrigger value="details" className="data-[state=active]:text-foreground">Détails</TabsTrigger>
            <TabsTrigger value="submission" className="data-[state=active]:text-foreground">Ma soumission</TabsTrigger>
            <TabsTrigger value="feedback" className="data-[state=active]:text-foreground">Feedback</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-6">
            {/* Assignment Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <FileText className="h-5 w-5 text-emerald-400 shrink-0" />
                  Description du devoir
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-foreground/90 whitespace-pre-wrap">
                  {assignment.description || 'Aucune description fournie.'}
                </p>
                
                {/* Subject Content for PDF assignments */}
                {assignment.submission_type === 'homework' && assignment.subject_content && (
                  <div className="mt-4 p-4 rounded-lg border border-sky-500/30 bg-sky-500/10">
                    <h4 className="font-medium text-sky-200 mb-2">Sujet du devoir</h4>
                    <p className="text-foreground/90 whitespace-pre-wrap">{assignment.subject_content}</p>
                  </div>
                )}
                
                {/* PDF Document for homework assignments */}
                {assignment.submission_type === 'homework' && assignment.subject_document_url && (
                  <div className="mt-4 p-4 rounded-lg border border-border bg-muted/40">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-red-500/15 rounded-lg shrink-0">
                          <FileText className="h-5 w-5 text-red-400" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-medium text-foreground">Document PDF du devoir</h4>
                          <p className="text-sm text-muted-foreground">Télécharger le document joint</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <AssignmentDownloadUnified
                          assignmentId={assignment.id}
                          fileUrl={assignment.subject_document_url}
                          fileName={assignment.subject_document_name || `${assignment.title}.pdf`}
                          showFileName={false}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Assignment Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">Informations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/15 rounded-lg shrink-0">
                      <FileText className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">Type de soumission</p>
                      <div className="mt-1">
                        {getSubmissionTypeBadge(assignment.submission_type)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-sky-500/15 rounded-lg shrink-0">
                      <Target className="h-4 w-4 text-sky-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Points maximum</p>
                      <p className="text-sm text-muted-foreground">{assignment.max_points} points</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-500/15 rounded-lg shrink-0">
                      <Calendar className="h-4 w-4 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Date d'échéance</p>
                      <p className="text-sm text-muted-foreground">{formatDate(assignment.due_date)}</p>
                    </div>
                  </div>
                  {assignment.submitted_at && (
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/15 rounded-lg shrink-0">
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Soumis le</p>
                        <p className="text-sm text-muted-foreground">{formatDate(assignment.submitted_at)}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="submission" className="space-y-6">
            {/* Submission Status Indicator */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-emerald-500/15 rounded-lg shrink-0">
                      <FileText className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">Statut de la soumission</p>
                      <p className="text-sm text-muted-foreground">
                        {submissionStatus === 'pending' && 'Aucune soumission commencée'}
                        {submissionStatus === 'in_progress' && 'Travail en cours de rédaction'}
                        {submissionStatus === 'submitted' && 'Travail soumis, en attente de correction'}
                        {submissionStatus === 'graded' && 'Travail corrigé et noté'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Soumissions : {assignment.submission_count || 0}/{assignment.max_attempts || 2}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {getStatusBadge(submissionStatus)}
                    {isOverdue() && submissionStatus !== 'submitted' && submissionStatus !== 'graded' && (
                      <Badge variant="destructive">En retard</Badge>
                    )}
                    {!assignment.can_submit && (
                      <Badge variant="destructive">Limite atteinte</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>


            {/* Render appropriate submission component based on assignment type */}
            {assignment.submission_type === 'homework' && (
              <FileUploadSubmission
                assignmentId={assignmentId}
                maxFileSizeMB={assignment.max_file_size_mb || 10}
                allowedFileTypes={['.pdf']}
                dueDate={assignment.due_date}
                allowLateSubmissions={assignment.allow_late_submissions || false}
                onSubmissionChange={handleSubmissionChange}
                disabled={!assignment.can_submit}
                maxAttempts={assignment.max_attempts || 2}
                currentAttempts={assignment.submission_count || 0}
              />
            )}

            {assignment.submission_type === 'evaluation' && (
              <OnlineEvaluationSubmission
                assignmentId={assignment.assignment_id} // Use assignment template ID for questions
                assignmentInstanceId={assignmentId} // Use instance ID for submissions (deadline check)
                questions={[]} // Will be fetched from API
                timeLimit={assignment.duration_minutes || 60}
                dueDate={assignment.due_date}
                allowLateSubmissions={assignment.allow_late_submissions || false}
                onSubmissionChange={handleSubmissionChange}
              />
            )}
          </TabsContent>

          <TabsContent value="feedback" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">Feedback et note</CardTitle>
              </CardHeader>
              <CardContent>
                {assignment.status === 'graded' ? (
                  <div className="space-y-4">
                    {assignment.grade !== null && (
                      <div className="flex items-center gap-4 p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                        <div className="p-2 bg-emerald-500/20 rounded-lg shrink-0">
                          <Target className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Note obtenue</p>
                          <p className="text-2xl font-bold text-emerald-400">
                            {assignment.grade}/{assignment.max_points}
                          </p>
                        </div>
                      </div>
                    )}
                    {assignment.feedback && (
                      <div className="p-4 rounded-lg border border-border bg-muted/40">
                        <p className="text-sm font-medium text-foreground mb-2">Commentaires de l'enseignant</p>
                        <p className="text-foreground/90 whitespace-pre-wrap">{assignment.feedback}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      En attente de correction
                    </h3>
                    <p className="text-muted-foreground">
                      {assignment.status === 'submitted' 
                        ? 'Votre travail a été soumis et est en cours de correction.'
                        : 'Soumettez votre travail pour recevoir une note et des commentaires.'
                      }
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function StudentAssignmentDetailPage() {
  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="text-center max-w-md">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Erreur de chargement du devoir
            </h2>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Une erreur s'est produite lors du chargement des détails du devoir. Veuillez recharger la page.
            </p>
          </div>
        </div>
      }
    >
      <StudentAssignmentDetailPageContent />
    </ErrorBoundary>
  );
}
