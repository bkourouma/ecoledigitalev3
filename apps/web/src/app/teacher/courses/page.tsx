"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  BookOpen,
  Calendar,
  Clock,
  Eye,
  Search,
  Grid,
  List,
  FileText,
  TrendingUp,
  Award
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { createApiHeaders } from "@/lib/api-utils";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { useCurrentTeacherId } from "@/lib/hooks/use-current-teacher";

type TeacherCourseListItem = {
  assignmentCreatedAt?: string | null;
  assignmentId: string;
  className?: string | null;
  courseAmount?: number | string | null;
  courseCode?: string | null;
  courseId: string;
  courseName: string;
  datebut?: string | null;
  datefin?: string | null;
  hoursValidated?: number | null;
  materialsCount?: number | null;
  status?: string | null;
};

// API function - Use Next.js proxy route
const fetchTeacherCourses = async (activeAcademicYearId?: string): Promise<TeacherCourseListItem[]> => {
  const response = await fetch('/api/teacher/courses', {
    headers: createApiHeaders(undefined, {
      // Override any stale localStorage value injected by the fetch interceptor.
      'X-Academic-Year-Id': activeAcademicYearId ?? '',
    }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch courses');
  }
  return response.json();
};

export default function TeacherCoursesPage() {
  const router = useRouter();
  const { data: teacherId, isLoading: isLoadingTeacherId } = useCurrentTeacherId();
  const { data: activeAcademicYearData, isLoading: isLoadingAcademicYear } = useActiveAcademicYear();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const hasTeacherProfile = Boolean(teacherId);
  const activeAcademicYearId = activeAcademicYearData?.data?.id;

  // Fetch teacher courses
  const { data: courses = [], isLoading, error } = useQuery<TeacherCourseListItem[]>({
    queryKey: ['teacher-courses', teacherId, activeAcademicYearId ?? 'no-academic-year'],
    queryFn: () => fetchTeacherCourses(activeAcademicYearId),
    enabled: hasTeacherProfile && !isLoadingAcademicYear,
    retry: false,
  });

  // Deduplicate courses by courseId (same course can appear multiple times if teacher has multiple assignments)
  const uniqueCourses = React.useMemo(() => {
    if (!courses || courses.length === 0) return [];
    
    const coursesMap = new Map<string, TeacherCourseListItem>();
    
    courses.forEach((course) => {
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
    
    return Array.from(coursesMap.values());
  }, [courses]);

  // Filter courses based on search and status
  const filteredCourses = uniqueCourses.filter((course) => {
    const matchesSearch = (course.courseName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (course.courseCode || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (course.className || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || course.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const handleViewCourse = (assignmentId: string) => {
    router.push(`/teacher/courses/${assignmentId}`);
  };

  if (isLoadingTeacherId || isLoadingAcademicYear || (hasTeacherProfile && isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-32 w-32 animate-spin rounded-full border-b-2 border-purple-500" />
      </div>
    );
  }

  if (teacherId === null) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                <AlertCircle className="h-8 w-8 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Profil enseignant introuvable</h3>
                <p className="text-muted-foreground">
                  Ce compte n&apos;est pas encore rattache a une fiche enseignant. Veuillez contacter l&apos;administrateur.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-foreground">Erreur de chargement</h1>
          <p className="mb-2 font-normal text-muted-foreground">Impossible de charger vos cours.</p>
          <p className="mb-4 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Une erreur est survenue.'}
          </p>
          <Button onClick={() => window.location.reload()}>
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Titres forts = foreground + gras ; textes secondaires = muted + normal (sans changer le fond) */}
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="flex items-center text-3xl font-bold text-foreground">
                <BookOpen className="mr-3 h-8 w-8 shrink-0 text-purple-600" aria-hidden />
                Mes Cours
              </h1>
              <p className="mt-2 text-base font-normal text-muted-foreground">
                Gérez vos cours et leurs contenus pédagogiques
              </p>
            </div>
            <div className="flex shrink-0 items-center space-x-4">
              <div className="flex items-center space-x-2 rounded-lg border border-border bg-card p-1">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className={`p-2 ${
                    viewMode === 'grid'
                      ? 'bg-purple-600 font-bold text-white hover:bg-purple-700'
                      : 'font-normal text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Grid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className={`p-2 ${
                    viewMode === 'list'
                      ? 'bg-purple-600 font-bold text-white hover:bg-purple-700'
                      : 'font-normal text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Filtres */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
              <Input
                placeholder="Rechercher un cours..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 font-normal"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="space-y-2">
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value)}
              >
                <SelectTrigger className="w-[180px] font-normal">
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="active">Actif</SelectItem>
                  <SelectItem value="completed">Terminé</SelectItem>
                  <SelectItem value="pending">En attente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Stats : libellés = texte secondaire ; chiffres = gras */}
        <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="rounded-lg bg-purple-100 p-2">
                  <BookOpen className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-normal text-muted-foreground">Total Cours</p>
                  <p className="text-2xl font-bold text-foreground">{uniqueCourses.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="rounded-lg bg-green-100 p-2">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-normal text-muted-foreground">Cours Actifs</p>
                  <p className="text-2xl font-bold text-foreground">
                    {uniqueCourses.filter((c) => c.status === 'active').length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="rounded-lg bg-blue-100 p-2">
                  <FileText className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-normal text-muted-foreground">Total Supports</p>
                  <p className="text-2xl font-bold text-foreground">
                    {uniqueCourses.reduce((total, course) => total + (course.materialsCount || 0), 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="rounded-lg bg-yellow-100 p-2">
                  <Award className="h-6 w-6 text-yellow-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-normal text-muted-foreground">Heures Validées</p>
                  <p className="text-2xl font-bold text-foreground">
                    {uniqueCourses.reduce((total, course) => total + (course.hoursValidated || 0), 0)}h
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Courses Grid/List */}
        {filteredCourses.length === 0 ? (
          <div className="py-12 text-center">
            <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-bold text-foreground">
              {searchQuery || statusFilter !== 'all' ? 'Aucun cours trouvé' : 'Aucun cours assigné'}
            </h3>
            <p className="mb-4 font-normal text-muted-foreground">
              {searchQuery || statusFilter !== 'all'
                ? 'Aucun cours ne correspond à vos critères de recherche.'
                : 'Vous n\'avez pas encore de cours assignés.'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredCourses.map((course) => (
              <Card
                key={course.courseId}
                className="cursor-pointer transition-shadow hover:shadow-lg"
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="!text-lg !font-bold text-foreground flex items-center gap-2">
                        <BookOpen className="h-5 w-5 shrink-0 text-purple-600" />
                        <span className="truncate">{course.courseName}</span>
                      </CardTitle>
                      <CardDescription className="!mt-1 !font-normal !text-muted-foreground">
                        {course.courseCode} • {course.className}
                      </CardDescription>
                    </div>
                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-normal text-green-800 dark:bg-green-900/40 dark:text-green-100">
                      Actif
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center text-sm font-normal text-muted-foreground">
                      <Calendar className="mr-2 h-4 w-4 shrink-0" />
                      {new Date(course.datebut).toLocaleDateString('fr-FR')} - {new Date(course.datefin).toLocaleDateString('fr-FR')}
                    </div>

                    <div className="flex items-center text-sm font-normal text-muted-foreground">
                      <FileText className="mr-2 h-4 w-4 shrink-0" />
                      {course.materialsCount || 0} support(s) de cours
                    </div>

                    {course.hoursValidated && (
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Clock className="mr-2 h-4 w-4 shrink-0" />
                        <span className="font-bold text-foreground">{course.hoursValidated}h</span>
                        <span className="font-normal"> validées</span>
                      </div>
                    )}

                    {course.courseAmount && (
                      <div className="flex items-center text-sm font-bold text-foreground">
                        <TrendingUp className="mr-2 h-4 w-4 shrink-0 text-green-600" />
                        {parseFloat(course.courseAmount).toLocaleString('fr-FR')} FCFA
                      </div>
                    )}
                  </div>

                  <div className="mt-4 border-t border-border pt-4">
                    <Button
                      onClick={() => handleViewCourse(course.assignmentId)}
                      className="w-full bg-purple-600 font-semibold text-white hover:bg-purple-700"
                      size="sm"
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Voir les détails
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredCourses.map((course) => (
              <Card key={course.courseId} className="transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center space-x-4">
                      <div className="shrink-0 rounded-lg bg-purple-100 p-2 dark:bg-purple-900/40">
                        <BookOpen className="h-6 w-6 text-purple-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold text-foreground">{course.courseName}</h3>
                        <p className="text-sm font-normal text-muted-foreground">{course.courseCode} • {course.className}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-normal text-muted-foreground">
                          <span>{new Date(course.datebut).toLocaleDateString('fr-FR')} - {new Date(course.datefin).toLocaleDateString('fr-FR')}</span>
                          <span>{course.materialsCount || 0} support(s)</span>
                          {course.hoursValidated && (
                            <span>
                              <span className="font-bold text-foreground">{course.hoursValidated}h</span> validées
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center space-x-3">
                      <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-normal text-green-800 dark:bg-green-900/40 dark:text-green-100">
                        Actif
                      </span>
                      <Button
                        onClick={() => handleViewCourse(course.assignmentId)}
                        variant="outline"
                        size="sm"
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Voir
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
