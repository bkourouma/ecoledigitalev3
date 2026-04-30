'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BookOpen, TrendingUp, Award, Calendar, MessageSquare } from 'lucide-react';

interface Grade {
  id: string;
  assignmentId: string;
  assignmentName: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
  childId: string;
  childName: string;
  grade: number;
  maxPoints: number;
  percentage: number;
  feedback: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  dueDate: string | null;
}

interface Statistics {
  average: number;
  totalGraded: number;
  gradeDistribution: { [key: string]: number };
}

interface GradesReceivedProps {
  grades: Grade[] | null;
  statistics: Statistics | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  courses?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  selectedCourseId?: string;
  onChildChange?: (childId: string | undefined) => void;
  onCourseChange?: (courseId: string | undefined) => void;
  onDateRangeChange?: (startDate: string | undefined, endDate: string | undefined) => void;
}

export function GradesReceived({
  grades,
  statistics,
  isLoading,
  error,
  children,
  courses,
  selectedChildId,
  selectedCourseId,
  onChildChange,
  onCourseChange,
  onDateRangeChange,
}: GradesReceivedProps) {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Deduplicate grades by id to ensure uniqueness and add unique key
  // Use a combination of ID, assignmentId, and childId to create truly unique keys
  const uniqueGrades = React.useMemo(() => {
    if (!grades || grades.length === 0) return null;
    
    // Log all incoming grades to debug duplicates
    console.log(`[GradesReceived] Processing ${grades.length} grades:`, grades.map(g => ({ id: g.id, assignmentId: g.assignmentId, childId: g.childId })));
    
    // Use a composite key to ensure uniqueness: id + assignmentId + childId
    // This handles cases where the same grade might appear multiple times
    const gradesMap = new Map<string, Grade & { uniqueKey: string }>();
    const seenKeys = new Set<string>();
    let index = 0;
    
    grades.forEach((grade, originalIndex) => {
      // Create a composite key from multiple fields to ensure uniqueness
      const keyWithoutIndex = `${grade.id}-${grade.assignmentId}-${grade.childId}`;
      const compositeKey = `${keyWithoutIndex}-${originalIndex}`;
      
      // TOUJOURS créer une uniqueKey unique basée sur l'index pour garantir l'unicité React
      // L'index est la partie la plus importante pour garantir l'unicité absolue
      const uniqueKey = `grade-${index++}-${grade.id}-${originalIndex}`;
      
      // Check for duplicates (same id, assignmentId, and childId)
      if (seenKeys.has(keyWithoutIndex)) {
        console.warn(`[GradesReceived] Duplicate grade found: ${keyWithoutIndex}`, grade);
        // Même si c'est un doublon logique, on le garde avec un index unique pour React
        gradesMap.set(compositeKey, { ...grade, uniqueKey });
        return;
      }
      
      seenKeys.add(keyWithoutIndex);
      gradesMap.set(compositeKey, { ...grade, uniqueKey });
    });
    
    const result = Array.from(gradesMap.values());
    if (result.length !== grades.length) {
      console.warn(`[GradesReceived] Deduplicated grades: ${grades.length} -> ${result.length}`);
    }
    
    // Log final unique grades avec vérification des doublons
    const finalKeys = result.map(g => g.uniqueKey);
    const duplicateKeys = finalKeys.filter((key, idx) => finalKeys.indexOf(key) !== idx);
    if (duplicateKeys.length > 0) {
      console.error('[GradesReceived] DUPLICATE KEYS FOUND:', duplicateKeys);
    }
    
    // Vérifier les doublons d'ID dans le résultat final
    const finalIdCounts = new Map<string, number>();
    result.forEach((grade: any) => {
      finalIdCounts.set(grade.id, (finalIdCounts.get(grade.id) || 0) + 1);
    });
    const finalDuplicateIds = Array.from(finalIdCounts.entries()).filter(([id, count]) => count > 1);
    if (finalDuplicateIds.length > 0) {
      console.error('[GradesReceived] DUPLICATE IDs IN FINAL RESULT:', finalDuplicateIds);
      console.error('[GradesReceived] Grades with duplicate IDs:', result.filter((g: any) => finalDuplicateIds.some(([id]) => id === g.id)));
    }
    
    console.log(`[GradesReceived] Final unique grades:`, result.map(g => ({ id: g.id, uniqueKey: g.uniqueKey, assignmentId: g.assignmentId, childId: g.childId })));
    
    return result;
  }, [grades]);

  // Handle child filter change
  const handleChildChange = (value: string) => {
    if (onChildChange) {
      onChildChange(value === 'all' ? undefined : value);
    }
  };

  // Handle course filter change
  const handleCourseChange = (value: string) => {
    if (onCourseChange) {
      onCourseChange(value === 'all' ? undefined : value);
    }
  };

  // Handle date range change
  const handleDateRangeChange = () => {
    if (onDateRangeChange) {
      onDateRangeChange(
        startDate ? new Date(startDate).toISOString() : undefined,
        endDate ? new Date(endDate).toISOString() : undefined
      );
    }
  };

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
      return <Badge className="bg-green-100 text-green-800 border-green-300">A</Badge>;
    } else if (percentage >= 80) {
      return <Badge className="bg-blue-100 text-blue-800 border-blue-300">B</Badge>;
    } else if (percentage >= 70) {
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">C</Badge>;
    } else if (percentage >= 60) {
      return <Badge className="bg-orange-100 text-orange-800 border-orange-300">D</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800 border-red-300">F</Badge>;
    }
  };

  if (error) {
    return (
      <Card role="alert" aria-live="polite">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" aria-hidden="true" />
            Notes Reçues
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Award className="mx-auto h-12 w-12 text-red-500 mb-4" aria-hidden="true" />
            <p className="text-red-600 font-medium">Erreur lors du chargement des notes</p>
            <p className="text-sm text-gray-500 mt-2">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5" aria-hidden="true" />
          Notes Reçues
        </CardTitle>
        <CardDescription>
          Consultez toutes les notes reçues par vos enfants avec les statistiques détaillées
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {children && children.length > 0 && (
            <div>
              <Label htmlFor="child-filter">Enfant</Label>
              <Select value={selectedChildId || 'all'} onValueChange={handleChildChange}>
                <SelectTrigger id="child-filter" className="w-full" aria-label="Filtrer par enfant">
                  <SelectValue placeholder="Tous les enfants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les enfants</SelectItem>
                  {(() => {
                    // Log children to detect duplicates
                    const childIds = children.map(c => c.id);
                    const duplicateChildIds = childIds.filter((id, idx) => childIds.indexOf(id) !== idx);
                    if (duplicateChildIds.length > 0) {
                      console.error('[GradesReceived] DUPLICATE CHILD IDs IN SELECT:', duplicateChildIds);
                    }
                    if (childIds.includes('c29e4d3f-b03f-4de3-988c-b5fdc63f3580')) {
                      console.log('[GradesReceived] Found target child ID in children list:', children.find(c => c.id === 'c29e4d3f-b03f-4de3-988c-b5fdc63f3580'));
                    }
                    return children.map((child, index) => (
                      <SelectItem key={`grades-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </div>
          )}

          {courses && courses.length > 0 && (
            <div>
              <Label htmlFor="course-filter">Cours</Label>
              <Select value={selectedCourseId || 'all'} onValueChange={handleCourseChange}>
                <SelectTrigger id="course-filter" className="w-full" aria-label="Filtrer par cours">
                  <SelectValue placeholder="Tous les cours" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les cours</SelectItem>
                  {(() => {
                    // Log courses to detect duplicates
                    const courseIds = courses.map(c => c.id);
                    const duplicateCourseIds = courseIds.filter((id, idx) => courseIds.indexOf(id) !== idx);
                    if (duplicateCourseIds.length > 0) {
                      console.error('[GradesReceived] DUPLICATE COURSE IDs IN SELECT:', duplicateCourseIds);
                    }
                    return courses.map((course, index) => (
                      <SelectItem key={`grades-course-${index}`} value={course.id}>
                        {course.name}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="start-date">Date de début</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value && endDate) {
                  handleDateRangeChange();
                }
              }}
            />
          </div>

          <div>
            <Label htmlFor="end-date">Date de fin</Label>
            <Input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                if (startDate && e.target.value) {
                  handleDateRangeChange();
                }
              }}
            />
          </div>
        </div>

        {/* Statistics */}
        {statistics && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Moyenne générale</p>
                    <p className="text-2xl font-bold">{statistics.average.toFixed(2)}%</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total noté</p>
                    <p className="text-2xl font-bold">{statistics.totalGraded}</p>
                  </div>
                  <Award className="h-8 w-8 text-green-500" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div>
                  <p className="text-sm text-gray-600 mb-2">Distribution</p>
                  <div className="space-y-1">
                    {Object.entries(statistics.gradeDistribution).map(([range, count]) => (
                      <div key={range} className="flex justify-between text-sm">
                        <span>{range}:</span>
                        <span className="font-semibold">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Grades List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des notes">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" aria-hidden="true"></div>
            <span className="sr-only">Chargement en cours...</span>
          </div>
        ) : !uniqueGrades || uniqueGrades.length === 0 ? (
          <div className="text-center py-8" role="status" aria-live="polite">
            <Award className="h-12 w-12 text-gray-400 mx-auto mb-4" aria-hidden="true" />
            <p className="text-gray-600 font-medium">Aucune note disponible</p>
            <p className="text-sm text-gray-500 mt-2">
              Les notes apparaîtront ici une fois que les devoirs seront notés
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {(() => {
              // Log toutes les clés générées pour debug
              const allKeys = uniqueGrades.map((g, i) => `grade-received-${i}`);
              const duplicateKeys = allKeys.filter((key, idx) => allKeys.indexOf(key) !== idx);
              if (duplicateKeys.length > 0) {
                console.error('[GradesReceived] DUPLICATE REACT KEYS FOUND:', duplicateKeys);
              }
              console.log('[GradesReceived] All React keys:', allKeys);
              console.log('[GradesReceived] All grade IDs:', uniqueGrades.map(g => g.id));
              
              return uniqueGrades.map((grade, index) => {
                // UTILISER UNIQUEMENT L'INDEX comme clé pour garantir l'unicité absolue
                // L'index est garanti unique dans un tableau, donc la clé sera toujours unique
                // Ne jamais utiliser grade.id directement
                const reactKey = `grade-received-${index}`;
                
                // Log pour debug - vérifier les clés et détecter les doublons
                if (index === 0) {
                  console.log('[GradesReceived] Rendering grades - total:', uniqueGrades.length, 'First grade - index:', index, 'grade.id:', grade.id, 'uniqueKey:', grade.uniqueKey, 'reactKey:', reactKey);
                }
                
                // Vérifier si on a des doublons d'ID dans uniqueGrades
                const duplicateIds = uniqueGrades.filter(g => g.id === grade.id);
                if (duplicateIds.length > 1) {
                  console.error(`[GradesReceived] DUPLICATE ID FOUND at index ${index}:`, grade.id, 'appears', duplicateIds.length, 'times');
                }
                
                return (
                <Card key={reactKey} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">{grade.assignmentName}</h3>
                        {getGradeBadge(grade.percentage)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                        <div className="flex items-center gap-1">
                          <BookOpen className="h-4 w-4" aria-hidden="true" />
                          <span>{grade.courseName}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" aria-hidden="true" />
                          <span>Noté le {formatDate(grade.gradedAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mb-2">
                        <span className="text-2xl font-bold text-blue-600">
                          {grade.grade}/{grade.maxPoints}
                        </span>
                        <span className="text-lg text-gray-600">
                          ({grade.percentage.toFixed(1)}%)
                        </span>
                        <span className="text-sm text-gray-500">
                          {grade.childName}
                        </span>
                      </div>
                      {grade.feedback && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-md">
                          <div className="flex items-start gap-2">
                            <MessageSquare className="h-4 w-4 text-gray-500 mt-0.5" aria-hidden="true" />
                            <p className="text-sm text-gray-700">{grade.feedback}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
              );
              });
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

