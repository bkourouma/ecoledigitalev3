"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  Eye,
  Send,
  Loader2,
} from "lucide-react";
import { useReviewSubmission, useFinalizeSubmission } from "@/lib/hooks/use-student-data";

interface SubmissionReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignmentId: string;
  submissionId: string;
  onSubmissionFinalized: () => void;
}

interface ReviewData {
  submission_id: string;
  assignment_title: string;
  assignment_type: string;
  has_file: boolean;
  file_name?: string;
  file_size_mb?: number;
  has_answers: boolean;
  answers_count: number;
  time_spent_seconds?: number;
  deadline: string;
  is_late: boolean;
  can_submit: boolean;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export default function SubmissionReviewModal({
  isOpen,
  onClose,
  assignmentId,
  submissionId,
  onSubmissionFinalized,
}: SubmissionReviewModalProps) {
  const router = useRouter();
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  
  const reviewSubmissionMutation = useReviewSubmission();
  const finalizeSubmissionMutation = useFinalizeSubmission();

  // Validation function
  const validateSubmission = (data: ReviewData): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if assignment type matches submission content
    if (data.assignment_type === 'homework' && !data.has_file) {
      errors.push('Un fichier PDF est requis pour ce devoir');
    }

    if (data.assignment_type === 'evaluation' && !data.has_answers) {
      errors.push('Des réponses aux questions sont requises pour cette évaluation');
    }

    // Check file size if file exists
    if (data.has_file && data.file_size_mb && data.file_size_mb > 10) {
      warnings.push('Le fichier est assez volumineux (>10MB). Assurez-vous qu\'il se télécharge correctement.');
    }

    // Check if very little time was spent (potential issue)
    if (data.time_spent_seconds && data.time_spent_seconds < 60) {
      warnings.push('Très peu de temps passé sur cette évaluation. Assurez-vous d\'avoir terminé toutes les questions.');
    }

    // Check if submission is late
    if (data.is_late) {
      warnings.push('Cette soumission est en retard. Vérifiez si les soumissions tardives sont autorisées.');
    }

    // Check if no content at all
    if (!data.has_file && !data.has_answers) {
      errors.push('Aucun contenu soumis. Veuillez ajouter des réponses ou un fichier.');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  };

  const handleReview = async () => {
    setIsReviewing(true);
    try {
      const result = await reviewSubmissionMutation.mutateAsync({
        assignmentId,
        submissionId,
      });
      
      if (result.success && result.review_data) {
        setReviewData(result.review_data);
        // Validate the submission data
        const validation = validateSubmission(result.review_data);
        setValidationResult(validation);
      }
    } catch (error) {
      console.error('Error reviewing submission:', error);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleFinalize = async () => {
    try {
      const result = await finalizeSubmissionMutation.mutateAsync({
        assignmentId,
        submissionId,
      });
      
      if (result.success) {
        onSubmissionFinalized();
        onClose();
        // Rediriger vers la page des devoirs après la soumission réussie
        router.push('/student/assignments');
      }
    } catch (error) {
      console.error('Error finalizing submission:', error);
    }
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const formatFileSize = (mb: number): string => {
    if (mb < 1) {
      return `${(mb * 1024).toFixed(0)} KB`;
    }
    return `${mb.toFixed(2)} MB`;
  };

  React.useEffect(() => {
    if (isOpen && !reviewData) {
      handleReview();
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      setReviewData(null);
      setValidationResult(null);
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Révision avant soumission
          </DialogTitle>
          <DialogDescription>
            Vérifiez votre soumission avant l'envoi final. Une fois soumise, vous ne pourrez plus la modifier.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isReviewing && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              <span className="ml-2">Chargement des données de révision...</span>
            </div>
          )}

          {reviewData && (
            <>
              {/* Assignment Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{reviewData.assignment_title}</CardTitle>
                  <CardDescription>
                    Type: {reviewData.assignment_type === 'evaluation' ? 'Évaluation en ligne' : 'Devoir PDF'}
                  </CardDescription>
                </CardHeader>
              </Card>

              {/* Deadline Warning */}
              {reviewData.is_late && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Cette soumission est en retard. La date limite était le {new Date(reviewData.deadline).toLocaleDateString('fr-FR')}.
                  </AlertDescription>
                </Alert>
              )}

              {/* Submission Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Résumé de la soumission</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* File Upload Summary */}
                  {reviewData.has_file && (
                    <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                      <div className="p-2 bg-green-100 rounded-lg">
                        <FileText className="h-4 w-4 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-green-900">
                          {reviewData.file_name}
                        </p>
                        <p className="text-sm text-green-600">
                          {reviewData.file_size_mb && formatFileSize(reviewData.file_size_mb)}
                        </p>
                      </div>
                      <Badge variant="secondary" className="bg-green-100 text-green-700">
                        Fichier téléchargé
                      </Badge>
                    </div>
                  )}

                  {/* Answers Summary */}
                  {reviewData.has_answers && (
                    <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <CheckCircle className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-blue-900">
                          Réponses aux questions
                        </p>
                        <p className="text-sm text-blue-600">
                          {reviewData.answers_count} question{reviewData.answers_count > 1 ? 's' : ''} répondue{reviewData.answers_count > 1 ? 's' : ''}
                        </p>
                      </div>
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                        {reviewData.answers_count} réponses
                      </Badge>
                    </div>
                  )}

                  {/* Time Spent */}
                  {reviewData.time_spent_seconds && (
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        <Clock className="h-4 w-4 text-gray-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">
                          Temps passé
                        </p>
                        <p className="text-sm text-gray-600">
                          {formatTime(reviewData.time_spent_seconds)}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Validation Status */}
                  <div className="pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Statut de validation</span>
                      <Badge 
                        variant={validationResult?.isValid ? "default" : "destructive"}
                        className={validationResult?.isValid ? "bg-green-100 text-green-700" : ""}
                      >
                        {validationResult?.isValid ? "Prêt à soumettre" : "Problèmes détectés"}
                      </Badge>
                    </div>
                  </div>

                  {/* Validation Errors */}
                  {validationResult && validationResult.errors.length > 0 && (
                    <div className="pt-4">
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          <div className="space-y-1">
                            <p className="font-medium">Erreurs de validation :</p>
                            <ul className="list-disc list-inside space-y-1">
                              {validationResult.errors.map((error, index) => (
                                <li key={index} className="text-sm">{error}</li>
                              ))}
                            </ul>
                          </div>
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}

                  {/* Validation Warnings */}
                  {validationResult && validationResult.warnings.length > 0 && (
                    <div className="pt-4">
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          <div className="space-y-1">
                            <p className="font-medium">Avertissements :</p>
                            <ul className="list-disc list-inside space-y-1">
                              {validationResult.warnings.map((warning, index) => (
                                <li key={index} className="text-sm">{warning}</li>
                              ))}
                            </ul>
                          </div>
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Final Warning */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Attention :</strong> Une fois soumise, cette évaluation ne pourra plus être modifiée. 
                  Assurez-vous d'avoir terminé toutes les questions et téléchargé tous les fichiers nécessaires.
                </AlertDescription>
              </Alert>
            </>
          )}

          {reviewSubmissionMutation.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {reviewSubmissionMutation.error.message}
              </AlertDescription>
            </Alert>
          )}

          {finalizeSubmissionMutation.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {finalizeSubmissionMutation.error.message}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={finalizeSubmissionMutation.isPending}>
            Annuler
          </Button>
          
          {validationResult?.isValid && (
            <Button 
              onClick={handleFinalize}
              disabled={finalizeSubmissionMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {finalizeSubmissionMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Soumission en cours...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Soumettre définitivement
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
