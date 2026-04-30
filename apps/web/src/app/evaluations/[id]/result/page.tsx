"use client";

import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, CheckCircle, XCircle, Clock, Trophy, RotateCcw } from "lucide-react";
import { useParams } from "next/navigation";
import { useAssignment, useQuestions, useSubmission } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function EvaluationResultPage() {
  const params = useParams();
  const assignmentId = params.id as string;

  const { data: assignment } = useAssignment(assignmentId);
  const { data: questionsData } = useQuestions(assignmentId);
  const { data: submission } = useSubmission(assignmentId);

  const questions = questionsData?.questions || [];

  if (!assignment || !submission) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Chargement...</h2>
          <p className="text-muted-foreground">Chargement des résultats</p>
        </div>
      </div>
    );
  }

  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
  const score = submission.final_score || submission.auto_score || 0;
  const percentage = totalPoints > 0 ? (score / totalPoints) * 100 : 0;

  const getScoreColor = (percentage: number) => {
    if (percentage >= 80) return "text-green-600";
    if (percentage >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBadge = (percentage: number) => {
    if (percentage >= 80) return { variant: "default" as const, label: "Excellent" };
    if (percentage >= 60) return { variant: "secondary" as const, label: "Bien" };
    if (percentage >= 40) return { variant: "outline" as const, label: "Passable" };
    return { variant: "destructive" as const, label: "Insuffisant" };
  };

  const canRetake = submission.attempt_number < assignment.max_attempts;
  const showResults = assignment.show_results_mode === 'immediate' || 
                     (assignment.show_results_mode === 'after_end' && new Date() > new Date(assignment.ends_at)) ||
                     (assignment.show_results_mode === 'after_correction' && submission.status === 'graded');

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getQuestionResult = (questionId: string) => {
    const question = questions.find(q => q.id === questionId);
    const answer = submission.answers?.[questionId];
    
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
        // For text questions, we'd need AI scoring or manual review
        isCorrect = false; // Placeholder
        break;
    }

    return { question, answer, isCorrect };
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/evaluations">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold">{assignment.title}</h2>
          <p className="text-muted-foreground">Résultats de l'évaluation</p>
        </div>
      </div>

      {/* Results not available yet */}
      {!showResults && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertDescription>
            Les résultats ne sont pas encore disponibles. 
            {assignment.show_results_mode === 'after_end' && 
              ` Ils seront affichés après la fin de l'évaluation le ${format(new Date(assignment.ends_at), "PPP à HH:mm", { locale: fr })}.`
            }
            {assignment.show_results_mode === 'after_correction' && 
              " Ils seront affichés après correction par l'enseignant."
            }
          </AlertDescription>
        </Alert>
      )}

      {/* Score Overview */}
      {showResults && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Votre résultat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center space-y-4">
              <div className="space-y-2">
                <div className={`text-4xl font-bold ${getScoreColor(percentage)}`}>
                  {score.toFixed(1)}/{totalPoints}
                </div>
                <div className="text-2xl text-muted-foreground">
                  {percentage.toFixed(1)}%
                </div>
                <Badge {...getScoreBadge(percentage)}>
                  {getScoreBadge(percentage).label}
                </Badge>
              </div>

              <Progress value={percentage} className="w-full max-w-md mx-auto" />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="font-medium">Tentative</p>
                  <p className="text-muted-foreground">{submission.attempt_number} / {assignment.max_attempts}</p>
                </div>
                {submission.time_spent_seconds && (
                  <div>
                    <p className="font-medium">Temps passé</p>
                    <p className="text-muted-foreground">{formatTime(submission.time_spent_seconds)}</p>
                  </div>
                )}
                <div>
                  <p className="font-medium">Soumis le</p>
                  <p className="text-muted-foreground">
                    {submission.submitted_at && format(new Date(submission.submitted_at), "PPP à HH:mm", { locale: fr })}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Question-by-question results */}
      {showResults && questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Détail des réponses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {questions.map((question, index) => {
                const result = getQuestionResult(question.id);
                if (!result) return null;

                const { answer, isCorrect } = result;

                return (
                  <div key={question.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
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
                                    Votre réponse
                                  </Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Show true/false results */}
                    {question.type === 'true_false' && (
                      <div className="space-y-2">
                        <div className={`p-2 rounded border ${
                          question.correct_answer === true ? 'bg-green-50 border-green-200' :
                          answer === true ? 'bg-red-50 border-red-200' :
                          'bg-gray-50 border-gray-200'
                        }`}>
                          <div className="flex items-center gap-2">
                            {question.correct_answer === true && <CheckCircle className="h-4 w-4 text-green-600" />}
                            {answer === true && question.correct_answer !== true && <XCircle className="h-4 w-4 text-red-600" />}
                            <span>Vrai</span>
                            {answer === true && (
                              <Badge variant="outline" className="ml-auto">Votre réponse</Badge>
                            )}
                          </div>
                        </div>
                        <div className={`p-2 rounded border ${
                          question.correct_answer === false ? 'bg-green-50 border-green-200' :
                          answer === false ? 'bg-red-50 border-red-200' :
                          'bg-gray-50 border-gray-200'
                        }`}>
                          <div className="flex items-center gap-2">
                            {question.correct_answer === false && <CheckCircle className="h-4 w-4 text-green-600" />}
                            {answer === false && question.correct_answer !== false && <XCircle className="h-4 w-4 text-red-600" />}
                            <span>Faux</span>
                            {answer === false && (
                              <Badge variant="outline" className="ml-auto">Votre réponse</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Show text answers */}
                    {(question.type === 'short_text' || question.type === 'fill_blank') && (
                      <div className="space-y-2">
                        <div>
                          <p className="text-sm font-medium">Votre réponse:</p>
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

      {/* Feedback */}
      {submission.feedback && (
        <Card>
          <CardHeader>
            <CardTitle>Commentaires de l'enseignant</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-4 rounded-md">
              {submission.feedback}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <Link href="/evaluations">
          <Button variant="outline">Retour à la liste</Button>
        </Link>
        
        {canRetake && showResults && (
          <Link href={`/evaluations/${assignmentId}`}>
            <Button>
              <RotateCcw className="h-4 w-4 mr-2" />
              Nouvelle tentative
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
