"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Plus, FileText, Edit, Trash2, CheckCircle, AlertCircle, Loader2, User, Calendar } from "lucide-react";
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

const attendanceReportFormSchema = z.object({
  studentId: z.string().uuid("L'ID de l'étudiant est requis"),
  academicYearId: z.string().uuid("L'ID de l'année académique est requis"),
  reportPeriod: z.string().optional(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  attendanceRate: z.number().min(0).max(100, "Le taux de présence doit être entre 0 et 100"),
  totalDays: z.number().int().min(0, "Le nombre total de jours doit être positif ou nul"),
  presentDays: z.number().int().min(0, "Le nombre de jours présents doit être positif ou nul"),
  absentDays: z.number().int().min(0, "Le nombre de jours absents doit être positif ou nul"),
  reportUrl: z.string().optional(),
  downloadable: z.boolean().optional(),
  viewable: z.boolean().optional(),
}).refine(
  (data) => data.presentDays + data.absentDays <= data.totalDays,
  {
    message: "La somme des jours présents et absents ne peut pas dépasser le nombre total de jours",
    path: ["presentDays", "absentDays"],
  }
);

type AttendanceReportFormData = z.infer<typeof attendanceReportFormSchema>;

interface AttendanceReport {
  id: string;
  studentId: string;
  studentName: string;
  academicYearId: string;
  academicYearName: string;
  reportPeriod: string | null;
  reportDate: string;
  attendanceRate: number;
  totalDays: number;
  presentDays: number;
  absentDays: number;
  reportUrl: string | null;
  downloadable: boolean;
  viewable: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function AttendanceReportsPage() {
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
  const [attendanceReports, setAttendanceReports] = useState<AttendanceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editReport, setEditReport] = useState<AttendanceReport | null>(null);
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
  } = useForm<AttendanceReportFormData>({
    resolver: zodResolver(attendanceReportFormSchema),
    defaultValues: {
      downloadable: true,
      viewable: true,
    },
  });

  // Fetch attendance reports
  const fetchAttendanceReports = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/v1/attendance-reports');
      const result = await response.json();
      
      if (result.success && result.data) {
        setAttendanceReports(result.data);
      } else {
        console.error('Failed to fetch attendance reports:', result);
        toast.error('Erreur lors du chargement des rapports de présence');
      }
    } catch (error) {
      console.error('Error fetching attendance reports:', error);
      toast.error('Erreur lors du chargement des rapports de présence');
    } finally {
      setLoading(false);
    }
  };

  // Load attendance reports on mount
  useEffect(() => {
    fetchAttendanceReports();
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

      const response = await fetch('/api/v1/attendance-reports/upload', {
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
  const onSubmit = async (data: AttendanceReportFormData) => {
    try {
      setSubmitting(true);

      let reportUrl = data.reportUrl;

      // Upload file if a new file is selected
      if (selectedFile) {
        try {
          reportUrl = await handleFileUpload(selectedFile);
          toast.success('Fichier téléchargé avec succès');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Erreur lors du téléchargement du fichier';
          console.error('File upload failed:', error);
          toast.error(errorMessage);
          setSubmitting(false);
          return;
        }
      } else if (!editReport && !reportUrl) {
        // Require file for new reports
        toast.error('Veuillez sélectionner un fichier PDF pour le rapport de présence');
        setSubmitting(false);
        return;
      }

      const submitData: any = {
        studentId: data.studentId,
        academicYearId: data.academicYearId,
        reportPeriod: data.reportPeriod || undefined,
        reportDate: data.reportDate,
        attendanceRate: data.attendanceRate,
        totalDays: data.totalDays,
        presentDays: data.presentDays,
        absentDays: data.absentDays,
      };

      if (reportUrl) {
        submitData.reportUrl = reportUrl;
      }
      if (data.downloadable !== undefined) {
        submitData.downloadable = data.downloadable;
      }
      if (data.viewable !== undefined) {
        submitData.viewable = data.viewable;
      }

      const url = editReport
        ? `/api/v1/attendance-reports/${editReport.id}`
        : '/api/v1/attendance-reports';

      const method = editReport ? 'PUT' : 'POST';

      console.log('📤 Submitting attendance report:', {
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
        console.log('✅ Attendance report saved successfully:', result);
        toast.success(editReport ? 'Rapport de présence mis à jour avec succès' : 'Rapport de présence créé avec succès');
        reset();
        setSelectedFile(null);
        setShowForm(false);
        setEditReport(null);
        fetchAttendanceReports();
      } else {
        const errorMessage = result.error || result.message || result.details || 'Erreur lors de la sauvegarde';
        console.error('❌ API returned success: false:', result);
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error saving attendance report:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erreur lors de la sauvegarde';
      toast.error(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle edit
  const handleEdit = (report: AttendanceReport) => {
    setEditReport(report);
    setValue('studentId', report.studentId);
    setValue('academicYearId', report.academicYearId);
    setValue('reportPeriod', report.reportPeriod || '');
    setValue('reportDate', report.reportDate);
    setValue('attendanceRate', report.attendanceRate);
    setValue('totalDays', report.totalDays);
    setValue('presentDays', report.presentDays);
    setValue('absentDays', report.absentDays);
    setValue('reportUrl', report.reportUrl || '');
    setValue('downloadable', report.downloadable);
    setValue('viewable', report.viewable);
    setSelectedFile(null);
    setShowForm(true);
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce rapport de présence ?')) return;

    try {
      const response = await fetch(`/api/v1/attendance-reports/${id}`, {
        method: 'DELETE',
        // Don't include Content-Type header for DELETE requests (no body)
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
        // If response is empty, assume success
        result = { success: true };
      }

      if (result.success !== false) {
        toast.success('Rapport de présence supprimé avec succès');
        fetchAttendanceReports();
      } else {
        throw new Error(result.error || result.message || 'Erreur lors de la suppression');
      }
    } catch (error) {
      console.error('Error deleting attendance report:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur lors de la suppression');
    }
  };

  // Get attendance rate badge
  const getAttendanceRateBadge = (rate: number) => {
    if (rate >= 95) return { label: 'Excellent', variant: 'default' as const, color: 'text-green-600' };
    if (rate >= 85) return { label: 'Très bon', variant: 'default' as const, color: 'text-blue-600' };
    if (rate >= 75) return { label: 'Bon', variant: 'secondary' as const, color: 'text-yellow-600' };
    return { label: 'À améliorer', variant: 'destructive' as const, color: 'text-red-600' };
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="font-bold text-gray-900 mb-2 flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
          <FileText className="h-8 w-8 text-emerald-600" />
          Rapports de Présence
        </h1>
        <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
          Gérez les rapports de présence des étudiants (taux de présence, jours présents/absents)
        </p>
      </div>

      {/* Create/Edit Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editReport ? 'Modifier le rapport de présence' : 'Créer un rapport de présence'}</DialogTitle>
            <DialogDescription>
              {editReport ? 'Modifiez les informations du rapport de présence' : 'Ajoutez un nouveau rapport de présence'}
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="reportPeriod">Période du rapport</Label>
                <Input
                  id="reportPeriod"
                  type="text"
                  {...register('reportPeriod')}
                  placeholder="Ex: Q1 2024, Semestre 1, Janvier 2024"
                />
                {errors.reportPeriod && (
                  <p className="text-sm text-red-600">{errors.reportPeriod.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reportDate">Date du rapport *</Label>
                <Input
                  id="reportDate"
                  type="date"
                  {...register('reportDate')}
                />
                {errors.reportDate && (
                  <p className="text-sm text-red-600">{errors.reportDate.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="totalDays">Nombre total de jours *</Label>
                <Input
                  id="totalDays"
                  type="number"
                  min="0"
                  {...register('totalDays', { valueAsNumber: true })}
                  placeholder="Ex: 30"
                />
                {errors.totalDays && (
                  <p className="text-sm text-red-600">{errors.totalDays.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="attendanceRate">Taux de présence (%) *</Label>
                <Input
                  id="attendanceRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  {...register('attendanceRate', { valueAsNumber: true })}
                  placeholder="Ex: 95.5"
                />
                {errors.attendanceRate && (
                  <p className="text-sm text-red-600">{errors.attendanceRate.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="presentDays">Jours présents *</Label>
                <Input
                  id="presentDays"
                  type="number"
                  min="0"
                  {...register('presentDays', { valueAsNumber: true })}
                  placeholder="Ex: 28"
                />
                {errors.presentDays && (
                  <p className="text-sm text-red-600">{errors.presentDays.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="absentDays">Jours absents *</Label>
                <Input
                  id="absentDays"
                  type="number"
                  min="0"
                  {...register('absentDays', { valueAsNumber: true })}
                  placeholder="Ex: 2"
                />
                {errors.absentDays && (
                  <p className="text-sm text-red-600">{errors.absentDays.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reportFile">Fichier du rapport (PDF) *</Label>
              <div className="space-y-2">
                <Input
                  id="reportFile"
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
                      setValue('reportUrl', '');
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
                {editReport && editReport.reportUrl && !selectedFile && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600">
                    <FileText className="h-4 w-4" />
                    <span>Fichier actuel: </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
                          await downloadFileWithAuth(editReport.reportUrl!);
                        } catch (error) {
                          console.error('Error viewing attendance report:', error);
                          toast.error('Erreur lors de l\'ouverture du rapport');
                        }
                      }}
                      className="underline hover:text-emerald-700 cursor-pointer"
                    >
                      Voir le rapport
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
                Téléchargez un fichier PDF du rapport de présence (max 10MB). Si vous ne téléchargez pas de nouveau fichier lors de la modification, le fichier actuel sera conservé.
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
                  setEditReport(null);
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
                    {uploadingFile ? 'Téléchargement...' : editReport ? 'Modification...' : 'Création...'}
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {editReport ? 'Modifier' : 'Créer'}
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Attendance Reports List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Rapports de Présence</CardTitle>
              <CardDescription>
                Liste de tous les rapports de présence
              </CardDescription>
            </div>
            <Button onClick={() => {
              reset();
              setEditReport(null);
              setSelectedFile(null);
              setShowForm(true);
            }}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter un rapport
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              <span className="ml-2">Chargement...</span>
            </div>
          ) : attendanceReports.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">Aucun rapport de présence</p>
              <Button onClick={() => {
                reset();
                setEditReport(null);
                setSelectedFile(null);
                setShowForm(true);
              }}>
                <Plus className="h-4 w-4 mr-2" />
                Créer le premier rapport
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {attendanceReports.map((report) => {
                const rateBadge = getAttendanceRateBadge(report.attendanceRate);
                return (
                  <Card key={report.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-lg">
                              {report.studentName}
                            </h3>
                            <Badge variant={rateBadge.variant}>{rateBadge.label}</Badge>
                            <Badge variant="outline">{report.attendanceRate.toFixed(1)}%</Badge>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600 mb-2">
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              <span>{report.studentName}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              <span>{report.reportPeriod || 'N/A'}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <FileText className="h-4 w-4" />
                              {new Date(report.reportDate).toLocaleDateString('fr-FR', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric'
                              })}
                            </div>
                            <div className="flex items-center gap-1">
                              <span>{report.academicYearName}</span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-sm text-gray-600 mb-2">
                            <div>
                              <span className="font-medium">Total:</span> {report.totalDays} jours
                            </div>
                            <div>
                              <span className="font-medium text-green-600">Présents:</span> {report.presentDays} jours
                            </div>
                            <div>
                              <span className="font-medium text-red-600">Absents:</span> {report.absentDays} jours
                            </div>
                          </div>
                          {report.reportUrl && (
                            <div className="text-sm text-gray-500">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
                                    await downloadFileWithAuth(report.reportUrl!);
                                  } catch (error) {
                                    console.error('Error viewing attendance report:', error);
                                    toast.error('Erreur lors de l\'ouverture du rapport');
                                  }
                                }}
                                className="text-emerald-600 hover:underline cursor-pointer"
                              >
                                Voir le rapport
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(report)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(report.id)}
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

