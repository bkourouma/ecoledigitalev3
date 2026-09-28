"use client";

import { Card, CardContent, CardHeader, CardTitle, Button, Label, Input, Textarea } from "@ecoledigitale/ui";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Clock, AlertTriangle, CheckCircle, Save, Send } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAssignment, useQuestions, useSubmission, useCreateSubmission, useUpdateSubmission, useSubmitAssignment, type EvaluationQuestion } from "@/lib/hooks/use-evaluations";

export default function TakeEvaluationPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;

  const { data: assignment } = useAssignment(assignmentId);
  const { data: questionsData } = useQuestions(assignmentId);
  const { data: submission } = useSubmission(assignmentId);
  
  const createSubmissionMutation = useCreateSubmission();
  const updateSubmissionMutation = useUpdateSubmission();
  const submitAssignmentMutation = useSubmitAssignment();

  const questions = questionsData?.questions || [];
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  // Initialize timer
  useEffect(() => {
    if (assignment?.duration_minutes && !submission) {
      setTimeLeft(assignment.duration_minutes * 60); // Convert to seconds
    } else if (submission && assignment?.duration_minutes) {
      // Calculate remaining time based on submission start time
      const startTime = new Date(submission.created_at).getTime();
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      const remaining = (assignment.duration_minutes * 60) - elapsed;
      setTimeLeft(Math.max(0, remaining));
    }
  }, [assignment, submission]);

  // Timer countdown
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          // Auto-submit when time runs out
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // Load existing answers
  useEffect(() => {
    if (submission?.answers) {
      setAnswers(submission.answers);
    }
  }, [submission]);

  // Auto-save answers
  const autoSave = useCallback(async () => {
    if (!submission || Object.keys(answers).length === 0) return;

    setAutoSaveStatus('saving');
    try {
      await updateSubmissionMutation.mutateAsync({
        assignmentId,
        submissionId: submission.id,
        data: {
          answers,
          time_spent_seconds: assignment?.duration_minutes ? 
            (assignment.duration_minutes * 60) - (timeLeft || 0) : undefined
        }
      });
      setAutoSaveStatus('saved');
    } catch (error) {
      setAutoSaveStatus('error');
    }
  }, [answers, submission, assignmentId, timeLeft, assignment?.duration_minutes, updateSubmissionMutation]);

  // Auto-save every 30 seconds
  useEffect(() => {
    const interval = setInterval(autoSave, 30000);
    return () => clearInterval(interval);
  }, [autoSave]);

  const handleAnswerChange = (questionId: string, answer: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const handleStartEvaluation = async () => {
    try {
      await createSubmissionMutation.mutateAsync({
        assignment_id: assignmentId,
        answers: {},
        time_spent_seconds: 0
      });
    } catch (error) {
      alert('Erreur lors du démarrage: ' + String(error));
    }
  };

  const handleSubmit = async () => {
    if (!submission) return;

    setIsSubmitting(true);
    try {
      // Save final answers
      await updateSubmissionMutation.mutateAsync({
        assignmentId,
        submissionId: submission.id,
        data: {
          answers,
          time_spent_seconds: assignment?.duration_minutes ? 
            (assignment.duration_minutes * 60) - (timeLeft || 0) : undefined
        }
      });

      // Submit the assignment
      await submitAssignmentMutation.mutateAsync({
        assignmentId,
        submissionId: submission.id
      });

      router.push(`/evaluations/${assignmentId}/result`);
    } catch (error) {
      alert('Erreur lors de la soumission: ' + String(error));
      setIsSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getProgress = () => {
    const answeredQuestions = Object.keys(answers).length;
    return (answeredQuestions / questions.length) * 100;
  };

  const renderQuestion = (question: EvaluationQuestion) => {
    const answer = answers[question.id];

    switch (question.type) {
      case 'single_choice':
        return (
          <RadioGroup
            value={answer?.toString() || ""}
            onValueChange={(value) => handleAnswerChange(question.id, parseInt(value))}
          >
            {question.options?.map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <RadioGroupItem value={index.toString()} id={`${question.id}-${index}`} />
                <Label htmlFor={`${question.id}-${index}`} className="flex-1 cursor-pointer">
                  {String.fromCharCode(65 + index)}. {option}
                </Label>
              </div>
            ))}
          </RadioGroup>
        );

      case 'multiple_choice':
        return (
          <div className="space-y-2">
            {question.options?.map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <Checkbox
                  id={`${question.id}-${index}`}
                  checked={Array.isArray(answer) && answer.includes(index)}
                  onCheckedChange={(checked) => {
                    const currentAnswers = Array.isArray(answer) ? answer : [];
                    if (checked) {
                      handleAnswerChange(question.id, [...currentAnswers, index]);
                    } else {
                      handleAnswerChange(question.id, currentAnswers.filter(i => i !== index));
                    }
                  }}
                />
                <Label htmlFor={`${question.id}-${index}`} className="flex-1 cursor-pointer">
                  {String.fromCharCode(65 + index)}. {option}
                </Label>
              </div>
            ))}
          </div>
        );

      case 'true_false':
        return (
          <RadioGroup
            value={answer?.toString() || ""}
            onValueChange={(value) => handleAnswerChange(question.id, value === 'true')}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="true" id={`${question.id}-true`} />
              <Label htmlFor={`${question.id}-true`} className="cursor-pointer">Vrai</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="false" id={`${question.id}-false`} />
              <Label htmlFor={`${question.id}-false`} className="cursor-pointer">Faux</Label>
            </div>
          </RadioGroup>
        );

      case 'short_text':
        return (
          <Input
            value={answer || ""}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            placeholder="Votre réponse..."
            className="w-full"
          />
        );

      case 'fill_blank':
        return (
          <Textarea
            value={answer || ""}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            placeholder="Complétez le texte..."
            rows={3}
            className="w-full"
          />
        );

      default:
        return <p>Type de question non supporté</p>;
    }
  };

  if (!assignment || !questions.length) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Chargement...</h2>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">Préparation de l'évaluation</p>
        </div>
      </div>
    );
  }

  // If no submission exists, show start screen
  if (!submission) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">{assignment.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium">Durée</p>
                  <p className="text-muted-foreground">{assignment.duration_minutes} minutes</p>
                </div>
                <div>
                  <p className="font-medium">Questions</p>
                  <p className="text-muted-foreground">{questions.length} questions</p>
                </div>
                <div>
                  <p className="font-medium">Tentatives</p>
                  <p className="text-muted-foreground">{assignment.max_attempts}</p>
                </div>
                <div>
                  <p className="font-medium">Questions mélangées</p>
                  <p className="text-muted-foreground">{assignment.shuffle_questions ? 'Oui' : 'Non'}</p>
                </div>
              </div>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Une fois commencée, l'évaluation ne peut pas être interrompue. 
                  Assurez-vous d'avoir une connexion internet stable.
                </AlertDescription>
              </Alert>

              <Button 
                onClick={handleStartEvaluation} 
                disabled={createSubmissionMutation.isPending}
                size="lg"
              >
                {createSubmissionMutation.isPending ? 'Démarrage...' : 'Commencer l\'évaluation'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header with timer and progress */}
      <div className="mb-6 space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">{assignment.title}</h1>
          {timeLeft !== null && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span className={`font-mono text-lg ${timeLeft < 300 ? 'text-red-600' : ''}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Question {currentQuestionIndex + 1} sur {questions.length}</span>
            <span>{Math.round(getProgress())}% complété</span>
          </div>
          <Progress value={getProgress()} className="w-full" />
        </div>

        {/* Auto-save status */}
        <div className="flex justify-between items-center text-sm">
          <div className="flex items-center gap-2">
            {autoSaveStatus === 'saved' && <CheckCircle className="h-4 w-4 text-green-600" />}
            {autoSaveStatus === 'saving' && <Clock className="h-4 w-4 text-blue-600" />}
            {autoSaveStatus === 'error' && <AlertTriangle className="h-4 w-4 text-red-600" />}
            <span className="text-muted-foreground">
              {autoSaveStatus === 'saved' && 'Sauvegardé automatiquement'}
              {autoSaveStatus === 'saving' && 'Sauvegarde en cours...'}
              {autoSaveStatus === 'error' && 'Erreur de sauvegarde'}
            </span>
          </div>
        </div>
      </div>

      {/* Question */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex justify-between items-start">
            <CardTitle className="text-lg">
              Question {currentQuestionIndex + 1}
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              {currentQuestion.points} point{currentQuestion.points > 1 ? 's' : ''}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-lg">{currentQuestion.question_text}</p>
          {renderQuestion(currentQuestion)}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <Button
          variant="outline"
          onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
          disabled={currentQuestionIndex === 0}
        >
          Question précédente
        </Button>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={autoSave}
            disabled={autoSaveStatus === 'saving'}
          >
            <Save className="h-4 w-4 mr-2" />
            Sauvegarder
          </Button>

          {isLastQuestion ? (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              <Send className="h-4 w-4 mr-2" />
              {isSubmitting ? 'Soumission...' : 'Terminer l\'évaluation'}
            </Button>
          ) : (
            <Button
              onClick={() => setCurrentQuestionIndex(prev => Math.min(questions.length - 1, prev + 1))}
            >
              Question suivante
            </Button>
          )}
        </div>
      </div>

      {/* Question navigation */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-sm">Navigation rapide</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-10 gap-2">
            {questions.map((_, index) => (
              <Button
                key={index}
                variant={index === currentQuestionIndex ? "default" : "outline"}
                size="sm"
                onClick={() => setCurrentQuestionIndex(index)}
                className={`w-10 h-10 ${answers[questions[index].id] ? 'bg-green-100 border-green-300' : ''}`}
              >
                {index + 1}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
