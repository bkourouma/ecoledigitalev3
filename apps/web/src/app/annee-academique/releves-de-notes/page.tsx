"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Plus, FileText, Edit, Trash2, CheckCircle, AlertCircle, Loader2, User, Award, GraduationCap } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useStudents } from "@/lib/hooks/use-students";
import toast from "react-hot-toast";

const transcriptFormSchema = z.object({
  studentId: z.string().uuid("L'ID de l'étudiant est requis"),
  academicYearId: z.string().uuid("L'ID de l'année académique est requis"),
  transcriptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  totalCredits: z.number().int().min(0, "Le nombre de crédits doit être positif"),
  gpa: z.number().min(0).max(20, "La moyenne doit être entre 0 et 20"),
  transcriptUrl: z.string().optional(),
  downloadable: z.boolean().optional(),
  viewable: z.boolean().optional(),
});

type TranscriptFormData = z.infer<typeof transcriptFormSchema>;

interface Transcript {
  id: string;
  studentId: string;
  studentName: string;
  academicYearId: string;
  academicYearName: string;
  transcriptDate: string;
  totalCredits: number;
  gpa: number;
  transcriptUrl: string | null;
  downloadable: boolean;
  viewable: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function TranscriptsPage() {
  const { data: session, status } = useSession();

  // Redirect if not authenticated
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

  // Check if user has admin role
  const roles = (session as any)?.roles ?? [];
  const isAdmin = Array.isArray(roles) && roles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r));

  if (!isAdmin) {
    redirect('/');
  }

  const [showForm, setShowForm] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editTranscript, setEditTranscript] = useState<Transcript | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: academicYearsData, isLoading: isLoadingYears } = useAcademicYears();
  const academicYears = academicYearsData?.data || [];

  const { data: studentsData, isLoading: isLoadingStudents } = useStudents({ status: 'active', limit: 1000 });
  const students = studentsData?.data || [];

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<TranscriptFormData>({
    resolver: zodResolver(transcriptFormSchema),
    defaultValues: {
      downloadable: true,
      viewable: true,
    },
  });

  // Fetch transcripts
  const fetchTranscripts = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/v1/transcripts', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Handle empty response or non-JSON response
      let data: any = {};
      try {
        const text = await response.text();
        if (text) {
          data = JSON.parse(text);
        }
      } catch (parseError) {
        console.error('Failed to parse response:', parseError);
        // If response is not OK and we can't parse it, it's likely an error
        if (!response.ok) {
          throw new Error(`Erreur ${response.status}: ${response.statusText}`);
        }
        // If response is OK but empty, assume empty array
        data = { success: true, data: [] };
      }

      if (!response.ok) {
        const errorMessage = data.error || data.message || `Erreur ${response.status}: ${response.statusText}` || 'Erreur lors du chargement des relevés de notes';
        console.error('Error response:', {
          status: response.status,
          statusText: response.statusText,
          data,
        });
        throw new Error(errorMessage);
      }

      if (data.success) {
        if (Array.isArray(data.data)) {
          setTranscripts(data.data);
        } else {
          setTranscripts([]);
        }
      } else {
        console.warn('API returned success: false', data);
        setTranscripts([]);
      }
    } catch (error: any) {
      console.error('Error fetching transcripts:', error);
      const errorMessage = error.message || 'Erreur lors du chargement des relevés de notes';
      
      // Don't show toast for empty table errors (table might not exist yet)
      if (!errorMessage.includes('does not exist') && !errorMessage.includes('n\'existe pas')) {
        toast.error(errorMessage);
      }
      
      setTranscripts([]);
    } finally {
      setLoading(false);
    }
  };

  // Load transcripts on mount
  useEffect(() => {
    fetchTranscripts();
  }, []);

  // Handle file upload
  const handleFileUpload = async (file: File): Promise<string> => {
    try {
      setUploadingFile(true);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append('file', file);

      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch('/api/v1/transcripts/upload', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!response.ok) {
        let errorData: any = {};
        try {
          const text = await response.text();
          if (text) {
            errorData = JSON.parse(text);
          }
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
        }
        
        let errorMessage = 'Erreur lors du téléchargement du fichier';
        
        switch (response.status) {
          case 400:
            errorMessage = errorData.error || errorData.message || 'Fichier invalide ou données manquantes';
            break;
          case 401:
            errorMessage = errorData.error || errorData.message || 'Authentification requise';
            break;
          case 413:
            errorMessage = errorData.error || errorData.message || 'Le fichier est trop volumineux (max 10MB)';
            break;
          case 500:
            errorMessage = errorData.error || errorData.message || errorData.details || 'Erreur du serveur lors du téléchargement';
            break;
          default:
            errorMessage = errorData.error || errorData.message || `Erreur ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      let data: any = {};
      try {
        const text = await response.text();
        if (text) {
          data = JSON.parse(text);
        }
      } catch (parseError) {
        console.error('Failed to parse success response:', parseError);
        throw new Error('Erreur lors du traitement de la réponse du serveur');
      }

      if (!data.success) {
        throw new Error(data.error || data.message || 'Erreur lors du traitement du fichier');
      }

      if (!data.data || !data.data.fileUrl) {
        throw new Error('URL du fichier manquante dans la réponse');
      }

      return data.data.fileUrl;
    } catch (error) {
      console.error('❌ File upload error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Erreur inconnue lors du téléchargement du fichier');
    } finally {
      setUploadingFile(false);
      setUploadProgress(0);
    }
  };

  // Handle form submit
  const onSubmit = async (data: TranscriptFormData) => {
    try {
      setSubmitting(true);

      let transcriptUrl = data.transcriptUrl;

      // Upload file if a new file is selected
      if (selectedFile) {
        try {
          transcriptUrl = await handleFileUpload(selectedFile);
          toast.success('Fichier téléchargé avec succès');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Erreur lors du téléchargement du fichier';
          console.error('File upload failed:', error);
          toast.error(errorMessage);
          setSubmitting(false);
          return;
        }
      } else if (!editTranscript && !transcriptUrl) {
        // Require file for new transcripts
        toast.error('Veuillez sélectionner un fichier PDF pour le relevé de notes');
        setSubmitting(false);
        return;
      }

      const submitData: any = {
        studentId: data.studentId,
        academicYearId: data.academicYearId,
        transcriptDate: data.transcriptDate,
        totalCredits: data.totalCredits,
        gpa: data.gpa,
      };

      if (transcriptUrl) {
        submitData.transcriptUrl = transcriptUrl;
      }
      if (data.downloadable !== undefined) {
        submitData.downloadable = data.downloadable;
      }
      if (data.viewable !== undefined) {
        submitData.viewable = data.viewable;
      }

      const url = editTranscript
        ? `/api/v1/transcripts/${editTranscript.id}`
        : '/api/v1/transcripts';

      const method = editTranscript ? 'PUT' : 'POST';

      console.log('📤 Submitting transcript:', {
        url,
        method,
        submitData,
      });

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      console.log('📥 Response received:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
      });

      // Parse response once (response.text() can only be called once)
      let result: any = {};
      try {
        const text = await response.text();
        console.log('📥 Response text:', text);
        if (text) {
          result = JSON.parse(text);
        }
      } catch (parseError) {
        console.error('❌ Failed to parse response:', parseError);
        throw new Error('Erreur lors du traitement de la réponse du serveur');
      }

      if (!response.ok) {
        const errorMessage = result.error || result.message || result.details || `Erreur ${response.status}: ${response.statusText}`;
        console.error('❌ Error response:', {
          status: response.status,
          statusText: response.statusText,
          result,
        });
        throw new Error(errorMessage);
      }

      // Handle successful responses (status 200/201)
      const isSuccess = 
        result.success === true || 
        ((response.status === 200 || response.status === 201) && 
         result.success !== false && 
         (result.success === true || result.success === undefined || result.data !== undefined));

      if (isSuccess) {
        console.log('✅ Transcript saved successfully:', result);
        toast.success(editTranscript ? 'Relevé de notes mis à jour avec succès' : 'Relevé de notes créé avec succès');
        reset();
        setSelectedFile(null);
        setShowForm(false);
        setEditTranscript(null);
        fetchTranscripts();
      } else {
        const errorMessage = result.error || result.message || result.details || 'Erreur lors de la sauvegarde';
        console.error('❌ API returned success: false:', result);
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error saving transcript:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erreur lors de la sauvegarde';
      toast.error(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle edit
  const handleEdit = (transcript: Transcript) => {
    setEditTranscript(transcript);
    setValue('studentId', transcript.studentId);
    setValue('academicYearId', transcript.academicYearId);
    setValue('transcriptDate', transcript.transcriptDate);
    setValue('totalCredits', transcript.totalCredits);
    setValue('gpa', transcript.gpa);
    setValue('transcriptUrl', transcript.transcriptUrl || '');
    setValue('downloadable', transcript.downloadable);
    setValue('viewable', transcript.viewable);
    setSelectedFile(null);
    setShowForm(true);
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce relevé de notes ?')) return;

    try {
      const response = await fetch(`/api/v1/transcripts/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        let errorData: any = {};
        try {
          const text = await response.text();
          if (text) {
            errorData = JSON.parse(text);
          }
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
        }
        
        const errorMessage = errorData.message || errorData.error || `Erreur ${response.status}: ${response.statusText}`;
        throw new Error(errorMessage);
      }

      let result: any = {};
      try {
        const text = await response.text();
        if (text) {
          result = JSON.parse(text);
        }
      } catch (parseError) {
        console.error('Failed to parse success response:', parseError);
        result = { success: true };
      }

      if (result.success !== false) {
        toast.success('Relevé de notes supprimé avec succès');
        fetchTranscripts();
      } else {
        throw new Error(result.error || result.message || 'Erreur lors de la suppression');
      }
    } catch (error) {
      console.error('Error deleting transcript:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur lors de la suppression');
    }
  };

  // Get GPA badge
  const getGPABadge = (gpa: number) => {
    if (gpa >= 16) return { label: 'Excellent', variant: 'default' as const };
    if (gpa >= 14) return { label: 'Très Bien', variant: 'default' as const };
    if (gpa >= 12) return { label: 'Bien', variant: 'secondary' as const };
    if (gpa >= 10) return { label: 'Assez Bien', variant: 'outline' as const };
    return { label: 'Insuffisant', variant: 'destructive' as const };
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <GraduationCap className="h-8 w-8 text-emerald-600" />
          Relevés de Notes
        </h1>
        <p className="text-gray-600">
          Gérez les relevés de notes des étudiants (crédits, GPA, moyennes générales)
        </p>
      </div>

      {/* Create/Edit Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTranscript ? 'Modifier le relevé de notes' : 'Créer un relevé de notes'}</DialogTitle>
            <DialogDescription>
              {editTranscript ? 'Modifiez les informations du relevé de notes' : 'Ajoutez un nouveau relevé de notes'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="studentId">Étudiant *</Label>
                <Select
                  value={watch('studentId') || ''}
                  onValueChange={(value) => setValue('studentId', value)}
                  disabled={isLoadingStudents}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un étudiant" />
                  </SelectTrigger>
                  <SelectContent>
                    {students.map((student: any) => (
                      <SelectItem key={student.id} value={student.id}>
                        {student.user?.firstName && student.user?.lastName
                          ? `${student.user.firstName} ${student.user.lastName}`
                          : student.user?.name || `Étudiant ${student.studentNumber || student.id.slice(0, 8)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.studentId && (
                  <p className="text-sm text-red-600">{errors.studentId.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="academicYearId">Année Académique *</Label>
                <Select
                  value={watch('academicYearId') || ''}
                  onValueChange={(value) => setValue('academicYearId', value)}
                  disabled={isLoadingYears}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner une année académique" />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYears.map((year: any) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.academicYearId && (
                  <p className="text-sm text-red-600">{errors.academicYearId.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transcriptDate">Date du relevé de notes *</Label>
              <Input
                id="transcriptDate"
                type="date"
                {...register('transcriptDate')}
              />
              {errors.transcriptDate && (
                <p className="text-sm text-red-600">{errors.transcriptDate.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="totalCredits">Total crédits *</Label>
                <Input
                  id="totalCredits"
                  type="number"
                  min="0"
                  step="1"
                  {...register('totalCredits', { valueAsNumber: true })}
                  placeholder="Ex: 120"
                />
                {errors.totalCredits && (
                  <p className="text-sm text-red-600">{errors.totalCredits.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="gpa">Moyenne générale (GPA) sur 20 *</Label>
                <Input
                  id="gpa"
                  type="number"
                  min="0"
                  max="20"
                  step="0.01"
                  {...register('gpa', { valueAsNumber: true })}
                  placeholder="Ex: 15.5"
                />
                {errors.gpa && (
                  <p className="text-sm text-red-600">{errors.gpa.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transcriptFile">Fichier du relevé de notes (PDF) *</Label>
              <div className="space-y-2">
                <Input
                  id="transcriptFile"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      // Validate file type
                      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                        toast.error('Seuls les fichiers PDF sont acceptés');
                        e.target.value = '';
                        return;
                      }
                      // Validate file size (max 10MB)
                      const maxSize = 10 * 1024 * 1024; // 10MB
                      if (file.size > maxSize) {
                        toast.error('Le fichier est trop volumineux (max 10MB)');
                        e.target.value = '';
                        return;
                      }
                      setSelectedFile(file);
                      // Clear the URL field when a new file is selected
                      setValue('transcriptUrl', '');
                    }
                  }}
                  disabled={uploadingFile || submitting}
                />
                {selectedFile && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FileText className="h-4 w-4" />
                    <span>{selectedFile.name}</span>
                    <span className="text-gray-400">
                      ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                  </div>
                )}
                {editTranscript && editTranscript.transcriptUrl && !selectedFile && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600">
                    <FileText className="h-4 w-4" />
                    <span>Fichier actuel: </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
                          await downloadFileWithAuth(editTranscript.transcriptUrl!);
                        } catch (error) {
                          console.error('Error viewing transcript:', error);
                          toast.error('Erreur lors de l\'ouverture du relevé de notes');
                        }
                      }}
                      className="underline hover:text-emerald-700 cursor-pointer"
                    >
                      Voir le relevé de notes
                    </button>
                  </div>
                )}
                {uploadingFile && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Téléchargement en cours... {uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Téléchargez un fichier PDF du relevé de notes (max 10MB). Si vous ne téléchargez pas de nouveau fichier lors de la modification, le fichier actuel sera conservé.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="downloadable"
                  {...register('downloadable')}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="downloadable" className="cursor-pointer">
                  Téléchargeable
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="viewable"
                  {...register('viewable')}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="viewable" className="cursor-pointer">
                  Visualisable
                </Label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditTranscript(null);
                  setSelectedFile(null);
                  reset();
                }}
                disabled={submitting || uploadingFile}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={submitting || uploadingFile}>
                {submitting || uploadingFile ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {uploadingFile ? 'Téléchargement...' : editTranscript ? 'Modification...' : 'Création...'}
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {editTranscript ? 'Modifier' : 'Créer'}
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transcripts List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Relevés de Notes</CardTitle>
              <CardDescription>
                Liste de tous les relevés de notes
              </CardDescription>
            </div>
            <Button onClick={() => {
              reset();
              setEditTranscript(null);
              setSelectedFile(null);
              setShowForm(true);
            }}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter un relevé de notes
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              <span className="ml-2">Chargement...</span>
            </div>
          ) : transcripts.length === 0 ? (
            <div className="text-center py-12">
              <GraduationCap className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">Aucun relevé de notes</p>
              <Button onClick={() => {
                reset();
                setEditTranscript(null);
                setSelectedFile(null);
                setShowForm(true);
              }}>
                <Plus className="h-4 w-4 mr-2" />
                Créer le premier relevé de notes
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {transcripts.map((transcript) => {
                const gpaBadge = getGPABadge(transcript.gpa);
                return (
                  <Card key={transcript.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-lg">
                              {transcript.studentName}
                            </h3>
                            <Badge variant={gpaBadge.variant}>{gpaBadge.label}</Badge>
                            <Badge variant="outline">{transcript.gpa.toFixed(2)}/20</Badge>
                            <Badge variant="secondary">{transcript.totalCredits} crédits</Badge>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm text-gray-600 mb-2">
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              <span>{transcript.studentName}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <FileText className="h-4 w-4" />
                              {new Date(transcript.transcriptDate).toLocaleDateString('fr-FR', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric'
                              })}
                            </div>
                            <div className="flex items-center gap-1">
                              <Award className="h-4 w-4" />
                              <span>{transcript.academicYearName}</span>
                            </div>
                          </div>
                          {transcript.transcriptUrl && (
                            <div className="text-sm text-gray-500">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
                                    await downloadFileWithAuth(transcript.transcriptUrl!);
                                  } catch (error) {
                                    console.error('Error viewing transcript:', error);
                                    toast.error('Erreur lors de l\'ouverture du relevé de notes');
                                  }
                                }}
                                className="text-emerald-600 hover:underline cursor-pointer"
                              >
                                Voir le relevé de notes
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(transcript)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(transcript.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

