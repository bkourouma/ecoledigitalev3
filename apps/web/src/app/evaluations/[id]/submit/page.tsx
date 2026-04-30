"use client";

import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label } from "@ecoledigitale/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Upload, FileText, AlertTriangle, CheckCircle, Download, Send } from "lucide-react";
import { useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAssignment, useSubmission, useCreateSubmission, useUpdateSubmission, useSubmitAssignment } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function SubmitHomeworkPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: assignment } = useAssignment(assignmentId);
  const { data: submission } = useSubmission(assignmentId);
  
  const createSubmissionMutation = useCreateSubmission();
  const updateSubmissionMutation = useUpdateSubmission();
  const submitAssignmentMutation = useSubmitAssignment();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      alert('Seuls les fichiers PDF sont acceptés.');
      return;
    }

    // Validate file size
    const maxSizeMB = assignment?.max_file_size_mb || 10;
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxSizeMB) {
      alert(`Le fichier est trop volumineux. Taille maximale: ${maxSizeMB}MB`);
      return;
    }

    setSelectedFile(file);
  };

  const uploadFile = async (file: File): Promise<string> => {
    // Simulate file upload - replace with actual upload logic
    setIsUploading(true);
    setUploadProgress(0);

    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      // Simulate upload progress
      const interval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(interval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      // Simulate upload completion
      setTimeout(() => {
        clearInterval(interval);
        setUploadProgress(100);
        setIsUploading(false);
        
        // Return mock URL - replace with actual upload endpoint
        const mockUrl = `https://storage.example.com/submissions/${Date.now()}-${file.name}`;
        resolve(mockUrl);
      }, 2000);
    });
  };

  const handleStartSubmission = async () => {
    if (!selectedFile) return;

    try {
      const fileUrl = await uploadFile(selectedFile);
      const fileSizeMB = selectedFile.size / (1024 * 1024);

      await createSubmissionMutation.mutateAsync({
        assignment_id: assignmentId,
        submitted_file_url: fileUrl,
        submitted_file_name: selectedFile.name,
        submitted_file_size_mb: fileSizeMB
      });
    } catch (error) {
      alert('Erreur lors du téléchargement: ' + String(error));
    }
  };

  const handleUpdateSubmission = async () => {
    if (!selectedFile || !submission) return;

    try {
      const fileUrl = await uploadFile(selectedFile);
      const fileSizeMB = selectedFile.size / (1024 * 1024);

      await updateSubmissionMutation.mutateAsync({
        assignmentId,
        submissionId: submission.id,
        data: {
          submitted_file_url: fileUrl,
          submitted_file_name: selectedFile.name,
          submitted_file_size_mb: fileSizeMB
        }
      });

      setSelectedFile(null);
    } catch (error) {
      alert('Erreur lors de la mise à jour: ' + String(error));
    }
  };

  const handleSubmit = async () => {
    if (!submission) return;

    if (!submission.submitted_file_url) {
      alert('Veuillez d\'abord télécharger un fichier.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitAssignmentMutation.mutateAsync({
        assignmentId,
        submissionId: submission.id
      });

      router.push(`/evaluations/${assignmentId}`);
    } catch (error) {
      alert('Erreur lors de la soumission: ' + String(error));
      setIsSubmitting(false);
    }
  };

  if (!assignment) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Chargement...</h2>
          <p className="text-muted-foreground">Préparation du devoir</p>
        </div>
      </div>
    );
  }

  const isSubmitted = submission?.status === 'submitted' || submission?.status === 'graded';
  const hasFile = submission?.submitted_file_url;
  const isLate = submission?.is_late;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/evaluations/${assignmentId}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold">{assignment.title}</h2>
          <p className="text-muted-foreground">Soumission de devoir</p>
        </div>
      </div>

      {/* Status Alerts */}
      {isSubmitted && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            Votre devoir a été soumis le {submission?.submitted_at && format(new Date(submission.submitted_at), "PPP à HH:mm", { locale: fr })}.
            {submission?.status === 'graded' && submission.final_score && (
              <> Note: {submission.final_score}/20</>
            )}
          </AlertDescription>
        </Alert>
      )}

      {isLate && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Attention: Cette soumission est en retard.
            {assignment.late_penalty_percent > 0 && (
              <> Une pénalité de {assignment.late_penalty_percent}% sera appliquée.</>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Assignment Details */}
      <Card>
        <CardHeader>
          <CardTitle>Détails du devoir</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="font-medium">Échéance</p>
              <p className="text-muted-foreground">
                {format(new Date(assignment.ends_at), "PPP à HH:mm", { locale: fr })}
              </p>
            </div>
            <div>
              <p className="font-medium">Format</p>
              <p className="text-muted-foreground">PDF uniquement</p>
            </div>
            <div>
              <p className="font-medium">Taille max</p>
              <p className="text-muted-foreground">{assignment.max_file_size_mb}MB</p>
            </div>
          </div>

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
        </CardContent>
      </Card>

      {/* File Upload */}
      {!isSubmitted && (
        <Card>
          <CardHeader>
            <CardTitle>Télécharger votre devoir</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current file */}
            {hasFile && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-green-600" />
                  <div className="flex-1">
                    <p className="font-medium text-green-800">{submission?.submitted_file_name}</p>
                    <p className="text-sm text-green-600">
                      {submission?.submitted_file_size_mb?.toFixed(2)}MB
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        if (!submission?.submitted_file_url) return;

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
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* File selection */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="file-upload">
                  {hasFile ? 'Remplacer le fichier' : 'Sélectionner un fichier PDF'}
                </Label>
                <Input
                  id="file-upload"
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="mt-2"
                />
              </div>

              {selectedFile && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <div className="flex-1">
                      <p className="font-medium text-blue-800">{selectedFile.name}</p>
                      <p className="text-sm text-blue-600">
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)}MB
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Upload progress */}
              {isUploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Téléchargement en cours...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Upload button */}
              {selectedFile && !isUploading && (
                <Button 
                  onClick={hasFile ? handleUpdateSubmission : handleStartSubmission}
                  disabled={createSubmissionMutation.isPending || updateSubmissionMutation.isPending}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {hasFile ? 'Mettre à jour le fichier' : 'Télécharger le fichier'}
                </Button>
              )}
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>• Format accepté: PDF uniquement</p>
              <p>• Taille maximale: {assignment.max_file_size_mb}MB</p>
              <p>• Vous pouvez remplacer votre fichier jusqu'à la soumission finale</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submission Actions */}
      <div className="flex justify-end gap-4">
        <Link href={`/evaluations/${assignmentId}`}>
          <Button variant="outline">
            {isSubmitted ? 'Retour' : 'Annuler'}
          </Button>
        </Link>

        {!isSubmitted && hasFile && (
          <Button 
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            <Send className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Soumission...' : 'Soumettre le devoir'}
          </Button>
        )}
      </div>

      {/* Submission History */}
      {submission && (
        <Card>
          <CardHeader>
            <CardTitle>Historique</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Tentative</span>
                <span>{submission.attempt_number}</span>
              </div>
              
              {submission.submitted_at && (
                <div className="flex justify-between">
                  <span>Date de soumission</span>
                  <span>{format(new Date(submission.submitted_at), "PPP à HH:mm", { locale: fr })}</span>
                </div>
              )}
              
              {submission.final_score !== undefined && (
                <div className="flex justify-between">
                  <span>Note finale</span>
                  <span className="font-medium">{submission.final_score}/20</span>
                </div>
              )}
              
              {submission.feedback && (
                <div className="mt-4">
                  <h5 className="font-medium mb-2">Commentaires du professeur</h5>
                  <div className="bg-muted p-3 rounded-md">
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
