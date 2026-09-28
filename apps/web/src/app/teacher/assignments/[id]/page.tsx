"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Edit, Settings, Users, BarChart3, Plus, FileText, Clock, Calendar, Eye, CheckCircle } from "lucide-react";
import React from "react";
import { useParams } from "next/navigation";
import { useAssignment, useQuestions, useSubmissions } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import AssignmentDownloadUnified from "@/components/assignments/AssignmentDownloadUnified";
import { formatDistanceToNow, format } from "date-fns";
import { fr } from "date-fns/locale";

export default function TeacherAssignmentDetailPage() {
  const params = useParams();
  const assignmentId = params.id as string;

  const { data: assignment, isLoading, error } = useAssignment(assignmentId);
  const { data: questionsData } = useQuestions(assignmentId, {
    enabled: assignment?.type === 'evaluation'
  });
  const { data: submissionsData } = useSubmissions(assignmentId, { limit: 10 });

  const questions = questionsData?.questions || [];
  const submissions = submissionsData?.submissions || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href="/teacher/assignments">
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

  if (error || !assignment) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href="/teacher/assignments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <h2 className="whitespace-nowrap font-bold text-red-600 text-2xl leading-tight md:text-3xl">Erreur</h2>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              Impossible de charger les détails du devoir.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'evaluation':
        return <Badge variant="default">Évaluation</Badge>;
      case 'homework':
        return <Badge variant="secondary">Devoir</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline">Brouillon</Badge>;
      case 'published':
        return <Badge variant="default">Publié</Badge>;
      case 'archived':
        return <Badge variant="secondary">Archivé</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const isEvaluation = assignment.type === 'evaluation';
  const isHomework = assignment.type === 'homework';

  // Calculate statistics
  const totalSubmissions = submissions.length;
  const gradedSubmissions = submissions.filter(s => s.status === 'graded').length;
  const pendingSubmissions = submissions.filter(s => s.status === 'submitted').length;
  const averageScore = submissions.length > 0 
    ? submissions.reduce((acc, s) => acc + (s.final_score || 0), 0) / submissions.length 
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href="/teacher/assignments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="whitespace-nowrap font-bold leading-tight text-2xl md:text-3xl">{assignment.title}</h2>
              {getTypeBadge(assignment.type)}
              {getStatusBadge(assignment.status)}
            </div>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              {assignment.course_title} ({assignment.course_code})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/academic/evaluations/${assignmentId}`}>
            <Button variant="outline">
              <Eye className="h-4 w-4 mr-2" />
              Vue Admin
            </Button>
          </Link>
          <Link href={`/academic/evaluations/${assignmentId}/edit`}>
            <Button variant="outline">
              <Edit className="h-4 w-4 mr-2" />
              Modifier
            </Button>
          </Link>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Soumissions</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSubmissions}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Corrigées</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{gradedSubmissions}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En Attente</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{pendingSubmissions}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Note Moyenne</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{averageScore.toFixed(1)}/20</div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Aperçu</TabsTrigger>
          {isEvaluation && <TabsTrigger value="questions">Questions ({questions.length})</TabsTrigger>}
          <TabsTrigger value="submissions">Soumissions ({totalSubmissions})</TabsTrigger>
          <TabsTrigger value="grading">Correction</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {assignment.description || "Aucune description fournie."}
              </p>
            </CardContent>
          </Card>

          {isHomework && assignment.subject_content && (
            <Card>
              <CardHeader>
                <CardTitle>Consignes</CardTitle>
                <CardDescription>Texte affiché aux étudiants en complément du document.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-wrap">{assignment.subject_content}</p>
              </CardContent>
            </Card>
          )}

          {isHomework && assignment.subject_document_url && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 shrink-0" />
                  Sujet joint (PDF)
                </CardTitle>
                <CardDescription>
                  Document du devoir : même fichier que pour les étudiants (téléchargement).
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4">
                <AssignmentDownloadUnified
                  assignmentId={assignment.id}
                  fileUrl={assignment.subject_document_url}
                  fileName={`${assignment.title.replace(/[^\w\s.-]/g, "").trim().slice(0, 80) || "sujet"}.pdf`}
                  showFileName
                  variant="default"
                  size="sm"
                />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Informations générales</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Date de fin</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(assignment.ends_at), "PPP 'à' HH:mm", { locale: fr })}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Créé</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(assignment.created_at), { 
                      addSuffix: true, 
                      locale: fr 
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Dernière modification</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(assignment.updated_at), { 
                      addSuffix: true, 
                      locale: fr 
                    })}
                  </p>
                </div>
              </CardContent>
            </Card>

            {isEvaluation && (
              <Card>
                <CardHeader>
                  <CardTitle>Paramètres de l'évaluation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Durée</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.duration_minutes} minutes
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Tentatives autorisées</p>
                    <p className="text-sm text-muted-foreground">{assignment.max_attempts}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Questions mélangées</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.shuffle_questions ? 'Oui' : 'Non'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Affichage des résultats</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.show_results_mode === 'immediate' ? 'Immédiat' :
                       assignment.show_results_mode === 'after_end' ? 'Après la fin' :
                       'Après correction'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {isHomework && (
              <Card>
                <CardHeader>
                  <CardTitle>Paramètres du devoir</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Taille max des fichiers</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.max_file_size_mb} MB
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Soumission tardive</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.late_submission_allowed ? 'Autorisée' : 'Non autorisée'}
                    </p>
                  </div>
                  {assignment.late_submission_allowed && (
                    <div>
                      <p className="text-sm font-medium">Pénalité de retard</p>
                      <p className="text-sm text-muted-foreground">
                        {assignment.late_penalty_percent}%
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {isEvaluation && (
          <TabsContent value="questions" className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-medium">Questions ({questions.length})</h3>
                <p className="text-sm text-muted-foreground">
                  Gérez les questions de votre évaluation
                </p>
              </div>
              <Link href={`/teacher/assignments/${assignmentId}/questions/create`}>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter une question
                </Button>
              </Link>
            </div>

            <div className="space-y-4">
              {questions.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-8">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">Aucune question</h3>
                    <p className="text-muted-foreground mb-4">
                      Commencez par ajouter des questions à votre évaluation.
                    </p>
                    <Link href={`/teacher/assignments/${assignmentId}/questions/create`}>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Ajouter une question
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                questions.map((question, index) => (
                  <Card key={question.id}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-base">
                            Question {index + 1} - {question.points} point{question.points > 1 ? 's' : ''}
                          </CardTitle>
                          <Badge variant="outline" className="mt-1">
                            {question.type === 'single_choice' ? 'Choix unique' :
                             question.type === 'multiple_choice' ? 'Choix multiples' :
                             question.type === 'true_false' ? 'Vrai/Faux' :
                             question.type === 'short_text' ? 'Réponse courte' :
                             'Texte à trous'}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{question.question_text}</p>
                      {(question.type === 'single_choice' || question.type === 'multiple_choice') && (
                        <div className="mt-3 space-y-1">
                          {question.options?.map((option, optionIndex) => (
                            <div key={optionIndex} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {String.fromCharCode(65 + optionIndex)}.
                              </span>
                              <span className="text-sm">{option}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        )}

        <TabsContent value="submissions" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Soumissions ({totalSubmissions})</h3>
              <p className="text-sm text-muted-foreground">
                Consultez les soumissions de vos étudiants
              </p>
            </div>
            <Link href={`/academic/evaluations/${assignmentId}/grading`}>
              <Button>
                <Settings className="h-4 w-4 mr-2" />
                Gérer les corrections
              </Button>
            </Link>
          </div>

          <div className="space-y-4">
            {submissions.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Aucune soumission</h3>
                  <p className="text-muted-foreground">
                    Les soumissions des étudiants apparaîtront ici.
                  </p>
                </CardContent>
              </Card>
            ) : (
              submissions.slice(0, 5).map((submission) => (
                <Card key={submission.id}>
                  <CardContent className="pt-6">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium">{submission.student_name}</h4>
                        <p className="text-sm text-muted-foreground">
                          {submission.student_email}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Soumis {formatDistanceToNow(new Date(submission.submitted_at || submission.created_at), { 
                            addSuffix: true, 
                            locale: fr 
                          })}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant={
                          submission.status === 'graded' ? 'default' :
                          submission.status === 'submitted' ? 'secondary' :
                          'outline'
                        }>
                          {submission.status === 'graded' ? 'Corrigé' :
                           submission.status === 'submitted' ? 'Soumis' :
                           submission.status}
                        </Badge>
                        {submission.final_score !== null && (
                          <p className="text-sm font-medium mt-1">
                            {submission.final_score}/20
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
            
            {submissions.length > 5 && (
              <div className="text-center">
                <Link href={`/academic/evaluations/${assignmentId}/grading`}>
                  <Button variant="outline">
                    Voir toutes les soumissions ({totalSubmissions})
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="grading" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Correction</h3>
              <p className="text-sm text-muted-foreground">
                Corrigez les soumissions de vos étudiants
              </p>
            </div>
            <Link href={`/academic/evaluations/${assignmentId}/grading`}>
              <Button>
                <Settings className="h-4 w-4 mr-2" />
                Interface de correction
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Soumissions en attente</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-orange-600">{pendingSubmissions}</div>
                <p className="text-sm text-muted-foreground">À corriger</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Soumissions corrigées</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">{gradedSubmissions}</div>
                <p className="text-sm text-muted-foreground">Terminées</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Note moyenne</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{averageScore.toFixed(1)}</div>
                <p className="text-sm text-muted-foreground">Sur 20</p>
              </CardContent>
            </Card>
          </div>

          {pendingSubmissions > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Actions rapides</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Link href={`/academic/evaluations/${assignmentId}/grading`}>
                    <Button>
                      Commencer la correction
                    </Button>
                  </Link>
                  {isEvaluation && (
                    <Button variant="outline">
                      Correction automatique
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
