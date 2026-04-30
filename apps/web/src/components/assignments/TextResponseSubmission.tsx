"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Textarea,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  FileText,
  Save,
  CheckCircle,
  AlertCircle,
  Loader2,
  Clock,
  Edit,
} from "lucide-react";
import { useCreateSubmission, useUpdateSubmission, useSubmitAssignment, useMySubmission } from "@/lib/hooks/use-student-data";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { parseError, validateTextResponse, checkAssignmentDeadline, withRetry, logError, AssignmentError } from "@/lib/utils/error-handling";

interface TextResponseSubmissionProps {
  assignmentId: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
  dueDate?: string;
  allowLateSubmissions?: boolean;
  onSubmissionChange?: (submission: any) => void;
}

export default function TextResponseSubmission({
  assignmentId,
  placeholder = "Saisissez votre réponse ici...",
  minLength = 10,
  maxLength = 5000,
  disabled = false,
  dueDate,
  allowLateSubmissions = false,
  onSubmissionChange,
}: TextResponseSubmissionProps) {
  const router = useRouter();
  const [textContent, setTextContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<AssignmentError | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Hooks
  const { data: submission, isLoading: submissionLoading } = useMySubmission(assignmentId);
  const createSubmissionMutation = useCreateSubmission();
  const updateSubmissionMutation = useUpdateSubmission();
  const submitAssignmentMutation = useSubmitAssignment();

  // Debounced text content for auto-save
  const debouncedTextContent = useDebounce(textContent, 2000); // 2 second delay

  // Initialize text content from existing submission
  useEffect(() => {
    if (submission?.answers?.text_content) {
      setTextContent(submission.answers.text_content);
    }
  }, [submission]);

  // Auto-save functionality
  const autoSave = useCallback(async (content: string) => {
    if (!content.trim() || content.length < minLength) return;
    if (submission?.status === 'submitted' || submission?.status === 'graded') return;

    // Check assignment deadline before saving
    if (dueDate) {
      const deadlineError = checkAssignmentDeadline(dueDate, allowLateSubmissions);
      if (deadlineError) {
        setSaveError(deadlineError);
        logError(deadlineError, { assignmentId, dueDate });
        return;
      }
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const submissionData = {
        answers: { text_content: content },
      };

      if (submission) {
        // Update existing submission
        await withRetry(
          () => updateSubmissionMutation.mutateAsync({
            assignmentId,
            submissionId: submission.id,
            data: submissionData,
          }),
          2,
          1000
        );
      } else {
        // Create new submission
        await withRetry(
          () => createSubmissionMutation.mutateAsync({
            assignment_id: assignmentId,
            ...submissionData,
          }),
          2,
          1000
        );
      }
      setLastSaved(new Date());
    } catch (error) {
      const parsedError = parseError(error);
      setSaveError(parsedError);
      logError(parsedError, {
        assignmentId,
        textLength: content.length,
        action: 'auto-save'
      });
    } finally {
      setIsSaving(false);
    }
  }, [assignmentId, submission, minLength, dueDate, allowLateSubmissions, createSubmissionMutation, updateSubmissionMutation]);

  // Trigger auto-save when debounced content changes
  useEffect(() => {
    if (debouncedTextContent && debouncedTextContent !== submission?.answers?.text_content) {
      autoSave(debouncedTextContent);
    }
  }, [debouncedTextContent, autoSave, submission?.answers?.text_content]);

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (disabled || submission?.status === 'submitted' || submission?.status === 'graded') return;
    setTextContent(event.target.value);
  };

  const handleManualSave = async () => {
    await autoSave(textContent);
  };

  const handleSubmit = async () => {
    if (!submission) {
      const error = parseError(new Error('No submission found'));
      setSaveError(error);
      return;
    }

    // Validate text content
    const validationError = validateTextResponse(textContent, minLength, maxLength);
    if (validationError) {
      setSaveError(validationError);
      logError(validationError, { assignmentId, textLength: textContent.length });
      return;
    }

    // Check assignment deadline
    if (dueDate) {
      const deadlineError = checkAssignmentDeadline(dueDate, allowLateSubmissions);
      if (deadlineError) {
        setSaveError(deadlineError);
        logError(deadlineError, { assignmentId, dueDate });
        return;
      }
    }

    try {
      // Save current content first
      await autoSave(textContent);

      // Then submit
      await withRetry(
        () => submitAssignmentMutation.mutateAsync({
          assignmentId,
          submissionId: submission.id,
        }),
        2,
        1000
      );
      onSubmissionChange?.(submission);
      
      // Rediriger vers la page des devoirs après la soumission réussie
      setTimeout(() => {
        router.push('/student/assignments');
      }, 1500); // Petit délai pour laisser le temps de voir le message de succès
    } catch (error) {
      const parsedError = parseError(error);
      setSaveError(parsedError);
      logError(parsedError, {
        assignmentId,
        submissionId: submission.id,
        textLength: textContent.length,
        action: 'submit'
      });
    }
  };

  const isSubmitted = submission?.status === 'submitted' || submission?.status === 'graded';
  const canEdit = !disabled && !isSubmitted;
  const wordCount = textContent.trim().split(/\s+/).filter(word => word.length > 0).length;
  const charCount = textContent.length;

  if (submissionLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <span className="ml-2">Chargement...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-emerald-600" />
          Réponse textuelle
        </CardTitle>
        <CardDescription>
          Rédigez votre réponse dans la zone de texte ci-dessous. 
          {minLength > 0 && ` Minimum ${minLength} caractères.`}
          {maxLength > 0 && ` Maximum ${maxLength} caractères.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Text area */}
        <div className="space-y-2">
          <Textarea
            value={textContent}
            onChange={handleTextChange}
            placeholder={placeholder}
            disabled={disabled || isSubmitted}
            className={`min-h-[300px] resize-y ${
              isSubmitted ? 'bg-gray-50' : ''
            }`}
            maxLength={maxLength}
          />
          
          {/* Character and word count */}
          <div className="flex justify-between items-center text-sm text-gray-600">
            <div className="flex items-center gap-4">
              <span>{wordCount} mots</span>
              <span className={charCount > maxLength ? 'text-red-600' : ''}>
                {charCount}/{maxLength} caractères
              </span>
            </div>
            
            {/* Save status */}
            <div className="flex items-center gap-2">
              {isSaving && (
                <div className="flex items-center gap-1 text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-xs">Sauvegarde...</span>
                </div>
              )}
              {lastSaved && !isSaving && (
                <div className="flex items-center gap-1 text-green-600">
                  <CheckCircle className="h-3 w-3" />
                  <span className="text-xs">
                    Sauvegardé à {lastSaved.toLocaleTimeString('fr-FR', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Manual save button */}
        {canEdit && textContent.trim() && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={handleManualSave}
              disabled={isSaving || createSubmissionMutation.isPending || updateSubmissionMutation.isPending}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sauvegarde...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Sauvegarder maintenant
                </>
              )}
            </Button>
          </div>
        )}

        {/* Error display */}
        {saveError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p>{saveError.userMessage}</p>
                {saveError.retryable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSaveError(null);
                      if (textContent.trim()) {
                        autoSave(textContent);
                      }
                    }}
                  >
                    Réessayer
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Validation messages */}
        {textContent.length > 0 && textContent.length < minLength && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Votre réponse doit contenir au moins {minLength} caractères. 
              Il vous manque {minLength - textContent.length} caractères.
            </AlertDescription>
          </Alert>
        )}

        {/* Submit button */}
        {submission && textContent.length >= minLength && submission.status === 'in_progress' && (
          <div className="pt-4 border-t">
            <Button
              onClick={handleSubmit}
              disabled={submitAssignmentMutation.isPending || textContent.length < minLength}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              size="lg"
            >
              {submitAssignmentMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Soumission en cours...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Soumettre la réponse
                </>
              )}
            </Button>
          </div>
        )}

        {/* Status messages */}
        {isSubmitted && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              {submission?.status === 'submitted' 
                ? 'Votre réponse a été soumise avec succès et est en attente de correction.'
                : 'Votre réponse a été corrigée. Consultez l\'onglet Feedback pour voir vos résultats.'
              }
            </AlertDescription>
          </Alert>
        )}

        {/* Auto-save info */}
        {canEdit && (
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Sauvegarde automatique activée
          </div>
        )}
      </CardContent>
    </Card>
  );
}
