'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, Clock, MapPin, BookOpen, User, Filter, AlertCircle, GraduationCap } from 'lucide-react';
import { ExamSchedule, ExamScheduleFilter } from '@ecoledigitale/contracts';
import { useExamSchedules } from '@/lib/hooks/use-parent-academic';
import { format, parseISO, isPast, isToday, isFuture } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ExamSchedulesProps {
  children?: Array<{ id: string; name: string }>;
  courses?: Array<{ id: string; name: string }>;
  academicYears?: Array<{ id: string; name: string }>;
  filters?: ExamScheduleFilter;
  onFiltersChange?: (filters: ExamScheduleFilter) => void;
}

export function ExamSchedules({
  children = [],
  courses = [],
  academicYears = [],
  filters = {},
  onFiltersChange,
}: ExamSchedulesProps) {
  const [localFilters, setLocalFilters] = useState<ExamScheduleFilter>(filters);
  const [startDate, setStartDate] = useState<string>(filters.startDate || '');
  const [endDate, setEndDate] = useState<string>(filters.endDate || '');

  // Use the hook with current filters
  const { data, isLoading, error } = useExamSchedules(
    localFilters.childId,
    localFilters.courseId,
    localFilters.examType,
    localFilters.startDate,
    localFilters.endDate,
    localFilters.academicYearId
  );

  const exams = data?.data?.exams || [];

  // Handle filter change
  const handleFilterChange = (key: keyof ExamScheduleFilter, value: string | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Handle date range change
  const handleDateRangeChange = () => {
    const newFilters = {
      ...localFilters,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Get exam type badge
  const getExamTypeBadge = (type: string) => {
    const types: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      midterm: { label: 'Contrôle Intermédiaire', variant: 'default' },
      final: { label: 'Examen Final', variant: 'destructive' },
      quiz: { label: 'Quiz', variant: 'secondary' },
      assignment: { label: 'Devoir', variant: 'outline' },
      other: { label: 'Autre', variant: 'outline' },
    };
    return types[type] || types.other;
  };

  // Get exam status (upcoming, today, past)
  const getExamStatus = (examDate: string | null, examTime: string | null) => {
    if (!examDate) return 'unknown';
    
    const examDateTime = examTime 
      ? parseISO(`${examDate}T${examTime}`)
      : parseISO(examDate);
    
    if (isPast(examDateTime)) return 'past';
    if (isToday(examDateTime)) return 'today';
    return 'upcoming';
  };

  // Format duration
  const formatDuration = (minutes: number | null): string => {
    if (!minutes) return 'Durée non spécifiée';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Horaires d'Examens
          </CardTitle>
          <CardDescription>
            Consultez les horaires d'examens de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Chargement des horaires d'examens...</p>
            </div>
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
            <Calendar className="h-5 w-5 text-emerald-600" />
            Horaires d'Examens
          </CardTitle>
          <CardDescription>
            Consultez les horaires d'examens de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Erreur lors du chargement</p>
              <p className="text-gray-500 text-sm">{error.message || 'Une erreur est survenue'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (exams.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Horaires d'Examens
          </CardTitle>
          <CardDescription>
            Consultez les horaires d'examens de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Aucun examen programmé</p>
              <p className="text-gray-500 text-sm">Aucun horaire d'examen n'est actuellement disponible pour vos enfants.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Horaires d'Examens
          </CardTitle>
          <CardDescription>
            Consultez les horaires d'examens de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filtres</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              {children.length > 0 && (
                <Select
                  value={localFilters.childId || 'all'}
                  onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.map((child, index) => (
                      <SelectItem key={`exam-schedules-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {courses.length > 0 && (
                <Select
                  value={localFilters.courseId || 'all'}
                  onValueChange={(value) => handleFilterChange('courseId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les cours" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les cours</SelectItem>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select
                value={localFilters.examType || 'all'}
                onValueChange={(value) => handleFilterChange('examType', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="midterm">Contrôle Intermédiaire</SelectItem>
                  <SelectItem value="final">Examen Final</SelectItem>
                  <SelectItem value="quiz">Quiz</SelectItem>
                  <SelectItem value="assignment">Devoir</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>

              {academicYears.length > 0 && (
                <Select
                  value={localFilters.academicYearId || 'all'}
                  onValueChange={(value) => handleFilterChange('academicYearId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Toutes les années" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les années</SelectItem>
                    {academicYears.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div>
                <Label htmlFor="start-date">Date début</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    handleFilterChange('startDate', e.target.value || undefined);
                  }}
                />
              </div>

              <div>
                <Label htmlFor="end-date">Date fin</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    handleFilterChange('endDate', e.target.value || undefined);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Exams List */}
          <div className="space-y-4">
            {exams.map((exam: ExamSchedule, index: number) => {
              const examType = getExamTypeBadge(exam.examType);
              const status = getExamStatus(exam.examDate, exam.examTime);
              const examDate = exam.examDate ? parseISO(exam.examDate) : null;
              const examDateTime = exam.examTime && examDate
                ? parseISO(`${exam.examDate}T${exam.examTime}`)
                : examDate;

              return (
                <Card key={`${exam.examId}-${index}`} className={`hover:shadow-md transition-shadow ${
                  status === 'today' ? 'ring-2 ring-emerald-500' : ''
                }`}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{exam.examName}</h3>
                          <Badge variant={examType.variant}>{examType.label}</Badge>
                          {status === 'today' && (
                            <Badge variant="default" className="bg-emerald-600">Aujourd'hui</Badge>
                          )}
                          {status === 'upcoming' && (
                            <Badge variant="outline" className="border-blue-500 text-blue-600">À venir</Badge>
                          )}
                          {status === 'past' && (
                            <Badge variant="outline" className="border-gray-400 text-gray-500">Passé</Badge>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <BookOpen className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">Cours:</span>
                            <span>{exam.courseName}</span>
                          </div>

                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <User className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">Enfant:</span>
                            <span>{exam.childName}</span>
                          </div>

                          {exam.examDate && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Calendar className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Date:</span>
                              <span>{format(examDate, 'EEEE d MMMM yyyy', { locale: fr })}</span>
                            </div>
                          )}

                          {exam.examTime && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Clock className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Heure:</span>
                              <span>{exam.examTime}</span>
                            </div>
                          )}

                          {exam.duration && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Clock className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Durée:</span>
                              <span>{formatDuration(exam.duration)}</span>
                            </div>
                          )}

                          {exam.location && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <MapPin className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Lieu:</span>
                              <span>{exam.location}</span>
                            </div>
                          )}

                          {exam.academicYearName && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <GraduationCap className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">Année académique:</span>
                              <span>{exam.academicYearName}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

