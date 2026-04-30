"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Label,
  Textarea,
  Alert,
  AlertDescription,
  Badge,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Clock,
  Users,
  BookOpen,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  Save,
} from "lucide-react";
import { useTeacherClasses } from "@/lib/hooks/use-classes";
import { useTeacherCourses } from "@/lib/hooks/use-courses";
import { useClassCourses } from "@/lib/hooks/use-class-courses";
import { useAssignments } from "@/lib/hooks/use-evaluations";

interface AssignmentInstanceData {
  assignment_id: string;
  class_id: string;
  starts_at?: string;
  ends_at: string;
  duration_minutes?: number;
  max_attempts?: number;
  shuffle_questions?: boolean;
  show_results_mode?: 'immediate' | 'after_end' | 'after_correction';
  late_submission_allowed?: boolean;
  late_penalty_percent?: number;
}

type Step = 'class' | 'course' | 'assignment' | 'config' | 'review';

export default function AssignAssignmentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>('class');

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));
    const isAdmin = Array.isArray(roles) && roles.some((r: string) => ['admin', 'Administrateur'].includes(r));

    if (!isTeacher && !isAdmin) {
      router.push('/');
    }
  }, [session, status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-16 w-16 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));
  const isAdmin = Array.isArray(roles) && roles.some((r: string) => ['admin', 'Administrateur'].includes(r));

  if (!isTeacher && !isAdmin) {
    return null;
  }
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');
  const [instanceData, setInstanceData] = useState<AssignmentInstanceData>({
    assignment_id: '',
    class_id: '',
    ends_at: '',
    show_results_mode: 'after_correction',
    late_submission_allowed: false,
    late_penalty_percent: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch data
  const { data: classesData, isLoading: classesLoading } = useTeacherClasses();
  const { data: classCoursesData, isLoading: classCoursesLoading } = useClassCourses(selectedClassId);
  const { data: teacherCoursesData } = useTeacherCourses(isTeacher ? "current-teacher" : undefined);
  const { data: assignmentsData, isLoading: assignmentsLoading } = useAssignments({
    course_id: selectedCourseId,
    limit: 100,
  });

  const classes = classesData?.data || [];
  const classCourses = classCoursesData?.data || [];
  const teacherCourses = Array.isArray(teacherCoursesData) ? teacherCoursesData : [];
  const teacherCourseIdsForSelectedClass = new Set(
    teacherCourses
      .filter((course: any) => course.classId === selectedClassId)
      .map((course: any) => course.courseId)
  );
  const availableClassCourses = isTeacher
    ? classCourses.filter((course: any) => teacherCourseIdsForSelectedClass.has(course.id))
    : classCourses;
  const assignments = useMemo(() => {
    const list = assignmentsData?.assignments || [];
    const published = list.filter((a: any) => a.status === 'published');
    const others = list.filter((a: any) => a.status !== 'published');
    return [...published, ...others];
  }, [assignmentsData]);

  // Get selected data
  const selectedClass = classes.find(c => c.id === selectedClassId);
  const selectedCourse = availableClassCourses.find(c => c.id === selectedCourseId);
  const selectedAssignment = assignments.find(a => a.id === selectedAssignmentId);

  const steps = [
    { id: 'class', title: 'Sélectionner la classe', icon: Users },
    { id: 'course', title: 'Choisir le cours', icon: BookOpen },
    { id: 'assignment', title: 'Choisir le devoir', icon: FileText },
    { id: 'config', title: 'Configuration', icon: Clock },
    { id: 'review', title: 'Validation', icon: CheckCircle },
  ];

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 'class': return selectedClassId !== '';
      case 'course': return selectedCourseId !== '';
      case 'assignment': return selectedAssignmentId !== '';
      case 'config': return instanceData.ends_at !== '';
      case 'review': return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (!canProceedToNextStep()) return;
    
    const nextStepIndex = currentStepIndex + 1;
    if (nextStepIndex < steps.length) {
      setCurrentStep(steps[nextStepIndex].id as Step);
    }
  };

  const handlePrevious = () => {
    const prevStepIndex = currentStepIndex - 1;
    if (prevStepIndex >= 0) {
      setCurrentStep(steps[prevStepIndex].id as Step);
    }
  };

  const handleClassSelect = (classId: string) => {
    setSelectedClassId(classId);
    setSelectedCourseId('');
    setSelectedAssignmentId('');
    setInstanceData(prev => ({ ...prev, class_id: classId }));
  };

  const handleCourseSelect = (courseId: string) => {
    setSelectedCourseId(courseId);
    setSelectedAssignmentId('');
  };

  const handleAssignmentSelect = (assignmentId: string) => {
    setSelectedAssignmentId(assignmentId);
    setInstanceData(prev => ({ ...prev, assignment_id: assignmentId }));
  };

  const validateConfiguration = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!instanceData.ends_at) {
      newErrors.ends_at = "La date de fin est requise";
    }

    if (instanceData.starts_at && instanceData.ends_at) {
      const startDate = new Date(instanceData.starts_at);
      const endDate = new Date(instanceData.ends_at);
      if (startDate >= endDate) {
        newErrors.starts_at = "La date de début doit être antérieure à la date de fin";
      }
    }

    if (instanceData.duration_minutes && instanceData.duration_minutes <= 0) {
      newErrors.duration_minutes = "La durée doit être positive";
    }

    if (instanceData.max_attempts && instanceData.max_attempts <= 0) {
      newErrors.max_attempts = "Le nombre de tentatives doit être positif";
    }

    if (instanceData.late_penalty_percent && (instanceData.late_penalty_percent < 0 || instanceData.late_penalty_percent > 100)) {
      newErrors.late_penalty_percent = "La pénalité doit être entre 0 et 100%";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateConfiguration()) return;

    setIsSubmitting(true);
    try {
      // Convert datetime-local format to ISO string format
      const processedData = {
        ...instanceData,
        ...(instanceData.starts_at ? { starts_at: new Date(instanceData.starts_at).toISOString() } : {}),
        ends_at: new Date(instanceData.ends_at).toISOString(),
      };

      const response = await fetch('/api/v1/assignment-instances', {
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
          // X-User-Id and X-Tenant will be automatically injected by fetch-interceptor from JWT
        },
        body: JSON.stringify(processedData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erreur lors de l\'assignation');
      }

      const result = await response.json();

      // Success - redirect to assignment instances page with success message
      router.push(`/academic/assignments/instances?success=assigned&instanceId=${result.id}`);
    } catch (error) {
      alert('Erreur lors de l\'assignation: ' + String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="sm" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center text-3xl font-bold text-foreground">
                <FileText className="w-8 h-8 text-purple-600 mr-3" />
                Assigner un devoir
              </h1>
              <p className="mt-2 text-muted-foreground">
                Assignez un devoir ou une évaluation existante à une classe
              </p>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="mb-8">
            <div className="relative">
              {/* Progress Line Background */}
              <div className="absolute top-6 left-0 right-0 h-0.5 bg-gray-300 dark:bg-gray-600 hidden sm:block" />
              {/* Progress Line Filled */}
              <div 
                className="absolute top-6 left-0 h-0.5 bg-green-600 transition-all duration-500 hidden sm:block"
                style={{ width: `${(currentStepIndex / (steps.length - 1)) * 100}%` }}
              />
              
              {/* Steps */}
              <div className="relative flex items-start justify-between">
                {steps.map((step, index) => {
                  const Icon = step.icon;
                  const isActive = step.id === currentStep;
                  const isCompleted = index < currentStepIndex;
                  
                  return (
                    <div key={step.id} className="flex flex-col items-center flex-1 relative z-10">
                      {/* Step Circle */}
                      <div className={`flex items-center justify-center w-12 h-12 rounded-full border-2 transition-all duration-300 ${
                        isActive 
                          ? 'border-purple-600 bg-purple-600 text-white shadow-lg shadow-purple-500/50 scale-110' 
                          : isCompleted 
                            ? 'border-green-600 bg-green-600 text-white shadow-md'
                          : 'border-border bg-card text-muted-foreground'
                      }`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      
                      {/* Step Title */}
                      <div className="mt-3 text-center max-w-[120px] sm:max-w-none">
                        <p className={`text-xs sm:text-sm font-medium leading-tight ${
                          isActive ? 'text-purple-600 dark:text-purple-400' : isCompleted ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
                        }`}>
                          {step.title}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <Card>
          <CardContent className="p-6">
            {/* Step 1: Class Selection */}
            {currentStep === 'class' && (
              <div className="space-y-6">
                <div>
                  <h2 className="mb-2 text-xl font-semibold text-foreground">Sélectionner une classe</h2>
                  <p className="text-muted-foreground">
                    Choisissez la classe à laquelle vous souhaitez assigner le devoir
                  </p>
                </div>

                {classesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {classes.map((classItem) => (
                      <Card
                        key={classItem.id}
                        className={`group cursor-pointer transition-all hover:shadow-md ${
                          selectedClassId === classItem.id
                            ? 'ring-2 ring-purple-600 bg-purple-500/10'
                            : 'hover:bg-muted/40'
                        }`}
                        onClick={() => handleClassSelect(classItem.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className={`font-medium ${selectedClassId === classItem.id ? 'text-foreground' : 'text-foreground/90'} group-hover:text-foreground`}>{classItem.name}</h3>
                              <p className="text-sm text-muted-foreground">
                                {classItem.code} • {classItem.studentCount || 0} étudiants
                              </p>
                            </div>
                            {selectedClassId === classItem.id && (
                              <CheckCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Course Selection */}
            {currentStep === 'course' && (
              <div className="space-y-6">
                <div>
                  <h2 className="mb-2 text-xl font-semibold text-foreground">Choisir un cours</h2>
                  <p className="text-muted-foreground">
                    Sélectionnez le cours pour lequel vous voulez assigner un devoir
                  </p>
                  {selectedClass && (
                    <Badge variant="outline" className="mt-2">
                      Classe: {selectedClass.name}
                    </Badge>
                  )}
                </div>

                {classCoursesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {availableClassCourses.map((course) => (
                      <Card
                        key={course.id}
                        className={`group cursor-pointer transition-all hover:shadow-md ${
                          selectedCourseId === course.id
                            ? 'ring-2 ring-purple-600 bg-purple-500/10'
                            : 'hover:bg-muted/40'
                        }`}
                        onClick={() => handleCourseSelect(course.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className={`font-medium ${selectedCourseId === course.id ? 'text-foreground' : 'text-foreground/90'} group-hover:text-foreground`}>{course.name}</h3>
                              <p className="text-sm text-muted-foreground">
                                {course.code} • {course.credits} crédits
                              </p>
                            </div>
                            {selectedCourseId === course.id && (
                              <CheckCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {availableClassCourses.length === 0 && !classCoursesLoading && selectedClassId && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Aucun cours trouvé pour cette classe pour cet enseignant. Vérifiez les affectations enseignant-classe-cours.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Step 3: Assignment Selection */}
            {currentStep === 'assignment' && (
              <div className="space-y-6">
                <div>
                  <h2 className="mb-2 text-xl font-semibold text-foreground">Choisir un devoir</h2>
                  <p className="text-muted-foreground">
                    Sélectionnez le devoir ou l'évaluation à assigner
                  </p>
                  <div className="flex gap-2 mt-2">
                    {selectedClass && (
                      <Badge variant="outline">Classe: {selectedClass.name}</Badge>
                    )}
                    {selectedCourse && (
                      <Badge variant="outline">Cours: {selectedCourse.name}</Badge>
                    )}
                  </div>
                </div>

                {assignmentsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {assignments.map((assignment) => (
                      <Card
                        key={assignment.id}
                        className={`group cursor-pointer transition-all hover:shadow-md ${
                          selectedAssignmentId === assignment.id
                            ? 'ring-2 ring-purple-600 bg-purple-500/10'
                            : 'hover:bg-muted/40'
                        }`}
                        onClick={() => handleAssignmentSelect(assignment.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className={`font-medium ${selectedAssignmentId === assignment.id ? 'text-foreground' : 'text-foreground/90'} group-hover:text-foreground`}>{assignment.title}</h3>
                                <Badge variant={assignment.type === 'evaluation' ? 'default' : 'secondary'}>
                                  {assignment.type === 'evaluation' ? 'Évaluation' : 'Devoir'}
                                </Badge>
                              </div>
                              {assignment.description && (
                                <p className="mb-2 text-sm text-muted-foreground">
                                  {assignment.description}
                                </p>
                              )}
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                {assignment.duration_minutes && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {assignment.duration_minutes} min
                                  </span>
                                )}
                                {assignment.max_attempts && (
                                  <span>{assignment.max_attempts} tentative(s)</span>
                                )}
                              </div>
                            </div>
                            {selectedAssignmentId === assignment.id && (
                              <CheckCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {assignments.length === 0 && !assignmentsLoading && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Aucun devoir trouvé pour ce cours. Créez d'abord un devoir ou une évaluation.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Step 4: Configuration */}
            {currentStep === 'config' && (
              <div className="space-y-6">
                <div>
                  <h2 className="mb-2 text-xl font-semibold text-foreground">Configuration de l'assignation</h2>
                  <p className="text-muted-foreground">
                    Définissez les paramètres spécifiques pour cette assignation
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Dates */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="starts_at">Date de début (optionnelle)</Label>
                      <Input
                        id="starts_at"
                        type="datetime-local"
                        value={instanceData.starts_at || ''}
                        onChange={(e) => setInstanceData(prev => ({ ...prev, starts_at: e.target.value }))}
                      />
                      {errors.starts_at && (
                        <p className="text-xs text-red-600">{errors.starts_at}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ends_at">Date de fin *</Label>
                      <Input
                        id="ends_at"
                        type="datetime-local"
                        value={instanceData.ends_at}
                        onChange={(e) => setInstanceData(prev => ({ ...prev, ends_at: e.target.value }))}
                        required
                      />
                      {errors.ends_at && (
                        <p className="text-xs text-red-600">{errors.ends_at}</p>
                      )}
                    </div>
                  </div>

                  {/* Parameters */}
                  <div className="space-y-4">
                    {selectedAssignment?.type === 'evaluation' && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="duration_minutes">Durée (minutes)</Label>
                          <Input
                            id="duration_minutes"
                            type="number"
                            min="1"
                            value={instanceData.duration_minutes || selectedAssignment.duration_minutes || ''}
                            onChange={(e) => setInstanceData(prev => ({
                              ...prev,
                              duration_minutes: e.target.value ? parseInt(e.target.value) : undefined
                            }))}
                          />
                          {errors.duration_minutes && (
                            <p className="text-xs text-red-600">{errors.duration_minutes}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="max_attempts">Nombre de tentatives</Label>
                          <Input
                            id="max_attempts"
                            type="number"
                            min="1"
                            value={instanceData.max_attempts || selectedAssignment.max_attempts || ''}
                            onChange={(e) => setInstanceData(prev => ({
                              ...prev,
                              max_attempts: e.target.value ? parseInt(e.target.value) : undefined
                            }))}
                          />
                          {errors.max_attempts && (
                            <p className="text-xs text-red-600">{errors.max_attempts}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="show_results_mode">Affichage des résultats</Label>
                          <Select
                            value={instanceData.show_results_mode || 'after_correction'}
                            onValueChange={(value) => setInstanceData(prev => ({
                              ...prev,
                              show_results_mode: value as any
                            }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="immediate">Immédiatement</SelectItem>
                              <SelectItem value="after_end">Après la fin</SelectItem>
                              <SelectItem value="after_correction">Après correction</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="late_submission_allowed"
                          checked={instanceData.late_submission_allowed || false}
                          onChange={(e) => setInstanceData(prev => ({
                            ...prev,
                            late_submission_allowed: e.target.checked
                          }))}
                        />
                        <Label htmlFor="late_submission_allowed">Autoriser les soumissions tardives</Label>
                      </div>
                    </div>

                    {instanceData.late_submission_allowed && (
                      <div className="space-y-2">
                        <Label htmlFor="late_penalty_percent">Pénalité de retard (%)</Label>
                        <Input
                          id="late_penalty_percent"
                          type="number"
                          min="0"
                          max="100"
                          value={instanceData.late_penalty_percent || 0}
                          onChange={(e) => setInstanceData(prev => ({
                            ...prev,
                            late_penalty_percent: e.target.value ? parseFloat(e.target.value) : 0
                          }))}
                        />
                        {errors.late_penalty_percent && (
                          <p className="text-xs text-red-600">{errors.late_penalty_percent}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Review */}
            {currentStep === 'review' && (
              <div className="space-y-6">
                <div>
                  <h2 className="mb-2 text-xl font-semibold text-foreground">Validation de l'assignation</h2>
                  <p className="text-muted-foreground">
                    Vérifiez les informations avant de confirmer l'assignation
                  </p>
                </div>

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg text-foreground">Résumé de l'assignation</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="font-medium text-sm text-muted-foreground">CLASSE</h4>
                          <p className="font-medium">{selectedClass?.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {selectedClass?.studentCount || 0} étudiants
                          </p>
                        </div>
                        <div>
                          <h4 className="font-medium text-sm text-muted-foreground">COURS</h4>
                          <p className="font-medium">{selectedCourse?.name}</p>
                          <p className="text-sm text-muted-foreground">{selectedCourse?.code}</p>
                        </div>
                        <div>
                          <h4 className="font-medium text-sm text-muted-foreground">DEVOIR</h4>
                          <p className="font-medium">{selectedAssignment?.title}</p>
                          <Badge variant={selectedAssignment?.type === 'evaluation' ? 'default' : 'secondary'}>
                            {selectedAssignment?.type === 'evaluation' ? 'Évaluation' : 'Devoir'}
                          </Badge>
                        </div>
                        <div>
                          <h4 className="font-medium text-sm text-muted-foreground">PÉRIODE</h4>
                          {instanceData.starts_at && (
                            <p className="text-sm">Début: {formatDate(instanceData.starts_at)}</p>
                          )}
                          <p className="text-sm">Fin: {formatDate(instanceData.ends_at)}</p>
                        </div>
                      </div>

                      {(instanceData.duration_minutes || instanceData.max_attempts || instanceData.late_submission_allowed) && (
                        <div className="border-t pt-4">
                          <h4 className="font-medium text-sm text-muted-foreground mb-2">PARAMÈTRES SPÉCIFIQUES</h4>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            {instanceData.duration_minutes && (
                              <div>Durée: {instanceData.duration_minutes} minutes</div>
                            )}
                            {instanceData.max_attempts && (
                              <div>Tentatives: {instanceData.max_attempts}</div>
                            )}
                            {instanceData.late_submission_allowed && (
                              <div>Retards autorisés ({instanceData.late_penalty_percent}% pénalité)</div>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-6 border-t">
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={currentStepIndex === 0}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Précédent
              </Button>

              {currentStep === 'review' ? (
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Assignation...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Confirmer l'assignation
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleNext}
                  disabled={!canProceedToNextStep()}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  Suivant
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
