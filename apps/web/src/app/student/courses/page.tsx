'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { AlertCircle, Award, BookOpen, Calendar, Clock, GraduationCap, Users } from 'lucide-react';
import { createApiHeaders } from '@/lib/api-utils';
import { useCurrentStudent } from '@/lib/hooks/use-student-data';
import { getStudentApiError, isStudentProfileMissingError } from '@/lib/student-profile-errors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Course {
  id?: string;
  name?: string;
  code?: string;
  description?: string;
  teacher_name?: string;
  credits?: number;
  schedule?: string;
  status?: 'active' | 'completed' | 'upcoming';
  progress?: number;
  semester?: string;
  assignments_count?: number;
  next_class?: string;
  courseId?: string;
  courseName?: string;
  courseCode?: string;
  className?: string;
  programmeName?: string;
}

type StudentCoursesResponse = {
  data?: Course[];
};

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <CardContent className="text-center py-12">
        <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

export default function StudentCoursesPage() {
  const { data: session } = useSession();
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'upcoming'>('all');
  const {
    data: currentStudent,
    isLoading: isLoadingStudent,
    error: currentStudentError,
  } = useCurrentStudent();

  const { data: coursesData, isLoading: isLoadingCourses, error } = useQuery<StudentCoursesResponse>({
    queryKey: ['student-courses-page', currentStudent?.id, filter],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (filter !== 'all') {
        searchParams.set('status', filter);
      }
      searchParams.set('limit', '50');

      const response = await fetch(`/api/v1/student/courses?${searchParams.toString()}`, {
        headers: createApiHeaders(session),
      });

      if (!response.ok) {
        throw await getStudentApiError(response, 'Erreur lors de la recuperation des cours');
      }

      return response.json();
    },
    enabled: !!currentStudent?.id,
    retry: false,
  });

  const loading = isLoadingStudent || isLoadingCourses;
  const courses = coursesData?.data ?? [];
  const filteredCourses = courses.filter((course) => filter === 'all' || course.status === filter);

  const getStatusText = (status?: string) => {
    switch (status) {
      case 'active':
        return 'En cours';
      case 'completed':
        return 'Termine';
      case 'upcoming':
        return 'A venir';
      default:
        return 'Actif';
    }
  };

  const getStatusVariant = (status?: string) => {
    switch (status) {
      case 'completed':
        return 'secondary' as const;
      case 'upcoming':
        return 'outline' as const;
      default:
        return 'default' as const;
    }
  };

  const getProgressColor = (progress?: number) => {
    if (!progress) return 'bg-gray-300';
    if (progress >= 80) return 'bg-green-500';
    if (progress >= 60) return 'bg-blue-500';
    if (progress >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getNextClassText = (nextClass?: string) => {
    if (!nextClass) return '';

    try {
      const date = new Date(nextClass);
      const now = new Date();
      const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return "Aujourd'hui";
      if (diffDays === 1) return 'Demain';
      if (diffDays > 1) return `Dans ${diffDays} jours`;
      return 'Passe';
    } catch {
      return '';
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="h-48 bg-gray-200 rounded"></div>
            <div className="h-48 bg-gray-200 rounded"></div>
            <div className="h-48 bg-gray-200 rounded"></div>
            <div className="h-48 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (currentStudentError && isStudentProfileMissingError(currentStudentError)) {
    return (
      <div className="container mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Mes Cours</h1>
          <p className="text-muted-foreground">Suivez vos cours et votre progression academique</p>
        </div>
        <Card>
          <CardContent className="text-center py-12">
            <AlertCircle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Profil etudiant introuvable</h3>
            <p className="text-muted-foreground">
              Ce compte n&apos;est pas encore rattache a une fiche etudiant. Veuillez contacter
              l&apos;administrateur.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentStudentError || error) {
    const message =
      (currentStudentError instanceof Error && currentStudentError.message) ||
      (error instanceof Error && error.message) ||
      'Impossible de charger vos cours.';

    return (
      <div className="container mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Mes Cours</h1>
          <p className="text-muted-foreground">Suivez vos cours et votre progression academique</p>
        </div>
        <Card>
          <CardContent className="text-center py-12">
            <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2 text-red-600">Erreur de chargement</h3>
            <p className="text-muted-foreground">{message}</p>
            <Button onClick={() => window.location.reload()} className="mt-4" variant="outline">
              Reessayer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Mes Cours</h1>
        <p className="text-muted-foreground">Suivez vos cours et votre progression academique</p>
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { key: 'all', label: 'Tous' },
          { key: 'active', label: 'En cours' },
          { key: 'completed', label: 'Termines' },
          { key: 'upcoming', label: 'A venir' },
        ].map(({ key, label }) => (
          <Button
            key={key}
            variant={filter === key ? 'default' : 'outline'}
            onClick={() => setFilter(key as typeof filter)}
            size="sm"
          >
            {label}
          </Button>
        ))}
      </div>

      {filteredCourses.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'Aucun cours' : `Aucun cours ${getStatusText(filter)}`}
          message={
            filter === 'all'
              ? "Vous n'etes inscrit a aucun cours pour le moment."
              : "Vous n'avez aucun cours dans cette categorie."
          }
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredCourses.map((course) => (
            <Card
              key={course.id || course.courseId || `${course.name || course.courseName}-course`}
              className="hover:shadow-lg transition-shadow"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-lg">{course.name || course.courseName || 'Cours'}</CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      <span className="truncate">
                        {course.code || course.courseCode || 'N/A'} {course.semester ? `• ${course.semester}` : ''}
                      </span>
                    </CardDescription>
                  </div>
                  <Badge variant={getStatusVariant(course.status)}>{getStatusText(course.status)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {course.description && (
                  <p className="text-sm text-muted-foreground">{course.description}</p>
                )}

                <div className="space-y-2">
                  {course.teacher_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span>{course.teacher_name}</span>
                    </div>
                  )}
                  {course.schedule && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>{course.schedule}</span>
                    </div>
                  )}
                  {course.credits && (
                    <div className="flex items-center gap-2 text-sm">
                      <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      <span>{course.credits} credits</span>
                    </div>
                  )}
                  {course.className && (
                    <div className="flex items-center gap-2 text-sm">
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                      <span>Classe: {course.className}</span>
                    </div>
                  )}
                  {course.programmeName && (
                    <div className="flex items-center gap-2 text-sm">
                      <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      <span>Programme: {course.programmeName}</span>
                    </div>
                  )}
                  {course.assignments_count ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Award className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {course.assignments_count} devoir{course.assignments_count > 1 ? 's' : ''}
                      </span>
                    </div>
                  ) : null}
                  {course.next_class && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Prochain cours: {getNextClassText(course.next_class)}</span>
                    </div>
                  )}
                </div>

                {course.status === 'active' && course.progress !== undefined ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Progression</span>
                      <span>{course.progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${getProgressColor(course.progress)}`}
                        style={{ width: `${course.progress}%` }}
                      ></div>
                    </div>
                  </div>
                ) : null}

                <Link href={`/student/courses/${course.id || course.courseId || ''}`} className="block">
                  <Button className="w-full" variant="outline">
                    Acceder au cours
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
