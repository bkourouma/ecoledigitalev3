"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
} from "@ecoledigitale/ui";
import { Loader2, FileText } from "lucide-react";
import { ReportCard, CreateReportCard, UpdateReportCard } from "@/lib/hooks/use-report-cards";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useStudents } from "@/lib/hooks/use-students";
import { useClasses } from "@/lib/hooks/use-classes";
import { useEnrollments } from "@/lib/hooks/use-enrollments";
import toast from "react-hot-toast";

const reportCardFormSchema = z.object({
  studentId: z.string().min(1, "L'étudiant est requis"),
  academicYearId: z.string().min(1, "L'année académique est requise"),
  semester: z.number().int().min(1).max(8, "Le semestre doit être entre 1 et 8"),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  overallGrade: z.number().min(0).max(20, "La note doit être entre 0 et 20"),
  reportUrl: z.string().optional(),
  downloadable: z.boolean().optional(),
  viewable: z.boolean().optional(),
});

type ReportCardFormData = z.infer<typeof reportCardFormSchema>;

interface ReportCardFormProps {
  reportCard?: ReportCard;
  onSubmit: (data: ReportCardFormData, file?: File) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  isEdit?: boolean;
}

export function ReportCardForm({ 
  reportCard, 
  onSubmit, 
  onCancel, 
  isLoading = false,
  isEdit = false 
}: ReportCardFormProps) {
  const { data: academicYearsData } = useAcademicYears();
  const { data: studentsData } = useStudents({ status: 'active', limit: 1000 });
  const { data: classesData } = useClasses({ includeDetails: true });
  const academicYears = academicYearsData?.data || [];
  const students = studentsData?.data || [];
  const classes = classesData?.data || [];
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  
  // Fetch students for selected class
  const { data: enrollmentsData, isLoading: isLoadingEnrollments } = useEnrollments(
    selectedClassId ? {
      classId: selectedClassId,
      limit: 100  // API limit is 100
    } : {}
  );
  
  // Extract students from enrollments
  const classStudents = React.useMemo(() => {
    if (!selectedClassId) {
      return [];
    }
    
    if (!enrollmentsData?.data || !Array.isArray(enrollmentsData.data)) {
      return [];
    }
    
    const studentsMap = new Map();
    
    enrollmentsData.data.forEach((enrollment: any) => {
      // Check if student data exists
      if (enrollment.student && enrollment.student.id) {
        const studentId = enrollment.student.id;
        
        // Only add if not already in map (to avoid duplicates)
        if (!studentsMap.has(studentId)) {
          studentsMap.set(studentId, {
            id: studentId,
            user: {
              firstName: enrollment.student.firstName || '',
              lastName: enrollment.student.lastName || '',
              name: enrollment.student.firstName && enrollment.student.lastName
                ? `${enrollment.student.firstName} ${enrollment.student.lastName}`
                : enrollment.student.email || `Étudiant ${studentId.slice(0, 8)}`,
              email: enrollment.student.email || ''
            },
            studentNumber: enrollment.student.studentNumber || ''
          });
        }
      } else if (enrollment.studentId) {
        // Fallback if student object is not populated
        const studentId = enrollment.studentId;
        if (!studentsMap.has(studentId)) {
          studentsMap.set(studentId, {
            id: studentId,
            user: {
              firstName: '',
              lastName: '',
              name: `Étudiant ${studentId.slice(0, 8)}`,
              email: ''
            },
            studentNumber: ''
          });
        }
      }
    });
    
    return Array.from(studentsMap.values());
  }, [enrollmentsData, selectedClassId]);
  
  // Use class students if a class is selected, otherwise use all students
  const availableStudents = selectedClassId ? classStudents : students;

  const form = useForm<ReportCardFormData>({
    resolver: zodResolver(reportCardFormSchema),
    defaultValues: {
      studentId: reportCard?.studentId || "",
      academicYearId: reportCard?.academicYearId || "",
      semester: reportCard?.semester || 1,
      reportDate: reportCard?.reportDate ? reportCard.reportDate.slice(0, 10) : "",
      overallGrade: reportCard?.overallGrade || 0,
      reportUrl: reportCard?.reportUrl || "",
      downloadable: reportCard?.downloadable ?? true,
      viewable: reportCard?.viewable ?? true,
    },
  });
  
  // Reset student selection when class changes
  useEffect(() => {
    if (selectedClassId) {
      form.setValue("studentId", "");
    }
  }, [selectedClassId, form]);

  // Update form when reportCard changes (for edit mode)
  useEffect(() => {
    if (isEdit && reportCard) {
      form.reset({
        studentId: reportCard.studentId || "",
        academicYearId: reportCard.academicYearId || "",
        semester: reportCard.semester || 1,
        reportDate: reportCard.reportDate ? reportCard.reportDate.slice(0, 10) : "",
        overallGrade: reportCard.overallGrade || 0,
        reportUrl: reportCard.reportUrl || "",
        downloadable: reportCard.downloadable ?? true,
        viewable: reportCard.viewable ?? true,
      }, {
        keepDefaultValues: false,
      });
      setSelectedFile(null);
    }
  }, [isEdit, reportCard, form]);

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

      const response = await fetch('/api/v1/report-cards/upload', {
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

  const handleSubmit = async (data: ReportCardFormData) => {
    try {
      let fileUrl = data.reportUrl;

      // Upload file if a new file is selected
      if (selectedFile) {
        try {
          fileUrl = await handleFileUpload(selectedFile);
          toast.success('Fichier téléchargé avec succès');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Erreur lors du téléchargement du fichier';
          console.error('File upload failed:', error);
          toast.error(errorMessage);
          return;
        }
      } else if (!isEdit && !fileUrl) {
        // Require file for new report cards
        toast.error('Veuillez sélectionner un fichier PDF pour le bulletin');
        return;
      }

      // Update form data with file URL
      const submitData: ReportCardFormData = {
        ...data,
        reportUrl: fileUrl || undefined,
      };

      await onSubmit(submitData, selectedFile || undefined);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert("Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Class Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Classe *
          </label>
          <Select onValueChange={setSelectedClassId} value={selectedClassId}>
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner une classe" />
            </SelectTrigger>
            <SelectContent side="bottom" sideOffset={4} position="item-aligned">
              {classes.length > 0 ? (
                classes.map((classItem: any) => (
                  <SelectItem key={classItem.id} value={classItem.id}>
                    {classItem.name} {classItem.code ? `(${classItem.code})` : ''}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="no-class" disabled>
                  Aucune classe disponible
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="studentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Étudiant *</FormLabel>
                <Select 
                  onValueChange={field.onChange} 
                  value={field.value}
                  disabled={!selectedClassId}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={selectedClassId ? "Sélectionner un étudiant" : "Sélectionnez d'abord une classe"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {isLoadingEnrollments && selectedClassId ? (
                      <SelectItem value="loading" disabled>
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Chargement des étudiants...
                        </div>
                      </SelectItem>
                    ) : availableStudents.length > 0 ? (
                      availableStudents.map((student: any) => (
                        <SelectItem key={student.id} value={student.id}>
                          {student.user?.firstName && student.user?.lastName
                            ? `${student.user.firstName} ${student.user.lastName}`
                            : student.user?.name || `Étudiant ${student.studentNumber || student.id.slice(0, 8)}`}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="no-student" disabled>
                        {selectedClassId 
                          ? (isLoadingEnrollments ? "Chargement..." : "Aucun étudiant dans cette classe")
                          : "Sélectionnez d'abord une classe"}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="academicYearId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Année Académique *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une année académique" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {academicYears.length > 0 ? (
                      academicYears.map((year) => (
                        <SelectItem key={year.id} value={year.id}>
                          {year.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="no-year" disabled>
                        Aucune année académique disponible
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="semester"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Semestre *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    max="8"
                    placeholder="1-8"
                    {...field}
                    value={field.value || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      field.onChange(value === "" ? undefined : parseInt(value, 10));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="reportDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date du bulletin *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="overallGrade"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Note générale (sur 20) *</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  max="20"
                  step="0.01"
                  placeholder="Ex: 15.5"
                  {...field}
                  value={field.value || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    field.onChange(value === "" ? undefined : parseFloat(value));
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="reportUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Fichier du bulletin (PDF) {!isEdit && "*"}</FormLabel>
              <FormControl>
                <div className="space-y-2">
                  <Input
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
                        field.onChange('');
                      }
                    }}
                    disabled={uploadingFile || isLoading}
                  />
                  {selectedFile && (
                    <div className="flex items-center gap-2 text-sm text-foreground/80">
                      <FileText className="h-4 w-4" />
                      <span>{selectedFile.name}</span>
                      <span className="text-foreground/60">
                        ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                      </span>
                    </div>
                  )}
                  {isEdit && reportCard?.reportUrl && !selectedFile && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600">
                      <FileText className="h-4 w-4" />
                      <span>Fichier actuel: </span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
                            await downloadFileWithAuth(reportCard.reportUrl!);
                          } catch (error) {
                            console.error('Error viewing report card:', error);
                            toast.error('Erreur lors de l\'ouverture du bulletin');
                          }
                        }}
                        className="underline hover:text-emerald-700 cursor-pointer"
                      >
                        Voir le bulletin
                      </button>
                    </div>
                  )}
                  {uploadingFile && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-foreground/80">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Téléchargement en cours... {uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </FormControl>
              <p className="text-xs text-foreground/60">
                Téléchargez un fichier PDF du bulletin (max 10MB). Si vous ne téléchargez pas de nouveau fichier lors de la modification, le fichier actuel sera conservé.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="downloadable"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className="cursor-pointer">Téléchargeable</FormLabel>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="viewable"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className="cursor-pointer">Visualisable</FormLabel>
              </FormItem>
            )}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading || uploadingFile}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isLoading || uploadingFile}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 flex items-center gap-2"
          >
            {(isLoading || uploadingFile) && <Loader2 className="h-4 w-4 animate-spin" />}
            {uploadingFile ? 'Téléchargement...' : isEdit ? "Modifier" : "Créer"}
          </button>
        </div>
      </form>
    </Form>
  );
}

