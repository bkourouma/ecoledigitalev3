'use client';

import React, { useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BookOpen, Award, TrendingUp, AlertCircle } from 'lucide-react';
import { CourseGradeSummary } from '@ecoledigitale/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

interface GradesByCourseProps {
  courses: CourseGradeSummary[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  onChildChange?: (childId: string | undefined) => void;
}

export function GradesByCourse({
  courses,
  isLoading,
  error,
  children,
  selectedChildId,
  onChildChange,
}: GradesByCourseProps) {
  // Memoized handler for better performance
  const handleChildChange = useCallback((value: string) => {
    if (onChildChange) {
      onChildChange(value === 'all' ? undefined : value);
    }
  }, [onChildChange]);

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Get grade badge color
  const getGradeBadge = (percentage: number) => {
    if (percentage >= 90) {
      return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">Excellent</Badge>;
    } else if (percentage >= 80) {
      return <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200">Très bien</Badge>;
    } else if (percentage >= 70) {
      return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200">Bien</Badge>;
    } else if (percentage >= 60) {
      return <Badge variant="outline" className="border-orange-500/40 bg-orange-500/15 text-orange-200">Assez bien</Badge>;
    } else {
      return <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-red-200">Insuffisant</Badge>;
    }
  };

  // Get course average badge color
  const getCourseAverageBadge = (average: number) => {
    const percentage = (average / 20) * 100;
    if (percentage >= 90) {
      return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">Excellent</Badge>;
    } else if (percentage >= 80) {
      return <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200">Très bien</Badge>;
    } else if (percentage >= 70) {
      return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200">Bien</Badge>;
    } else if (percentage >= 60) {
      return <Badge variant="outline" className="border-orange-500/40 bg-orange-500/15 text-orange-200">Assez bien</Badge>;
    } else {
      return <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-red-200">Insuffisant</Badge>;
    }
  };

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card aria-label="Chargement des notes par cours">
        <CardHeader>
          <CardTitle>Notes par cours</CardTitle>
          <CardDescription>Chargement des notes...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-l-4 border-l-sky-500/50">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-6 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="text-right space-y-2">
                      <Skeleton className="h-8 w-20 ml-auto" />
                      <Skeleton className="h-4 w-16 ml-auto" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-32" />
                    {[1, 2].map((j) => (
                      <div key={j} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-6 w-16" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state with retry option
  if (error) {
    return (
      <Card role="alert" aria-live="polite">
        <CardHeader>
          <CardTitle>Notes par cours</CardTitle>
          <CardDescription>Erreur lors du chargement des notes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" aria-hidden="true" />
            <p className="mb-2 text-lg font-semibold text-destructive">Erreur lors du chargement des notes</p>
            <p className="mb-4 text-sm text-muted-foreground">{error.message || 'Une erreur est survenue lors du chargement des notes.'}</p>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              aria-label="Réessayer de charger les notes"
            >
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!courses || courses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notes par cours</CardTitle>
          <CardDescription>Aucune note disponible</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center text-muted-foreground">
            <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p>Aucune note n'est disponible pour le moment.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes par cours</CardTitle>
        <CardDescription>Vue des notes organisées par cours</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        {children && children.length > 0 && (
          <div className="mb-6">
            <div className="space-y-2">
              <Label htmlFor="child-filter">Enfant</Label>
              <Select
                value={selectedChildId || 'all'}
                onValueChange={handleChildChange}
              >
                <SelectTrigger id="child-filter">
                  <SelectValue placeholder="Tous les enfants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les enfants</SelectItem>
                  {children.map((child, index) => (
                    <SelectItem key={`grades-by-course-child-${index}`} value={child.id}>
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Courses List */}
        <div className="space-y-6">
          {courses.map((course) => (
            <Card key={`${course.courseId}-${course.childId}`} className="border-l-4 border-l-sky-500/60">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <BookOpen className="h-5 w-5 text-sky-400" />
                      <CardTitle className="text-xl">{course.courseName}</CardTitle>
                      {course.courseCode && (
                        <Badge variant="outline" className="ml-2">
                          {course.courseCode}
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="mt-1">
                      {course.childName}
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="mb-2 flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="text-2xl font-bold text-foreground">{course.courseAverage.toFixed(2)}</div>
                        <div className="text-sm text-muted-foreground">/ 20</div>
                      </div>
                    </div>
                    {getCourseAverageBadge(course.courseAverage)}
                    <div className="mt-1 text-sm text-muted-foreground">
                      {course.totalGraded} {course.totalGraded === 1 ? 'note' : 'notes'}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Assignment Grades */}
                {course.assignmentGrades.length > 0 ? (
                  <div className="space-y-3">
                    <h4 className="mb-3 text-sm font-semibold text-foreground">Notes des devoirs</h4>
                    {course.assignmentGrades.map((assignmentGrade, index) => (
                      <div
                        key={`assignment-grade-${index}`}
                        className="group flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
                      >
                        <div className="flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <h5 className="font-medium text-foreground">{assignmentGrade.assignmentName}</h5>
                            {getGradeBadge(assignmentGrade.percentage)}
                          </div>
                          {assignmentGrade.gradedAt && (
                            <div className="text-xs text-muted-foreground">
                              Noté le {formatDate(assignmentGrade.gradedAt)}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-emerald-400">
                            {assignmentGrade.grade.toFixed(2)} / {assignmentGrade.maxPoints}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {assignmentGrade.percentage.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    Aucune note disponible pour ce cours.
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

