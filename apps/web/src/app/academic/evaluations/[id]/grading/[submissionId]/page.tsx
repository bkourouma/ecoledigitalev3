"use client";

import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Textarea, Badge } from "@ecoledigitale/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Save, CheckCircle, XCircle, User, Clock, FileText, Download } from "lucide-react";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAssignment, useQuestions, useSubmissionDetails, useGradeSubmission, useAutoGradeSubmission } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function GradeSubmissionPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;
  const submissionId = params.submissionId as string;

  const {
    data: assignment,
    isLoading: isAssignmentLoading,
    error: assignmentError,
  } = useAssignment(assignmentId);
  const {
    data: questionsData,
    isLoading: isQuestionsLoading,
  } = useQuestions(assignmentId, {
    enabled: assignment?.type === 'evaluation'
  });
  const {
    data: submission,
    isLoading: isSubmissionLoading,
    error: submissionError,
  } = useSubmissionDetails(assignmentId, submissionId);
  
  const gradeSubmissionMutation = useGradeSubmission();
  const autoGradeMutation = useAutoGradeSubmission();

  const questions = questionsData?.questions || [];

  const [manualScore, setManualScore] = useState<number | "">("");
  const [feedback, setFeedback] = useState("");

  // Initialize form with existing data
  useEffect(() => {
    if (submission) {
      setManualScore(submission.manual_score || submission.final_score || "");
      setFeedback(submission.feedback || "");
    }
  }, [submission]);

  const handleAutoGrade = async () => {
    try {
      await autoGradeMutation.mutateAsync({
        assignmentId,
        submissionId,
      });
    } catch (error) {
      alert('Erreur lors de la correction automatique: ' + String(error));
    }
  };

  const handleSaveGrade = async () => {
    try {
      await gradeSubmissionMutation.mutateAsync({
        assignmentId,
        submissionId,
        data: {
          manual_score: typeof manualScore === "number" ? manualScore : undefined,
          feedback: feedback.trim() || undefined,
        },
      });
      router.push(`/academic/evaluations/${assignmentId}/grading`);
    } catch (error) {
      alert('Erreur lors de la sauvegarde: ' + String(error));
    }
  };

  const getQuestionResult = (questionId: string) => {
    const question = questions.find(q => q.id === questionId);
    const answer = submission?.answers?.[questionId];
    
    if (!question) return null;

    let isCorrect = false;
    
    switch (question.type) {
      case 'single_choice':
        isCorrect = answer === question.correct_answer;
        break;
      case 'multiple_choice':
        const correctAnswers = Array.isArray(question.correct_answer) ? question.correct_answer : [];
        const userAnswers = Array.isArray(answer) ? answer : [];
        isCorrect = correctAnswers.length === userAnswers.length && 
                   correctAnswers.every(a => userAnswers.includes(a));
        break;
      case 'true_false':
        isCorrect = answer === question.correct_answer;
        break;
      case 'short_text':
      case 'fill_blank':
        // For text questions, manual review needed
        isCorrect = false; // Placeholder
        break;
    }

    return { question, answer, isCorrect };
  };

  const formatTime = (seconds?: number | null) => {
    if (!seconds) return "N/A";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const isLoadingPage =
    isAssignmentLoading ||
    isSubmissionLoading ||
    (assignment?.type === "evaluation" && isQuestionsLoading);

  const errorMessage =
    (assignmentError instanceof Error && assignmentError.message) ||
    (submissionError instanceof Error && submissionError.message) ||
    null;

  if (isLoadingPage) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/academic/evaluations/${assignmentId}/grading`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold">Chargement...</h2>
          </div>
        </div>
      </div>
    );
  }

  if (errorMessage || !assignment || !submission) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/academic/evaluations/${assignmentId}/grading`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold">Soumission indisponible</h2>
            <p className="text-muted-foreground">
              Impossible de charger les d&eacute;tails de cette copie pour le moment.
            </p>
          </div>
        </div>

        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage || "Les donn&eacute;es de la soumission sont introuvables ou incompl&egrave;tes."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isEvaluation = assignment.type === 'evaluation';
  const isHomework = assignment.type === 'homework';
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/academic/evaluations/${assignmentId}/grading`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold">Correction - {submission.student_name}</h2>
            <p className="text-muted-foreground">
              {assignment.title}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEvaluation && submission.status === 'submitted' && (
            <Button 
              variant="outline"
              onClick={handleAutoGrade}
              disabled={autoGradeMutation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Correction auto
            </Button>
          )}
          <Button 
            onClick={handleSaveGrade}
            disabled={gradeSubmissionMutation.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            Sauvegarder
          </Button>
        </div>
      </div>

      {/* Student Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Informations étudiant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm font-medium">Nom</p>
              <p className="text-sm text-muted-foreground">{submission.student_name}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Email</p>
              <p className="text-sm text-muted-foreground">{submission.student_email}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Numéro étudiant</p>
              <p className="text-sm text-muted-foreground">{submission.student_number}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Tentative</p>
              <p className="text-sm text-muted-foreground">{submission.attempt_number}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submission Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Informations de soumission
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm font-medium">Statut</p>
              <Badge variant={submission.status === 'graded' ? 'default' : 'secondary'}>
                {submission.status === 'graded' ? 'Corrigé' : 
                 submission.status === 'submitted' ? 'Soumis' : 'En cours'}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium">Date de soumission</p>
              <p className="text-sm text-muted-foreground">
                {submission.submitted_at && format(new Date(submission.submitted_at), "PPP à HH:mm", { locale: fr })}
              </p>
            </div>
            {isEvaluation && (
              <div>
                <p className="text-sm font-medium">Temps passé</p>
                <p className="text-sm text-muted-foreground">
                  {formatTime(submission.time_spent_seconds)}
                </p>
              </div>
            )}
            {submission.is_late && (
              <div>
                <p className="text-sm font-medium">Retard</p>
                <Badge variant="destructive">En retard</Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Homework File */}
      {isHomework && submission.submitted_file_url && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Fichier soumis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{submission.submitted_file_name}</p>
                <p className="text-sm text-muted-foreground">
                  {submission.submitted_file_size_mb?.toFixed(2)}MB
                </p>
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    if (!submission.submitted_file_url) return;

                    // Extract tenant ID from the URL
                    const urlParts = submission.submitted_file_url.split('/');
                    const tenantIdFromUrl = urlParts[4]; // /api/v1/files/{tenantId}/...

                    // Create a proper download request with authentication headers
                    const response = await fetch(`http://localhost:4000${submission.submitted_file_url}`, {
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
                    link.download = submission.submitted_file_name || 'fichier-soumis.pdf';
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
                Télécharger
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Evaluation Questions */}
      {isEvaluation && questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Réponses aux questions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {questions.map((question, index) => {
                const result = getQuestionResult(question.id);
                if (!result) return null;

                const { answer, isCorrect } = result;

                return (
                  <div key={question.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Question {index + 1}</span>
                        {isCorrect ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {question.points} point{question.points > 1 ? 's' : ''}
                      </span>
                    </div>

                    <p className="font-medium mb-3">{question.question_text}</p>

                    {/* Show options for choice questions */}
                    {(question.type === 'single_choice' || question.type === 'multiple_choice') && question.options && (
                      <div className="space-y-2">
                        {question.options.map((option, optionIndex) => {
                          const isUserAnswer = question.type === 'single_choice' 
                            ? answer === optionIndex
                            : Array.isArray(answer) && answer.includes(optionIndex);
                          
                          const isCorrectAnswer = question.type === 'single_choice'
                            ? question.correct_answer === optionIndex
                            : Array.isArray(question.correct_answer) && question.correct_answer.includes(optionIndex);

                          return (
                            <div 
                              key={optionIndex} 
                              className={`p-2 rounded border ${
                                isCorrectAnswer ? 'bg-green-50 border-green-200' :
                                isUserAnswer && !isCorrectAnswer ? 'bg-red-50 border-red-200' :
                                'bg-gray-50 border-gray-200'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {isCorrectAnswer && <CheckCircle className="h-4 w-4 text-green-600" />}
                                {isUserAnswer && !isCorrectAnswer && <XCircle className="h-4 w-4 text-red-600" />}
                                <span className={`${
                                  isCorrectAnswer ? 'text-green-800 font-medium' :
                                  isUserAnswer && !isCorrectAnswer ? 'text-red-800' :
                                  'text-gray-700'
                                }`}>
                                  {String.fromCharCode(65 + optionIndex)}. {option}
                                </span>
                                {isUserAnswer && (
                                  <Badge variant="outline" className="ml-auto">
                                    Réponse étudiant
                                  </Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Show text answers */}
                    {(question.type === 'short_text' || question.type === 'fill_blank') && (
                      <div className="space-y-2">
                        <div>
                          <p className="text-sm font-medium">Réponse de l'étudiant:</p>
                          <div className="bg-gray-50 p-2 rounded border">
                            {answer || <span className="text-muted-foreground">Aucune réponse</span>}
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium">Réponse attendue:</p>
                          <div className="bg-green-50 p-2 rounded border border-green-200">
                            {String(question.correct_answer)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grading */}
      <Card>
        <CardHeader>
          <CardTitle>Notation et commentaires</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current scores */}
          {(submission.auto_score !== null || submission.manual_score !== null) && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                {submission.auto_score !== null && (
                  <span>Note automatique: {submission.auto_score}/20</span>
                )}
                {submission.auto_score !== null && submission.manual_score !== null && " • "}
                {submission.manual_score !== null && (
                  <span>Note manuelle: {submission.manual_score}/20</span>
                )}
                {submission.final_score !== null && (
                  <span> • Note finale: {submission.final_score}/20</span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Manual score input */}
          <div className="space-y-2">
            <Label htmlFor="manual_score">Note manuelle (sur 20)</Label>
            <Input
              id="manual_score"
              type="number"
              min="0"
              max="20"
              step="0.5"
              value={manualScore}
              onChange={(e) => setManualScore(e.target.value === "" ? "" : parseFloat(e.target.value))}
              placeholder="Saisissez la note..."
              className="w-32"
            />
          </div>

          {/* Feedback */}
          <div className="space-y-2">
            <Label htmlFor="feedback">Commentaires</Label>
            <Textarea
              id="feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Ajoutez vos commentaires pour l'étudiant..."
              rows={4}
            />
          </div>

          {/* Grading info */}
          {submission.graded_at && (
            <div className="text-sm text-muted-foreground">
              Dernière correction: {format(new Date(submission.graded_at), "PPP à HH:mm", { locale: fr })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
