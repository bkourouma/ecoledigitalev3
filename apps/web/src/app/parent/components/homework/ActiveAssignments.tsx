'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Clock, FileText, AlertCircle, BookOpen, Filter } from 'lucide-react';
import { ParentAssignment, AssignmentFilter } from '@ecoledigitale/contracts';

interface ActiveAssignmentsProps {
  assignments: ParentAssignment[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  courses?: Array<{ id: string; name: string }>;
  filters?: AssignmentFilter;
  onFiltersChange?: (filters: AssignmentFilter) => void;
}

export function ActiveAssignments({ 
  assignments, 
  isLoading, 
  error,
  children,
  courses,
  filters = {},
  onFiltersChange
}: ActiveAssignmentsProps) {
  // Handle filter change
  const handleFilterChange = (key: keyof AssignmentFilter, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: AssignmentFilter = {
      childId: undefined,
      courseId: undefined,
      status: undefined,
    };
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  // Get priority badge
  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <Badge className="bg-red-100 text-red-800">Urgent</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-100 text-yellow-800">Moyen</Badge>;
      case 'low':
        return <Badge className="bg-green-100 text-green-800">Faible</Badge>;
      default:
        return <Badge variant="secondary">{priority}</Badge>;
    }
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-gray-100 text-gray-800">En attente</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-100 text-blue-800">En cours</Badge>;
      case 'submitted':
        return <Badge className="bg-green-100 text-green-800">Soumis</Badge>;
      case 'graded':
        return <Badge className="bg-purple-100 text-purple-800">Noté</Badge>;
      case 'expired':
        return <Badge className="bg-red-100 text-red-800">Expiré</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Devoirs Actifs
          </CardTitle>
          <CardDescription>
            Liste des devoirs actifs avec échéances à venir
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des devoirs actifs">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500" aria-hidden="true"></div>
            <span className="sr-only">Chargement en cours...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Devoirs Actifs
          </CardTitle>
          <CardDescription>
            Liste des devoirs actifs avec échéances à venir
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium">Erreur lors du chargement</p>
            <p className="text-gray-600 text-sm mt-2">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-emerald-600" />
          Devoirs Actifs
        </CardTitle>
        <CardDescription>
          Liste des devoirs actifs avec échéances à venir
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Filters */}
          {(children && children.length > 0) || (courses && courses.length > 0) ? (
            <div className="border border-gray-300 rounded-lg p-4 bg-white">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-5 w-5 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-900">Filtres</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Child Filter */}
                {children && children.length > 0 && (
                  <div>
                    <label htmlFor="child-filter" className="block text-sm font-medium text-gray-700 mb-1">
                      Enfant
                    </label>
                    <Select
                      value={filters.childId || 'all'}
                      onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                    >
                      <SelectTrigger id="child-filter" className="w-full" aria-label="Filtrer par enfant">
                        <SelectValue placeholder="Tous les enfants" />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">Tous les enfants</SelectItem>
                          {children.map((child, index) => (
                            <SelectItem key={`assignments-child-${index}`} value={child.id}>
                              {child.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Course Filter */}
                {courses && courses.length > 0 && (
                  <div>
                    <label htmlFor="course-filter" className="block text-sm font-medium text-gray-700 mb-1">
                      Cours
                    </label>
                    <Select
                      value={filters.courseId || 'all'}
                      onValueChange={(value) => handleFilterChange('courseId', value === 'all' ? undefined : value)}
                    >
                      <SelectTrigger id="course-filter" className="w-full" aria-label="Filtrer par cours">
                        <SelectValue placeholder="Tous les cours" />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">Tous les cours</SelectItem>
                          {courses.map((course, index) => (
                            <SelectItem key={`assignments-course-${index}`} value={course.id}>
                              {course.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Reset Button */}
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetFilters}
                    className="w-full"
                    aria-label="Réinitialiser les filtres"
                  >
                    Réinitialiser
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Assignments List */}
          {!assignments || assignments.length === 0 ? (
            <div className="text-center py-12 border border-gray-300 rounded-lg bg-white" role="status" aria-live="polite">
              <FileText className="mx-auto h-16 w-16 text-gray-400 mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun devoir actif</h3>
              <p className="text-gray-600">
                Aucun devoir actif n'est disponible pour le moment.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map((assignment, index) => (
                <div
                  key={`assignment-${index}`}
                  className="border border-gray-300 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Title and Status */}
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-lg font-semibold text-gray-900">{assignment.title}</h4>
                        {getStatusBadge(assignment.status)}
                        {getPriorityBadge(assignment.priority)}
                      </div>

                      {/* Course and Child Info */}
                      <div className="flex items-center gap-4 mb-2 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <BookOpen className="h-4 w-4" aria-hidden="true" />
                          <span>{assignment.courseName}</span>
                          {assignment.courseCode && (
                            <Badge variant="outline" className="text-xs text-purple-600 border-purple-300 ml-1">
                              {assignment.courseCode}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Enfant:</span>
                          <span>{assignment.childName}</span>
                        </div>
                      </div>

                      {/* Description */}
                      {assignment.description && (
                        <p className="text-sm text-gray-700 mb-3 line-clamp-2">
                          {assignment.description}
                        </p>
                      )}

                      {/* Deadline and Days Remaining */}
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1 text-gray-600">
                          <Calendar className="h-4 w-4" aria-hidden="true" />
                          <span className="font-medium">Échéance:</span>
                          <span>{formatDate(assignment.dueDate)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-gray-600">
                          <Clock className="h-4 w-4" aria-hidden="true" />
                          <span className="font-medium">Jours restants:</span>
                          <span className={assignment.daysRemaining <= 3 ? 'text-red-600 font-bold' : ''}>
                            {assignment.daysRemaining} jour{assignment.daysRemaining > 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>

                      {/* Grade if graded */}
                      {assignment.status === 'graded' && assignment.grade !== null && (
                        <div className="mt-3 p-2 bg-purple-50 rounded border border-purple-200">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-purple-900">Note:</span>
                            <span className="text-purple-700 font-bold">
                              {assignment.grade}/{assignment.maxPoints}
                            </span>
                            {assignment.feedback && (
                              <span className="text-purple-600">({assignment.feedback})</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

