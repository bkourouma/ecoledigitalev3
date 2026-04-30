"use client";

import React, { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Progress,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  Upload,
  File,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  Trash2,
} from "lucide-react";
import { useCreateSubmission, useUpdateSubmission, useSubmitAssignment, useMySubmission, useFinalizeSubmission } from "@/lib/hooks/use-student-data";
// import SubmissionReviewModal from "./SubmissionReviewModal"; // Removed - auto-submit instead
import { parseError, validateFile, checkAssignmentDeadline, withRetry, logError, AssignmentError } from "@/lib/utils/error-handling";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";

interface FileUploadSubmissionProps {
  assignmentId: string;
  maxFileSizeMB?: number;
  allowedFileTypes?: string[];
  disabled?: boolean;
  dueDate?: string;
  allowLateSubmissions?: boolean;
  onSubmissionChange?: (submission: any) => void;
  maxAttempts?: number;
  currentAttempts?: number;
}

export default function FileUploadSubmission({
  assignmentId,
  maxFileSizeMB = 10,
  allowedFileTypes = ['.pdf', '.doc', '.docx', '.txt', '.zip'],
  disabled = false,
  dueDate,
  allowLateSubmissions = false,
  onSubmissionChange,
  maxAttempts = 2,
  currentAttempts = 0,
}: FileUploadSubmissionProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<AssignmentError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  // const [showReviewModal, setShowReviewModal] = useState(false); // Removed - auto-submit instead

  // Hooks
  const { data: session } = useSession();
  const { data: submission, isLoading: submissionLoading, refetch: refetchSubmission } = useMySubmission(assignmentId);
  const createSubmissionMutation = useCreateSubmission();
  const updateSubmissionMutation = useUpdateSubmission();
  const finalizeSubmissionMutation = useFinalizeSubmission();
  // const submitAssignmentMutation = useSubmitAssignment(); // Not needed - using finalizeSubmissionMutation directly

  // File validation
  const validateFile = useCallback((file: File): string | null => {
    // Check file size
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxFileSizeMB) {
      return `Le fichier est trop volumineux. Taille maximum: ${maxFileSizeMB}MB`;
    }

    // Check file type
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (allowedFileTypes.length > 0 && !allowedFileTypes.includes(fileExtension)) {
      return `Type de fichier non autorisé. Types acceptés: ${allowedFileTypes.join(', ')}`;
    }

    return null;
  }, [maxFileSizeMB, allowedFileTypes]);

  // Real file upload implementation using new submission API
  const uploadFile = async (file: File): Promise<{ submissionId: string; fileUrl: string }> => {
    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      console.log('🔄 Starting file upload:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        assignmentId
      });

      const formData = new FormData();
      formData.append('file', file);

      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch(`/api/assignments/${assignmentId}/submissions/upload`, {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      console.log('📥 Upload response:', {
        status: response.status,
        ok: response.ok
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Upload failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });

        // Provide more specific error messages based on status code
        let errorMessage = 'Erreur lors du téléchargement du fichier';

        switch (response.status) {
          case 400:
            errorMessage = errorData.error || 'Fichier invalide ou données manquantes';
            break;
          case 401:
            errorMessage = errorData.error || errorData.message || 'Authentification requise. Veuillez vous reconnecter.';
            console.error('🔐 Authentication error details:', errorData);
            // Show error message first, then redirect after a delay
            toast.error(errorMessage, { duration: 5000 });
            setTimeout(() => {
              if (!window.location.pathname.includes('/login')) {
                window.location.href = '/login';
              }
            }, 3000);
            break;
          case 403:
            errorMessage = errorData.error || 'Vous n\'avez pas les permissions pour télécharger ce fichier';
            break;
          case 404:
            errorMessage = errorData.error || 'Devoir non trouvé ou expiré';
            break;
          case 413:
            errorMessage = errorData.error || 'Le fichier est trop volumineux';
            break;
          case 415:
            errorMessage = errorData.error || 'Type de fichier non supporté. Seuls les fichiers PDF sont acceptés.';
            break;
          case 500:
            errorMessage = errorData.error || 'Erreur du serveur. Veuillez réessayer dans quelques instants.';
            break;
          default:
            errorMessage = errorData.error || errorData.message || `Erreur ${response.status}: ${response.statusText}`;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('✅ Upload successful:', data);

      if (!data.success) {
        throw new Error(data.error || 'Erreur lors du traitement du fichier');
      }

      return {
        submissionId: data.data.submissionId,
        fileUrl: data.data.fileUrl
      };
    } catch (error) {
      setIsUploading(false);
      setUploadProgress(0);
      console.error('❌ Upload error:', error);
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('📁 File selected:', {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: new Date(file.lastModified).toISOString()
    });

    // Reset previous errors
    setUploadError(null);

    // Validate file
    const validationError = validateFile(file, maxFileSizeMB, allowedFileTypes);
    if (validationError) {
      setUploadError(validationError);
      logError(validationError, { assignmentId, fileName: file.name, fileSize: file.size });
      return;
    }

    // Additional validation for PDF files
    if (allowedFileTypes.includes('.pdf') && file.type !== 'application/pdf') {
      const pdfError = 'Seuls les fichiers PDF sont acceptés pour ce devoir';
      setUploadError(pdfError);
      logError(pdfError, { assignmentId, fileName: file.name, fileType: file.type });
      return;
    }

    // Check file size in MB
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxFileSizeMB) {
      const sizeError = `Le fichier est trop volumineux (${fileSizeMB.toFixed(2)}MB). Taille maximale autorisée: ${maxFileSizeMB}MB`;
      setUploadError(sizeError);
      return;
    }

    // Check assignment deadline
    if (dueDate) {
      const deadlineError = checkAssignmentDeadline(dueDate, allowLateSubmissions);
      if (deadlineError) {
        setUploadError(deadlineError);
        logError(deadlineError, { assignmentId, dueDate });
        return;
      }
    }

    setSelectedFile(file);
    setUploadError(null);
    setRetryCount(0);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      // Upload file and create/update submission in one step
      const uploadResult = await uploadFile(selectedFile);

      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Store submission ID for finalization
      const submissionData = {
        id: uploadResult.submissionId,
        fileUrl: uploadResult.fileUrl,
        fileName: selectedFile.name,
        status: 'in_progress'
      };

      onSubmissionChange?.(submissionData);
      setRetryCount(0);

      // Force refresh submission data to show the uploaded file immediately
      console.log('🔄 Refreshing submission data after upload...');
      await refetchSubmission();
      
      // Add a small delay to ensure the data is properly updated
      setTimeout(async () => {
        console.log('🔄 Second refresh to ensure data is updated...');
        await refetchSubmission();
      }, 500);

      // Don't auto-finalize - let user click submit button instead
      console.log('✅ File uploaded successfully - waiting for user to submit');
    } catch (error) {
      const parsedError = parseError(error);
      setUploadError(parsedError);
      logError(parsedError, {
        assignmentId,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        retryCount
      });
      setRetryCount(prev => prev + 1);
    }
  };

  const handleSubmit = async () => {
    if (!submission) {
      setUploadError('Aucun fichier téléchargé');
      return;
    }

    try {
      setUploadError(null); // Clear any previous errors
      console.log('🎯 Finalizing submission...');
      await finalizeSubmissionMutation.mutateAsync({
        assignmentId,
        submissionId: submission.id
      });
      console.log('✅ Submission finalized successfully');

      // Show success message
      setSubmissionSuccess(true);

      // Refresh submission data to update status
      await refetchSubmission();

      // Show success toast notification
      toast.success('🎉 Félicitations ! Votre devoir a été soumis avec succès. Votre enseignant pourra le consulter dans la section corrections.', {
        duration: 5000,
        position: 'top-center'
      });

      // Rediriger vers la page des devoirs après la soumission réussie
      setTimeout(() => {
        router.push('/student/assignments');
      }, 1500); // Petit délai pour laisser le temps de voir le message de succès

    } catch (error) {
      console.error('❌ Finalize error:', error);
      setUploadError(error instanceof Error ? error.message : 'Erreur lors de la soumission');
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFinalizeSubmission = async (submissionId: string) => {
    try {
      const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': 'imhotepacademy',
'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to finalize submission');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to finalize submission');
      }

      // Update submission status
      const finalizedSubmission = {
        ...submission,
        status: 'submitted',
        submitted_at: data.data.submitted_at,
        is_late: data.data.is_late
      };

      onSubmissionChange?.(finalizedSubmission);
      return data.data;
    } catch (error) {
      throw error;
    }
  };

  // handleSubmissionFinalized removed - auto-submit instead

  const isSubmitted = submission?.status === 'submitted' || submission?.status === 'graded';
  const hasReachedLimit = currentAttempts >= maxAttempts;
  const canEdit = !disabled && !isSubmitted && !hasReachedLimit;

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
          <Upload className="h-5 w-5 text-emerald-600" />
          Soumission de fichier
        </CardTitle>
        <CardDescription>
          Téléchargez votre fichier de réponse. Types acceptés: {allowedFileTypes.join(', ')} 
          (max {maxFileSizeMB}MB)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current submission display */}
        {submission?.submitted_file_url && (
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <File className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-green-900">
                    {submission.submitted_file_name}
                  </p>
                  <p className="text-sm text-green-600">
                    {submission.submitted_file_size_mb?.toFixed(2)} MB
                    {submission.submitted_at && ` • Téléchargé le ${new Date(submission.submitted_at).toLocaleDateString('fr-FR')}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      if (!submission.submitted_file_url) return;

                      // Use the new working backend route
                      const apiUrl = process.env.NODE_ENV === 'development' 
                        ? 'http://localhost:4000' 
                        : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

                      // Parse the original file URL to extract parameters
                      const urlParts = submission.submitted_file_url.split('/');
                      const tenantId = urlParts[4]; // /api/v1/files/{tenantId}/...
                      const courseId = urlParts[5]; // /api/v1/files/{tenantId}/{courseId}/...
                      const filename = urlParts[6]; // /api/v1/files/{tenantId}/{courseId}/{filename}

                      // Construct the new working download URL with query parameters
                      const directDownloadUrl = `${apiUrl}/api/v1/files/serve-file?tenantId=${tenantId}&courseId=${courseId}&filename=${filename}`;
                      
                      console.log('🔗 Working download URL:', directDownloadUrl);

                      const response = await fetch(directDownloadUrl, {
                        method: 'GET',
                        headers: {
                          'X-Tenant': tenantId, // Use the actual tenantId from the URL
                          'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
                        },
                      });

                      if (!response.ok) {
                        // Try to get error details
                        let errorMessage = `Erreur ${response.status}: ${response.statusText}`;
                        try {
                          const errorData = await response.clone().json();
                          errorMessage = errorData.error || errorData.message || errorMessage;
                          console.error('❌ Download error details:', errorData);
                        } catch (e) {
                          try {
                            const errorText = await response.clone().text();
                            console.error('❌ Download error text:', errorText);
                            if (errorText) {
                              errorMessage = errorText;
                            }
                          } catch (textError) {
                            console.error('❌ Could not parse error response');
                          }
                        }

                        // Handle 401 specifically
                        if (response.status === 401) {
                          console.error('🔐 Authentication error during download');
                          toast.error('Authentification requise. Veuillez vous reconnecter.', { duration: 5000 });
                          setTimeout(() => {
                            if (!window.location.pathname.includes('/login')) {
                              window.location.href = '/login';
                            }
                          }, 3000);
                        }

                        throw new Error(errorMessage);
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
                      
                      toast.success('Fichier téléchargé avec succès !');
                    } catch (error) {
                      console.error('Erreur de téléchargement:', error);
                      toast.error('Erreur lors du téléchargement du fichier');
                    }
                  }}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Télécharger
                </Button>
                {submission.status === 'submitted' && (
                  <div className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">Soumis</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Upload progress */}
        {isUploading && (
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-900">
                  Téléchargement en cours...
                </p>
                <Progress value={uploadProgress} className="mt-2" />
                <p className="text-xs text-blue-600 mt-1">
                  {uploadProgress}% terminé
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Limit reached message */}
        {hasReachedLimit && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p><strong>Limite de soumissions atteinte</strong></p>
                <p>Vous avez déjà soumis ce devoir {currentAttempts} fois sur {maxAttempts} tentatives autorisées.</p>
                <p>Vous ne pouvez plus soumettre de nouveau fichier pour ce devoir.</p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* File upload area */}
        {canEdit && !isUploading && (
          <div className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                selectedFile
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-gray-300 hover:border-emerald-300 hover:bg-emerald-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={allowedFileTypes.join(',')}
                onChange={handleFileSelect}
                className="hidden"
                disabled={disabled || isUploading}
              />

              {selectedFile ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2">
                    <File className="h-8 w-8 text-emerald-600" />
                    <div className="text-left">
                      <p className="font-medium text-emerald-900">{selectedFile.name}</p>
                      <p className="text-sm text-emerald-600">
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveFile}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {isUploading && (
                    <div className="space-y-2">
                      <Progress value={uploadProgress} className="w-full" />
                      <p className="text-sm text-gray-600">Téléchargement... {uploadProgress}%</p>
                    </div>
                  )}
                  
                  {!isUploading && (
                    <Button
                      onClick={handleUpload}
                      disabled={isUploading || createSubmissionMutation.isPending || updateSubmissionMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {createSubmissionMutation.isPending || updateSubmissionMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Téléchargement...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Télécharger le fichier
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="h-12 w-12 text-gray-400 mx-auto" />
                  <div>
                    <p className="text-lg font-medium text-gray-900">
                      Glissez votre fichier ici ou cliquez pour sélectionner
                    </p>
                    <p className="text-sm text-gray-600">
                      Types acceptés: {allowedFileTypes.join(', ')} (max {maxFileSizeMB}MB)
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled || isUploading}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Sélectionner un fichier
                  </Button>
                </div>
              )}
            </div>

            {/* Error display */}
            {uploadError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-2">
                    <p>{uploadError.userMessage}</p>
                    {uploadError.retryable && retryCount > 0 && (
                      <p className="text-sm">
                        Tentative {retryCount}/3. {uploadError.retryable ? 'Vous pouvez réessayer.' : ''}
                      </p>
                    )}
                    {uploadError.retryable && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setUploadError(null);
                          if (selectedFile) {
                            handleUpload();
                          }
                        }}
                        disabled={retryCount >= 3}
                      >
                        Réessayer
                      </Button>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Submit button - simple validation without modal */}
        {submission && submission.submitted_file_url && submission.status === 'in_progress' && (
          <div className="pt-4 border-t">
            <Button
              onClick={handleSubmit}
              disabled={finalizeSubmissionMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              size="lg"
            >
              {finalizeSubmissionMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Soumission en cours...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Soumettre le devoir
                </>
              )}
            </Button>
          </div>
        )}

        {/* Success message after submission */}
        {submissionSuccess && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              🎉 <strong>Devoir soumis avec succès !</strong> Votre fichier a été envoyé et est maintenant en attente de correction par votre enseignant.
            </AlertDescription>
          </Alert>
        )}

        {/* Status messages */}
        {isSubmitted && !submissionSuccess && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              {submission?.status === 'submitted'
                ? 'Votre devoir a été soumis avec succès et est en attente de correction.'
                : 'Votre devoir a été corrigé. Consultez l\'onglet Feedback pour voir vos résultats.'
              }
            </AlertDescription>
          </Alert>
        )}

        {/* Review Modal removed - auto-submit after upload */}
      </CardContent>
    </Card>
  );
}
