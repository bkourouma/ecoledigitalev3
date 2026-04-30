"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  BookOpen,
  ArrowRight,
  Brain,
  Loader2,
  ArrowLeft,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Alert, AlertDescription } from "@ecoledigitale/ui";
import { useTeacherCourses } from '@/lib/hooks/use-courses';
import { useCurrentTeacherId } from '@/lib/hooks/use-current-teacher';

export default function CreateAssignmentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [evaluationType, setEvaluationType] = useState<'online' | 'pdf' | 'ai_generated'>('online');

  // Get current teacher ID and fetch their courses - always call hooks at the top level
  const { data: teacherId, isLoading: loadingTeacherId } = useCurrentTeacherId();
  const { data: teacherCoursesData = [], isLoading: coursesLoading, error: coursesError } = useTeacherCourses(teacherId);

  // Transform teacher courses data to the format expected by the component - always call useMemo
  // Deduplicate courses by courseId (same course can appear multiple times if teacher has multiple assignments)
  const courses = useMemo(() => {
    if (!teacherCoursesData || teacherCoursesData.length === 0) return [];

    console.log('Raw teacher courses data:', teacherCoursesData);

    // Deduplicate courses by courseId
    const coursesMap = new Map<string, any>();
    
    teacherCoursesData.forEach((course: any) => {
      const courseId = course.courseId;
      
      // If course already exists, keep the one with the most recent assignment or active status
      if (coursesMap.has(courseId)) {
        const existing = coursesMap.get(courseId);
        
        // Prefer active status over completed/pending
        if (course.status === 'active' && existing.status !== 'active') {
          coursesMap.set(courseId, course);
        }
        // If both have same status, prefer the one with more recent assignment
        else if (course.assignmentCreatedAt && existing.assignmentCreatedAt) {
          const courseDate = new Date(course.assignmentCreatedAt).getTime();
          const existingDate = new Date(existing.assignmentCreatedAt).getTime();
          if (courseDate > existingDate) {
            coursesMap.set(courseId, course);
          }
        }
      } else {
        coursesMap.set(courseId, course);
      }
    });

    // Transform to the format expected by the component
    return Array.from(coursesMap.values()).map((course: any) => {
      console.log('Processing course:', course);

      return {
        id: course.courseId, // Use the course ID from the API response
        name: course.courseName,
        code: course.courseCode,
        assignmentId: course.assignmentId, // Keep assignment ID for reference
        className: course.className,
        classId: course.classId
      };
    });
  }, [teacherCoursesData]);

  const evaluationTypes = useMemo(() => [
    {
      id: 'online',
      name: 'Évaluation en ligne',
      description: 'Questions interactives (QCM, réponses courtes)',
      icon: BookOpen,
      color: 'from-green-500 to-emerald-600'
    },
    {
      id: 'pdf',
      name: 'Évaluation à sujet unique',
      description: 'Sujet au format PDF avec remise de fichiers',
      icon: FileText,
      color: 'from-blue-500 to-cyan-600'
    },
    {
      id: 'ai_generated',
      name: 'Évaluation IA',
      description: 'Génération automatique de questions',
      icon: Brain,
      color: 'from-purple-500 to-pink-600'
    }
  ], []);

  const handleCreateEvaluation = () => {
    if (!selectedCourse) {
      alert('Veuillez sélectionner un cours');
      return;
    }

    // Redirect to admin evaluation creation with courseId and evaluation type
    const params = new URLSearchParams({
      courseId: selectedCourse,
      evaluation_type: evaluationType
    });

    router.push(`/academic/evaluations/create?${params.toString()}`);
  };

  // Early returns after all hooks are called
  if (status === 'loading' || loadingTeacherId || coursesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  // Check if user has teacher role
  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    return null;
  }

  // Error state
  if (coursesError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Erreur de chargement</h1>
          <p className="text-gray-600 mb-4">Impossible de charger vos cours. Veuillez réessayer.</p>
          <Button onClick={() => window.location.reload()}>
            Réessayer
          </Button>
        </div>
      </div>
    );
  }



  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.back()}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center">
                <FileText className="w-8 h-8 text-purple-600 mr-3" />
                Créer une Évaluation
              </h1>
              <p className="mt-2 text-white">
                Sélectionnez le cours et le type d'évaluation à créer
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-6">
          {/* Course Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Sélection du Cours</CardTitle>
              <CardDescription>Choisissez le cours pour lequel vous souhaitez créer une évaluation</CardDescription>
            </CardHeader>
            <CardContent>

              {courses.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun cours assigné</h3>
                  <p className="text-gray-500">
                    Vous n'avez pas encore de cours assignés. Contactez l'administration.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {courses.map((course) => (
                    <div
                      key={course.id}
                      onClick={() => setSelectedCourse(course.id)}
                      className={`p-4 border-2 rounded-lg cursor-pointer transition-all hover:shadow-md ${
                        selectedCourse === course.id
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/20 ring-2 ring-purple-200 dark:ring-purple-800'
                          : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className={`font-semibold ${selectedCourse === course.id ? 'text-gray-900 dark:text-gray-100' : 'text-white'}`}>{course.name}</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{course.code}</p>
                          <p className="text-sm text-purple-600 dark:text-purple-400 mt-2">
                            Classe: {course.className}
                          </p>
                        </div>
                        {selectedCourse === course.id && (
                          <div className="ml-3">
                            <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Evaluation Type Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-white">Type d'Évaluation</CardTitle>
              <CardDescription>Choisissez le type d'évaluation que vous souhaitez créer</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {evaluationTypes.map((type) => {
                  const Icon = type.icon;
                  const isSelected = evaluationType === type.id;

                  return (
                    <div
                      key={type.id}
                      onClick={() => setEvaluationType(type.id as any)}
                      className={`p-6 border-2 rounded-lg cursor-pointer transition-all hover:shadow-md ${
                        isSelected
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/20 ring-2 ring-purple-200 dark:ring-purple-800'
                          : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600'
                      }`}
                    >
                      <div className="text-center">
                        <div className={`w-12 h-12 mx-auto mb-4 rounded-lg bg-gradient-to-r ${type.color} flex items-center justify-center`}>
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <h3 className={`font-semibold mb-2 ${isSelected ? 'text-gray-900 dark:text-gray-100' : 'text-white'}`}>{type.name}</h3>
                        <p className={`text-sm ${isSelected ? 'text-gray-600 dark:text-gray-400' : 'text-white'}`}>{type.description}</p>
                        {isSelected && (
                          <div className="mt-3">
                            <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center mx-auto">
                              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Summary and Action */}
          {selectedCourse && (
            <Card>
              <CardHeader>
                <CardTitle className="text-white">Résumé de la Sélection</CardTitle>
                <CardDescription>Vérifiez vos sélections avant de continuer</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Cours sélectionné</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {courses.find(c => c.id === selectedCourse)?.name}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {courses.find(c => c.id === selectedCourse)?.code}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Type d'évaluation</p>
                      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {evaluationTypes.find(t => t.id === evaluationType)?.name}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {evaluationTypes.find(t => t.id === evaluationType)?.description}
                      </p>
                    </div>
                  </div>
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Vous allez être redirigé vers l'interface de création d'évaluation complète.
                    Vous pourrez y configurer tous les détails de votre évaluation (questions, durée, paramètres, etc.).
                  </AlertDescription>
                </Alert>

                <div className="flex justify-end gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.back()}
                  >
                    Retour
                  </Button>
                  <Button
                    onClick={handleCreateEvaluation}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    <span>Continuer la création</span>
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
