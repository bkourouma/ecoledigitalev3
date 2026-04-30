"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Save, FileText, Clock, Upload, X, Brain } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useCreateAssignment, type CreateAssignment } from "@/lib/hooks/use-evaluations";
import { useCourse, useCourses } from "@/lib/hooks/use-courses";
import { DocumentSelector } from "@/components/evaluations/DocumentSelector";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";



export default function CreateEvaluationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseId = searchParams.get('courseId');
  const { data: coursesData } = useCourses({});
  const hasLockedCourseFromUrl = Boolean(courseId);
  const { data: lockedCourseData } = useCourse(courseId || "");
  const createAssignmentMutation = useCreateAssignment();

  const [formData, setFormData] = useState<CreateAssignment>({
    course_id: courseId || "",
    title: "",
    description: "",
    type: "evaluation",
    creation_mode: "manual",
    evaluation_type: "online",

    // Evaluation defaults
    duration_minutes: 60,
    max_attempts: 1,
    shuffle_questions: false,
    show_results_mode: "after_correction",

    // Homework defaults
    max_file_size_mb: 10,
    late_submission_allowed: false,
    late_penalty_percent: 0,

    // AI evaluation defaults
    source_documents: [],
    ai_config: {
      mcq: 0,
      short_answer: 0,
      long_answer: 0,
      true_false: 0,
      difficulty: "medium"
    },
  });
  // Champ d'instructions IA optionnel
  const [aiInstructions, setAiInstructions] = useState<string>("");


  // Update course_id when courseId from URL changes - FIXED: Removed formData.course_id from dependencies
  useEffect(() => {
    const availableCourses = coursesData?.data || [];
    console.log('CourseId from URL:', courseId);
    console.log('Available courses:', availableCourses);
    console.log('Current formData.course_id:', formData.course_id);

    // Always set course_id if we have a courseId from URL, regardless of whether courses are loaded yet
    // This ensures the courseId is set even before courses finish loading
    if (courseId) {
      if (availableCourses.length > 0) {
        const courseExists = availableCourses.find((course: any) => course.id === courseId);
        console.log('Course exists check:', courseExists);
        console.log('Course ID to find:', courseId);
        console.log('Available course IDs:', availableCourses.map((c: any) => c.id));

        if (courseExists) {
          console.log('Setting course_id to:', courseId);
          setFormData(prev => {
            // Only update if the course_id is actually different to prevent unnecessary re-renders
            if (prev.course_id !== courseId) {
              return { ...prev, course_id: courseId };
            }
            return prev;
          });
        } else {
          console.log('Course not found in available courses:', courseId);
        }
      } else {
        // Courses not loaded yet, but still set the courseId to avoid it being empty
        console.log('Courses not loaded yet, pre-setting course_id to:', courseId);
        setFormData(prev => {
          if (prev.course_id !== courseId) {
            return { ...prev, course_id: courseId };
          }
          return prev;
        });
      }
    }
  }, [courseId, coursesData]); // FIXED: Removed formData.course_id from dependencies to break the infinite loop

  // Préremplir si l’URL force l’évaluation IA
  useEffect(() => {
    const evalType = searchParams.get('evaluation_type') || searchParams.get('evaluation');
    if (evalType && (evalType === 'ai_generated' || evalType === 'ai')) {
      setFormData(prev => ({
        ...prev,
        type: 'evaluation',
        evaluation_type: 'ai_generated',
        creation_mode: 'ai_generated',
        ai_config: {
          ...(prev.ai_config || {}),
          mcq: 7,
          short_answer: 3,
          long_answer: 3,
          true_false: 7,
          difficulty: prev.ai_config?.difficulty || 'medium',
        },
      }));
    }
  }, [searchParams]);

  // Pré-sélectionner le type d'évaluation basé sur le paramètre URL - FIXED: Removed formData.evaluation_type from dependencies
  useEffect(() => {
    const evalType = searchParams.get('evaluation_type');

    if (evalType) {
      let evaluationType = '';
      let assignmentType = 'evaluation'; // Default type

      switch (evalType) {
        case 'online':
          evaluationType = 'online';
          assignmentType = 'evaluation';
          break;
        case 'pdf':
          evaluationType = 'pdf'; // Use 'pdf' to match database enum
          assignmentType = 'homework'; // PDF evaluations are homework type
          // Also set contentType to "pdf" for PDF evaluations
          setContentType("pdf");
          break;
        case 'ai_generated':
        case 'ai':
          evaluationType = 'ai_generated';
          assignmentType = 'evaluation';
          break;
        default:
          evaluationType = evalType;
      }

      if (evaluationType) {
        setFormData(prev => {
          // Only update if the evaluation_type is actually different to prevent unnecessary re-renders
          if (prev.evaluation_type !== evaluationType || prev.type !== assignmentType) {
            return {
              ...prev,
              evaluation_type: evaluationType,
              type: assignmentType,
              creation_mode: 'manual'
            };
          }
          return prev;
        });
      }
    }
  }, [searchParams]); // FIXED: Removed formData.evaluation_type from dependencies to prevent infinite loop

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [contentType, setContentType] = useState<"text" | "pdf">("text");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const courses = coursesData?.data || [];
  const availableCourses = useMemo(
    () => (hasLockedCourseFromUrl ? courses.filter((course: any) => course.id === courseId) : courses),
    [hasLockedCourseFromUrl, courses, courseId]
  );
  const normalizedLockedCourse = useMemo(() => {
    const raw = (lockedCourseData as any)?.data ?? lockedCourseData;
    if (!raw) return null;
    return {
      id: raw.id || raw.courseId || "",
      name: raw.name || raw.courseName || "Cours sélectionné",
      code: raw.code || raw.courseCode || "",
    };
  }, [lockedCourseData]);
  const lockedCourse = useMemo(
    () => courses.find((course: any) => course.id === courseId) || normalizedLockedCourse,
    [courses, courseId, normalizedLockedCourse]
  );

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        setErrors(prev => ({ ...prev, subject_document: "Seuls les fichiers PDF sont acceptés" }));
        return;
      }
      if (file.size > 50 * 1024 * 1024) { // 50MB limit
        setErrors(prev => ({ ...prev, subject_document: "Le fichier ne doit pas dépasser 50MB" }));
        return;
      }
      setSelectedFile(file);
      setErrors(prev => ({ ...prev, subject_document: "" }));
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setErrors(prev => ({ ...prev, subject_document: "" }));
  };

  const getErrorMessage = async (response: Response, fallback: string) => {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const errorData = await response.json().catch(() => null);

      if (errorData?.message) return errorData.message;
      if (errorData?.error) return errorData.error;
      if (errorData?.details) return errorData.details;
    }

    const errorText = await response.text().catch(() => "");
    return errorText || fallback;
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.course_id) {
      newErrors.course_id = "Veuillez sélectionner un cours";
    }
    if (!formData.title.trim()) {
      newErrors.title = "Le titre est requis";
    }

    if (formData.type === "evaluation" && formData.evaluation_type !== "ai_generated") {
      if (!formData.duration_minutes || formData.duration_minutes <= 0) {
        newErrors.duration_minutes = "La durée doit être supérieure à 0";
      }
    }

    if (formData.type === "homework") {
      if (contentType === "text") {
        if (!formData.subject_content?.trim()) {
          newErrors.subject_content = "Le contenu du sujet est requis";
        }
      } else if (contentType === "pdf") {
        if (!selectedFile && !formData.subject_document_url) {
          newErrors.subject_document = "Veuillez sélectionner un fichier PDF";
        }
      }
    }

    if (formData.evaluation_type === "ai_generated") {
      if (!formData.source_documents || formData.source_documents.length === 0) {
        newErrors.source_documents = "Veuillez sélectionner au moins un document source";
      }

      const totalQuestions = (formData.ai_config?.mcq || 0) +
                            (formData.ai_config?.short_answer || 0) +
                            (formData.ai_config?.long_answer || 0) +
                            (formData.ai_config?.true_false || 0);

      if (totalQuestions === 0) {
        newErrors.ai_config = "Veuillez spécifier au moins un type de question";
      }

      if (totalQuestions > 50) {
        newErrors.ai_config = "Maximum 50 questions peuvent être générées à la fois";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      let assignment;

      // Use different endpoint for AI evaluations
      if (formData.evaluation_type === 'ai_generated') {
        // Prepare AI evaluation specific payload
        const aiEvaluationData = {
          course_id: formData.course_id,
          title: formData.title,
          description: formData.description,
          source_documents: formData.source_documents || [],
          ai_config: formData.ai_config || {
            mcq: 0,
            short_answer: 0,
            long_answer: 0,
            true_false: 0,
            difficulty: 'medium'
          },
          duration_minutes: formData.duration_minutes,
          // Only include starts_at if it's set and properly formatted
          ...(formData.starts_at && formData.starts_at.trim() !== '' ? {
            starts_at: new Date(formData.starts_at).toISOString()
          } : {}),
          ...(formData.ends_at ? { ends_at: new Date(formData.ends_at).toISOString() } : {}),
          max_attempts: formData.max_attempts || 1,
          shuffle_questions: formData.shuffle_questions || false,
          show_results_mode: formData.show_results_mode || 'after_correction',
        };

        console.log('Sending AI evaluation data:', aiEvaluationData);
        console.log('Form data before processing:', formData);

        // Validate required fields for AI evaluation
        if (!aiEvaluationData.course_id) {
          throw new Error('Course ID is required');
        }
        if (!aiEvaluationData.source_documents || aiEvaluationData.source_documents.length === 0) {
          throw new Error('At least one source document must be selected');
        }
        if (!aiEvaluationData.ai_config || !aiEvaluationData.ai_config.difficulty) {
          throw new Error('AI configuration is required');
        }

        const totalQuestions = (aiEvaluationData.ai_config.mcq || 0) +
                              (aiEvaluationData.ai_config.short_answer || 0) +
                              (aiEvaluationData.ai_config.long_answer || 0) +
                              (aiEvaluationData.ai_config.true_false || 0);

        if (totalQuestions === 0) {
          throw new Error('At least one question type must be specified with a count > 0');
        }

        const response = await fetch('/api/v1/assignments/ai-evaluation', {
          method: 'POST',
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...aiEvaluationData,
            // Stocker aussi dans settings pour réutilisation côté backend (ex: génération asynchrone)
            settings: { ...(aiEvaluationData as any).settings, ai_instructions: aiInstructions },
          }),
        });

        if (!response.ok) {
          const errorMessage = await getErrorMessage(response, 'Failed to create AI evaluation');
          console.error('AI evaluation creation failed:', errorMessage);
          console.error('Response status:', response.status);
          console.error('Response headers:', Object.fromEntries(response.headers.entries()));

          throw new Error(`${errorMessage} (Status: ${response.status})`);
        }

        assignment = await response.json();
      } else {
        // Use regular assignment creation for other types
        assignment = await createAssignmentMutation.mutateAsync(formData);
      }

      // Then upload PDF file if selected
      if (selectedFile && contentType === "pdf") {
        console.log("Uploading PDF file:", selectedFile.name);

        try {
          const uploadFormData = new FormData();
          // Append fields BEFORE the file so fastify multipart sees fields via data.fields
          uploadFormData.append('assignmentId', assignment.id);
          uploadFormData.append('documentType', 'subject_document');
          uploadFormData.append('file', selectedFile);

          console.log("📋 FormData contents:");
          console.log("   Assignment ID:", assignment.id);
          console.log("   Document Type: subject_document");
          console.log("   File:", selectedFile.name, selectedFile.type, selectedFile.size);

          const uploadResponse = await fetch('/api/v1/assignments/upload-document', {
            method: 'POST',
            body: uploadFormData,
          });

          if (!uploadResponse.ok) {
            const errorData = await uploadResponse.text();
            console.error("Upload error:", errorData);
            throw new Error(`Échec du téléchargement du fichier: ${uploadResponse.status}`);
          }

          const uploadResult = await uploadResponse.json();
          console.log("File uploaded successfully:", uploadResult);

          // Show success message to user
          alert(`✅ Évaluation créée avec succès!\nFichier PDF téléchargé: ${uploadResult.originalName}`);
        } catch (uploadError) {
          console.error("File upload failed:", uploadError);
          // Show error but don't fail the whole process since assignment was created
          alert(`⚠️ Évaluation créée mais échec du téléchargement du fichier: ${uploadError.message}\nVous pouvez réessayer plus tard.`);
        }
      } else if (formData.evaluation_type === 'ai_generated') {
        // Show success message for AI evaluations
        alert("✅ Évaluation IA créée avec succès! La génération des questions est en cours...");
      } else {
        // Show success message for other assignments
        alert("✅ Évaluation créée avec succès!");
      }
      // Always redirect to the newly created evaluation details page
      router.push(`/academic/evaluations/${assignment.id}`);
    } catch (error) {
      alert('Erreur lors de la création: ' + String(error));
    }
  };

  const isEvaluation = formData.type === "evaluation";
  const isHomework = formData.type === "homework";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={courseId ? `/academic/courses/${courseId}` : "/academic/evaluations"}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            Créer une évaluation
          </h2>
          <p className="text-muted-foreground">
            Créez une nouvelle évaluation en ligne, un devoir PDF, ou générez-la avec l'IA
          </p>
        </div>
      </div>
      <form id="create-eval-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Informations générales
            </CardTitle>
            <CardDescription>
              Définissez les informations de base de votre évaluation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Type Selection - Tile style */}
            <div className="space-y-3">
              <Label>Type d'évaluation</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { key: 'online', title: "En ligne (QCM)", desc: "Questions interactives", color: 'from-green-500 to-emerald-600' },
                  { key: 'pdf', title: "Devoir PDF", desc: "Sujet au format PDF", color: 'from-blue-500 to-cyan-600' },
                  { key: 'ai_generated', title: "Évaluation IA", desc: "Génération automatique", color: 'from-purple-500 to-pink-600' },
                ].map((opt) => {
                  const isActive = (formData.evaluation_type || (formData.type === 'homework' ? 'pdf' : 'online')) === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        if (opt.key === 'ai_generated') {
                          handleInputChange("type", "evaluation");
                          handleInputChange("evaluation_type", "ai_generated");
                          handleInputChange("creation_mode", "ai_generated");
                          // Valeurs par défaut souhaitées pour la génération IA
                          handleInputChange("ai_config", {
                            ...(formData.ai_config || {}),
                            mcq: 7,
                            short_answer: 3,
                            long_answer: 3,
                            true_false: 7,
                            difficulty: formData.ai_config?.difficulty || 'medium',
                          });
                        } else if (opt.key === 'pdf') {
                          handleInputChange("type", "homework");
                          handleInputChange("evaluation_type", "pdf");
                          handleInputChange("creation_mode", "manual");
                          // Also set contentType to "pdf" for PDF evaluations
                          setContentType("pdf");
                        } else {
                          handleInputChange("type", "evaluation");
                          handleInputChange("evaluation_type", "online");
                          handleInputChange("creation_mode", "manual");
                        }
                      }}
                      className={`text-left rounded-lg border transition p-4 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary ${isActive ? 'border-primary ring-1 ring-primary' : 'border-border'} `}
                    >
                      <div className={`h-1.5 w-10 rounded-full bg-gradient-to-r ${opt.color} mb-3`} />
                      <p className="font-medium">{opt.title}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Two-column form layout on md+ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="course_id">Cours *</Label>
                {hasLockedCourseFromUrl ? (
                  <>
                    <Input
                      value={
                        lockedCourse
                          ? `${lockedCourse.name} (${lockedCourse.code})`
                          : formData.course_id
                            ? "Chargement du cours sélectionné..."
                            : "Chargement du cours sélectionné..."
                      }
                      readOnly
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      Cours verrouillé depuis la sélection précédente.
                    </p>
                  </>
                ) : (
                  <Select
                    key={`course-select-${availableCourses.length}`}
                    value={formData.course_id || undefined}
                    onValueChange={(value) => {
                      console.log('Course selected:', value);
                      handleInputChange("course_id", value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un cours" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCourses.map((course: any) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name} ({course.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {errors.course_id && <p className="text-xs text-red-600 border border-red-200 bg-red-50/40 rounded px-2 py-1 mt-1">{errors.course_id}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Titre *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleInputChange("title", e.target.value)}
                  placeholder="Ex: Quiz JavaScript - Chapitre 3"
                />
                {errors.title && <p className="text-xs text-red-600 border border-red-200 bg-red-50/40 rounded px-2 py-1 mt-1">{errors.title}</p>}
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleInputChange("description", e.target.value)}
                  placeholder="Description de l'évaluation..."
                  rows={3}
                />
              </div>

              {/* Scheduling removed: handled when assigning to a class */}
            </div>
          </CardContent>
        </Card>

        {/* Evaluation-specific settings */}
        {isEvaluation && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Paramètres de l'évaluation
              </CardTitle>
              <CardDescription>
                Configurez les paramètres spécifiques à l'évaluation en ligne
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              {/* Duration */}
              <div className="space-y-2 md:col-span-1">
                <Label htmlFor="duration_minutes">Durée (en minutes) *</Label>
                <Input
                  id="duration_minutes"
                  type="number"
                  min="1"
                  value={formData.duration_minutes || ""}
                  onChange={(e) => handleInputChange("duration_minutes", parseInt(e.target.value))}
                  placeholder="60"
                />
                {errors.duration_minutes && <p className="text-xs text-red-600 border border-red-200 bg-red-50/40 rounded px-2 py-1 mt-1">{errors.duration_minutes}</p>}
              </div>

              {/* Max Attempts */}
              <div className="space-y-2 md:col-span-1">
                <Label htmlFor="max_attempts">Nombre de tentatives autorisées</Label>
                <Input
                  id="max_attempts"
                  type="number"
                  min="1"
                  value={formData.max_attempts}
                  onChange={(e) => handleInputChange("max_attempts", parseInt(e.target.value))}
                />
              </div>

              {/* Shuffle Questions */}
              <div className="flex items-center space-x-2 md:col-span-1">
                <Switch
                  id="shuffle_questions"
                  checked={formData.shuffle_questions}
                  onCheckedChange={(checked) => handleInputChange("shuffle_questions", checked)}
                />
                <Label htmlFor="shuffle_questions">Mélanger les questions</Label>
              </div>

              {/* Show Results Mode */}
              <div className="space-y-2 md:col-span-1">
                <Label>Affichage des résultats</Label>
                <Select
                  value={formData.show_results_mode}
                  onValueChange={(value) => handleInputChange("show_results_mode", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">Immédiatement après soumission</SelectItem>
                    <SelectItem value="after_end">Après la fin de l'évaluation</SelectItem>
                    <SelectItem value="after_correction">Après correction manuelle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Homework-specific settings */}
        {isHomework && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Paramètres du devoir
              </CardTitle>
              <CardDescription>
                Configurez les paramètres spécifiques au devoir PDF
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Subject Content Type Selection */}
              <div className="space-y-4">
                <Label>Type de contenu du sujet *</Label>
                <RadioGroup
                  value={contentType}
                  onValueChange={(value: "text" | "pdf") => setContentType(value)}
                  className="flex gap-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="text" id="content-text" />
                    <Label htmlFor="content-text" className="cursor-pointer">
                      Texte descriptif
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="pdf" id="content-pdf" />
                    <Label htmlFor="content-pdf" className="cursor-pointer">
                      Document PDF
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Text Content */}
              {contentType === "text" && (
                <div className="space-y-2">
                  <Label htmlFor="subject_content">Description du sujet *</Label>
                  <Textarea
                    id="subject_content"
                    value={formData.subject_content || ""}
                    onChange={(e) => handleInputChange("subject_content", e.target.value)}
                    placeholder="Décrivez le sujet du devoir..."
                    rows={6}
                  />
                  {errors.subject_content && <p className="text-xs text-red-600 border border-red-200 bg-red-50/40 rounded px-2 py-1 mt-1">{errors.subject_content}</p>}
                </div>
              )}

              {/* PDF Upload */}
              {contentType === "pdf" && (
                <div className="space-y-2">
                  <Label htmlFor="pdf-upload">Document PDF du sujet *</Label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                    {!selectedFile ? (
                      <div className="text-center">
                        <Upload className="mx-auto h-12 w-12 text-gray-400" />
                        <div className="mt-4">
                          <Label htmlFor="pdf-upload" className="cursor-pointer">
                            <span className="mt-2 block text-sm font-medium text-white">
                              Cliquez pour sélectionner un fichier PDF
                            </span>
                            <span className="mt-1 block text-xs text-gray-500">
                              PDF jusqu'à 50MB
                            </span>
                          </Label>
                          <Input
                            id="pdf-upload"
                            type="file"
                            accept=".pdf"
                            onChange={handleFileSelect}
                            className="hidden"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-md p-4">
                        <div className="flex items-center gap-3">
                          <FileText className="h-8 w-8 text-blue-600" />
                          <div>
                            <p className="font-medium text-blue-800">{selectedFile.name}</p>
                            <p className="text-sm text-blue-600">
                              {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleRemoveFile}
                          className="text-red-600 hover:text-red-800"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {errors.subject_document && <p className="text-xs text-red-600 border border-red-200 bg-red-50/40 rounded px-2 py-1 mt-1">{errors.subject_document}</p>}
                </div>
              )}

              {/* Max File Size */}
              <div className="space-y-2">
                <Label htmlFor="max_file_size_mb">Taille maximale du fichier (MB)</Label>
                <Input
                  id="max_file_size_mb"
                  type="number"
                  min="1"
                  max="100"
                  value={formData.max_file_size_mb}
                  onChange={(e) => handleInputChange("max_file_size_mb", parseInt(e.target.value))}
                />
              </div>

              {/* Late Submission */}
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="late_submission_allowed"
                    checked={formData.late_submission_allowed}
                    onCheckedChange={(checked) => handleInputChange("late_submission_allowed", checked)}
                  />
                  <Label htmlFor="late_submission_allowed">Autoriser les soumissions en retard</Label>
                </div>

                {formData.late_submission_allowed && (
                  <div className="space-y-2">
                    <Label htmlFor="late_penalty_percent">Pénalité pour retard (%)</Label>
                    <Input
                      id="late_penalty_percent"
                      type="number"
                      min="0"
                      max="100"
                      value={formData.late_penalty_percent}
                      onChange={(e) => handleInputChange("late_penalty_percent", parseInt(e.target.value))}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Evaluation-specific settings */}
        {formData.evaluation_type === 'ai_generated' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Configuration de l'évaluation IA
              </CardTitle>
              <CardDescription>
                Sélectionnez les documents et configurez la génération automatique de questions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Document Selection */}
              <div className="space-y-4">
                <Label>Documents source *</Label>
                <DocumentSelector
                  courseId={formData.course_id}
                  selectedDocuments={formData.source_documents || []}
                  onSelectionChange={(documentIds) => handleInputChange("source_documents", documentIds)}
                />
                {errors.source_documents && (
                  <p className="text-xs text-red-600 border border-red-200 bg-red-50/40 rounded px-2 py-1 mt-1">{errors.source_documents}</p>
                )}
              </div>

              {/* Question Configuration */}
              <div className="space-y-4">
                <Label>Configuration des questions</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="mcq_count">Questions à choix multiples (QCM)</Label>
                    <Input
                      id="mcq_count"
                      type="number"
                      min="0"
                      max="20"
                      value={formData.ai_config?.mcq || 0}
                      onChange={(e) => handleInputChange("ai_config", {
                        ...formData.ai_config,
                        mcq: parseInt(e.target.value) || 0
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="short_answer_count">Questions à réponse courte</Label>
                    <Input
                      id="short_answer_count"
                      type="number"
                      min="0"
                      max="10"
                      value={formData.ai_config?.short_answer || 0}
                      onChange={(e) => handleInputChange("ai_config", {
                        ...formData.ai_config,
                        short_answer: parseInt(e.target.value) || 0
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="long_answer_count">Questions à développement</Label>
                    <Input
                      id="long_answer_count"
                      type="number"
                      min="0"
                      max="5"
                      value={formData.ai_config?.long_answer || 0}
                      onChange={(e) => handleInputChange("ai_config", {
                        ...formData.ai_config,
                        long_answer: parseInt(e.target.value) || 0
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="true_false_count">Questions Vrai/Faux</Label>
                    <Input
                      id="true_false_count"
                      type="number"
                      min="0"
                      max="10"
                      value={formData.ai_config?.true_false || 0}
                      onChange={(e) => handleInputChange("ai_config", {
                        ...formData.ai_config,
                        true_false: parseInt(e.target.value) || 0
                      })}
                    />
                  </div>
                </div>

                  {/* Instructions IA */}
                  <div className="space-y-2">
                    <Label htmlFor="ai_instructions">Instructions pour l’IA (optionnel)</Label>
                    <Textarea
                      id="ai_instructions"
                      placeholder="Ex.: Utilise uniquement les chapitres 1 à 5; Ajoute plus de questions sur les boucles; Évite les sujets non couverts en cours, etc."
                      value={aiInstructions}
                      onChange={(e) => setAiInstructions(e.target.value)}
                      className="min-h-24"
                    />
                    <p className="text-xs text-muted-foreground">Ces instructions seront ajoutées au prompt et priment sur les consignes par défaut.</p>
                  </div>

              </div>

              {/* Difficulty Level */}
              <div className="space-y-2">
                <Label>Niveau de difficulté</Label>
                <RadioGroup
                  value={formData.ai_config?.difficulty || 'medium'}
                  onValueChange={(value) => handleInputChange("ai_config", {
                    ...formData.ai_config,
                    difficulty: value
                  })}
                  className="flex gap-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="easy" id="difficulty-easy" />
                    <Label htmlFor="difficulty-easy">Facile</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="medium" id="difficulty-medium" />
                    <Label htmlFor="difficulty-medium">Moyen</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="hard" id="difficulty-hard" />
                    <Label htmlFor="difficulty-hard">Difficile</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Total Questions Display */}
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <p className="text-sm text-blue-800">
                  <strong>Total de questions à générer:</strong> {
                    (formData.ai_config?.mcq || 0) +
                    (formData.ai_config?.short_answer || 0) +
                    (formData.ai_config?.long_answer || 0) +
                    (formData.ai_config?.true_false || 0)
                  }
                </p>
                {((formData.ai_config?.mcq || 0) +
                  (formData.ai_config?.short_answer || 0) +
                  (formData.ai_config?.long_answer || 0) +
                  (formData.ai_config?.true_false || 0)) === 0 && (
                  <p className="text-xs text-red-600 border border-red-200 bg-red-50/40 rounded px-2 py-1 mt-1">
                    Veuillez spécifier au moins un type de question
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Link href="/academic/evaluations">
            <Button variant="outline">Annuler</Button>
          </Link>
          <Button type="submit" disabled={createAssignmentMutation.isPending}>
            {createAssignmentMutation.isPending ? (
              <>Création en cours...</>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Créer l'évaluation
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
