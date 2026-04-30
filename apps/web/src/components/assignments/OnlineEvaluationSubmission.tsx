"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Label,
  Checkbox,
  Input,
  Textarea,
  Progress,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Play,
  CheckCircle,
  AlertCircle,
  Loader2,
  Clock,
  ArrowLeft,
  ArrowRight,
  Save,
  Send,
} from "lucide-react";
import { useCreateSubmission, useUpdateSubmission, useSubmitAssignment, useMySubmission } from "@/lib/hooks/use-student-data";
import { useEvaluationQuestions } from "@/lib/hooks/use-evaluations";
import SubmissionReviewModal from "./SubmissionReviewModal";

interface Question {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_text' | 'fill_blank';
  question_text: string;
  options?: string[];
  points: number;
  order_index: number;
}

interface OnlineEvaluationSubmissionProps {
  assignmentId: string;
  assignmentInstanceId?: string; // optional instance ID when assignment is instantiated
  questions: Question[];
  timeLimit?: number; // in minutes
  disabled?: boolean;
  dueDate?: string;
  allowLateSubmissions?: boolean;
  onSubmissionChange?: (submission: any) => void;
}

export default function OnlineEvaluationSubmission({
  assignmentId,
  assignmentInstanceId,
  questions: propQuestions = [],
  timeLimit,
  disabled = false,
  dueDate,
  allowLateSubmissions = false,
  onSubmissionChange,
}: OnlineEvaluationSubmissionProps) {
  // Use instance ID for submissions if provided, otherwise use assignment ID
  const submissionAssignmentId = assignmentInstanceId || assignmentId;
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(timeLimit ? timeLimit * 60 : null);
  const [isStarted, setIsStarted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  // Hooks
  // Use submissionAssignmentId for fetching submission (backend resolves instance ID → template ID)
  const { data: submission, isLoading: submissionLoading } = useMySubmission(submissionAssignmentId);
  const { data: questionsData, isLoading: questionsLoading, error: questionsError } = useEvaluationQuestions(assignmentId, {
    enabled: propQuestions.length === 0 // Only fetch if no questions provided as props
  });
  const createSubmissionMutation = useCreateSubmission();
  const updateSubmissionMutation = useUpdateSubmission();
  const submitAssignmentMutation = useSubmitAssignment();

  // Use questions from API if available, otherwise use props
  const finalQuestions = questionsData?.questions || propQuestions;
  const assignmentInfo = questionsData?.assignment;
  const questionsMeta = questionsData?.meta;

  // Calculate isSubmitted early to avoid reference errors
  const isSubmitted = submission?.status === 'submitted' || submission?.status === 'graded';

  // Initialize answers from existing submission
  useEffect(() => {
    if (submission?.answers) {
      setAnswers(submission.answers);
      setIsStarted(true);
    }
  }, [submission]);

  // Save progress function - defined early to avoid TDZ errors
  const saveProgress = useCallback(async () => {
    if (!submission || submission.status !== 'in_progress') return;

    setIsSaving(true);
    setSaveError(null);

    try {
      await updateSubmissionMutation.mutateAsync({
        assignmentId: submissionAssignmentId,
        submissionId: submission.id,
        data: {
          answers,
          time_spent_seconds: timeLimit && timeLeft ? (timeLimit * 60) - timeLeft : undefined,
        },
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Erreur lors de la sauvegarde');
    } finally {
      setIsSaving(false);
    }
  }, [submissionAssignmentId, submission, answers, timeLimit, timeLeft, updateSubmissionMutation]);

  // Handle submit - defined early to avoid TDZ errors in timer effect
  const handleSubmit = useCallback(async () => {
    if (!submission) return;
    
    try {
      // Save final answers
      await saveProgress();
      
      // Show review modal
      setShowReviewModal(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Erreur lors de la sauvegarde');
    }
  }, [submission, saveProgress]);

  // Timer effect
  useEffect(() => {
    if (!isStarted || timeLeft === null || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          // Time's up - auto submit
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isStarted, timeLeft, handleSubmit]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!isStarted || isSubmitted) return;

    const interval = setInterval(() => {
      saveProgress();
    }, 30000);

    return () => clearInterval(interval);
  }, [isStarted, isSubmitted, saveProgress]);

  // Auto-save when answers change (debounced)
  useEffect(() => {
    if (!isStarted || isSubmitted || Object.keys(answers).length === 0) return;

    const timeoutId = setTimeout(() => {
      saveProgress();
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [answers, isStarted, isSubmitted, saveProgress]);

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStart = async () => {
    setIsStarted(true);
    
    // Create initial submission
    if (!submission) {
      try {
        await createSubmissionMutation.mutateAsync({
          assignment_id: submissionAssignmentId,  // Use instance ID for submission
          answers: {},
        });
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Erreur lors du démarrage');
      }
    }
  };

  const handleAnswerChange = (questionId: string, answer: any) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer,
    }));
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < finalQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handleQuestionNavigation = (index: number) => {
    if (index >= 0 && index < finalQuestions.length) {
      setCurrentQuestionIndex(index);
    }
  };

  const handleSubmissionFinalized = () => {
    if (onSubmissionChange) {
      onSubmissionChange(submission);
    }
  };

  const renderQuestion = (question: Question) => {
    const answer = answers[question.id];

    switch (question.type) {
      case 'single_choice':
        return (
          <RadioGroup
            value={answer || ''}
            onValueChange={(value) => handleAnswerChange(question.id, value)}
            disabled={disabled || submission?.status !== 'in_progress'}
          >
            {question.options?.map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <RadioGroupItem value={option} id={`${question.id}-${index}`} />
                <Label htmlFor={`${question.id}-${index}`}>{option}</Label>
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
                  checked={Array.isArray(answer) && answer.includes(option)}
                  onCheckedChange={(checked) => {
                    const currentAnswers = Array.isArray(answer) ? answer : [];
                    if (checked) {
                      handleAnswerChange(question.id, [...currentAnswers, option]);
                    } else {
                      handleAnswerChange(question.id, currentAnswers.filter(a => a !== option));
                    }
                  }}
                  disabled={disabled || submission?.status !== 'in_progress'}
                />
                <Label htmlFor={`${question.id}-${index}`}>{option}</Label>
              </div>
            ))}
          </div>
        );

      case 'true_false':
        return (
          <RadioGroup
            value={answer === true ? 'true' : answer === false ? 'false' : ''}
            onValueChange={(value) => handleAnswerChange(question.id, value === 'true')}
            disabled={disabled || submission?.status !== 'in_progress'}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="true" id={`${question.id}-true`} />
              <Label htmlFor={`${question.id}-true`}>Vrai</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="false" id={`${question.id}-false`} />
              <Label htmlFor={`${question.id}-false`}>Faux</Label>
            </div>
          </RadioGroup>
        );

      case 'short_text':
        return (
          <Input
            value={answer || ''}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            placeholder="Votre réponse..."
            disabled={disabled || submission?.status !== 'in_progress'}
          />
        );

      case 'fill_blank':
        return (
          <Textarea
            value={answer || ''}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            placeholder="Complétez votre réponse..."
            className="min-h-[100px]"
            disabled={disabled || submission?.status !== 'in_progress'}
          />
        );

      default:
        return <p className="text-gray-500">Type de question non supporté</p>;
    }
  };

  const currentQuestion = finalQuestions[currentQuestionIndex];
  const progress = finalQuestions.length > 0 ? ((currentQuestionIndex + 1) / finalQuestions.length) * 100 : 0;
  const answeredCount = Object.keys(answers).length;

  if (submissionLoading || questionsLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <span className="ml-2">Chargement de l'évaluation...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (questionsError) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Erreur de chargement
            </h3>
            <p className="text-gray-600 mb-4">
              {questionsError.message || 'Impossible de charger les questions de l\'évaluation.'}
            </p>
            <Button onClick={() => window.location.reload()}>
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isStarted && !isSubmitted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-emerald-600" />
            Évaluation en ligne
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            {assignmentInfo && (
              <div className="space-y-2">
                <div className="font-medium">{assignmentInfo.title}</div>
                <div className="text-sm text-gray-600">
                  {assignmentInfo.course_code} - {assignmentInfo.course_name}
                </div>
                <div className="text-sm">
                  {finalQuestions.length} questions • {questionsMeta?.total_points || 0} points
                  {timeLimit && ` • Temps limite: ${timeLimit} minutes`}
                </div>
              </div>
            )}
            {!assignmentInfo && (
              <>
                Cette évaluation contient {finalQuestions.length} questions.
                {timeLimit && ` Temps limite: ${timeLimit} minutes.`}
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center py-8">
            <Play className="h-16 w-16 text-emerald-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Prêt à commencer ?</h3>
            <p className="text-gray-600 mb-6">
              Une fois commencée, l'évaluation ne peut pas être mise en pause.
              {timeLimit && ` Vous aurez ${timeLimit} minutes pour la terminer.`}
            </p>
            <Button
              onClick={handleStart}
              disabled={createSubmissionMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
              size="lg"
            >
              {createSubmissionMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Démarrage...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Commencer l'évaluation
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (finalQuestions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Aucune question disponible
            </h3>
            <p className="text-gray-600">
              Cette évaluation ne contient pas encore de questions.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with timer and progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-sm text-gray-600">Question {currentQuestionIndex + 1} sur {finalQuestions.length}</p>
                <Progress value={progress} className="w-32 mt-1" />
              </div>
              <div className="text-sm text-gray-600">
                {answeredCount}/{finalQuestions.length} répondues
              </div>
            </div>
            
            {timeLeft !== null && (
              <div className={`flex items-center gap-2 ${timeLeft < 300 ? 'text-red-600' : 'text-gray-600'}`}>
                <Clock className="h-4 w-4" />
                <span className="font-mono text-lg">{formatTime(timeLeft)}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Current question */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Question {currentQuestionIndex + 1}</span>
            <span className="text-sm font-normal text-gray-600">{currentQuestion?.points} points</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-lg">{currentQuestion?.question_text}</div>
          
          {renderQuestion(currentQuestion)}

          {/* Question navigation dots */}
          <div className="flex items-center justify-center gap-2 pt-4 border-t">
            {finalQuestions.map((_: Question, index: number) => (
              <button
                key={index}
                onClick={() => handleQuestionNavigation(index)}
                className={`w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                  index === currentQuestionIndex
                    ? 'bg-emerald-600 text-white'
                    : answers[finalQuestions[index]?.id]
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                disabled={disabled || submission?.status !== 'in_progress'}
              >
                {index + 1}
              </button>
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between pt-4">
            <Button
              variant="outline"
              onClick={handlePreviousQuestion}
              disabled={currentQuestionIndex === 0 || disabled || submission?.status !== 'in_progress'}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Précédent
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={saveProgress}
                disabled={isSaving || updateSubmissionMutation.isPending || disabled || submission?.status !== 'in_progress'}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sauvegarde...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Sauvegarder
                  </>
                )}
              </Button>

              {currentQuestionIndex < finalQuestions.length - 1 ? (
                <Button
                  onClick={handleNextQuestion}
                  disabled={disabled || submission?.status !== 'in_progress'}
                >
                  Suivant
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={submitAssignmentMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {submitAssignmentMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Soumission...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Soumettre
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error display */}
      {saveError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {/* Status message for submitted evaluations */}
      {isSubmitted && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            {submission?.status === 'submitted' 
              ? 'Votre évaluation a été soumise avec succès et est en cours de correction.'
              : 'Votre évaluation a été corrigée. Consultez l\'onglet Feedback pour voir vos résultats.'
            }
          </AlertDescription>
        </Alert>
      )}

      {/* Review Modal */}
      {submission && (
        <SubmissionReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          assignmentId={assignmentId}
          submissionId={submission.id}
          onSubmissionFinalized={handleSubmissionFinalized}
        />
      )}
    </div>
  );
}
