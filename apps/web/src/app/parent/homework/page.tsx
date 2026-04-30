'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, BookOpen, Clock } from 'lucide-react';
import { useActiveAssignments, useUpcomingDeadlines, useParentGrades, useCourseMaterials } from '@/lib/hooks/use-parent-homework';
import { useParentChildren } from '@/lib/hooks/use-parent-children';
import { ActiveAssignments } from '../components/homework/ActiveAssignments';
import { UpcomingDeadlines } from '../components/homework/UpcomingDeadlines';
import { GradesReceived } from '../components/homework/GradesReceived';
import { CourseMaterials } from '../components/homework/CourseMaterials';
import { AssignmentFilter } from '@ecoledigitale/contracts';

export default function ParentHomeworkPage() {
  const { data: session, status } = useSession();
  const [filters, setFilters] = useState<AssignmentFilter>({});
  const [selectedChildId, setSelectedChildId] = useState<string | undefined>(undefined);
  const [selectedCourseId, setSelectedCourseId] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<{ startDate?: string; endDate?: string }>({});

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has parent role
  const roles = (session as any)?.roles ?? [];
  const isParent = Array.isArray(roles) && roles.some((r: string) => ['parent', 'Parent'].includes(r));

  if (!isParent) {
    redirect('/');
  }

  // Fetch children list for filter
  const { data: childrenData, isLoading: isLoadingChildren } = useParentChildren();
  // Deduplicate children by id to ensure uniqueness
  // IMPORTANT: Remove duplicates by ID, but keep the first occurrence
  const children = React.useMemo(() => {
    if (!childrenData?.data?.children) return [];
    
    // Log to detect duplicates
    const idCounts = new Map<string, number>();
    childrenData.data.children.forEach((child: any) => {
      idCounts.set(child.id, (idCounts.get(child.id) || 0) + 1);
    });
    const duplicateIds = Array.from(idCounts.entries()).filter(([id, count]) => count > 1);
    if (duplicateIds.length > 0) {
      console.error(`[ParentHomeworkPage] DUPLICATE CHILD IDs FOUND:`, duplicateIds);
    }
    
    // Remove duplicates by keeping only the first occurrence of each ID
    const seenIds = new Set<string>();
    const uniqueChildren: any[] = [];
    childrenData.data.children.forEach((child: any, index: number) => {
      if (!seenIds.has(child.id)) {
        seenIds.add(child.id);
        uniqueChildren.push(child);
      } else {
        console.warn(`[ParentHomeworkPage] Skipping duplicate child: ${child.id} at index ${index}`);
      }
    });
    
    // Log all child IDs to help debug
    console.log(`[ParentHomeworkPage] Unique children (${uniqueChildren.length}):`, uniqueChildren.map(c => ({ id: c.id, name: c.name })));
    
    return uniqueChildren;
  }, [childrenData?.data?.children]);

  // Fetch active assignments
  const { data: assignmentsData, isLoading: isLoadingAssignments, error: assignmentsError } = useActiveAssignments(filters);
  const assignments = assignmentsData?.data?.assignments || null;

  // Fetch upcoming deadlines
  const { data: deadlinesData, isLoading: isLoadingDeadlines, error: deadlinesError } = useUpcomingDeadlines(selectedChildId);
  const deadlines = deadlinesData?.data?.deadlines || null;

  // Fetch grades
  const { data: gradesData, isLoading: isLoadingGrades, error: gradesError } = useParentGrades(
    selectedChildId,
    {
      courseId: selectedCourseId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    }
  );
  
  // Deduplicate grades by composite key to ensure uniqueness
  // IMPORTANT: Utiliser l'index pour garantir l'unicité même si les IDs sont dupliqués
  const grades = React.useMemo(() => {
    if (!gradesData?.data?.grades) return null;
    
    console.log(`[ParentHomeworkPage] Received ${gradesData.data.grades.length} grades from API`);
    
    // Vérifier les doublons d'ID avant déduplication
    const idCounts = new Map<string, number>();
    gradesData.data.grades.forEach((grade: any) => {
      idCounts.set(grade.id, (idCounts.get(grade.id) || 0) + 1);
    });
    
    const duplicateIds = Array.from(idCounts.entries()).filter(([id, count]) => count > 1);
    if (duplicateIds.length > 0) {
      console.error(`[ParentHomeworkPage] DUPLICATE IDs FOUND IN API RESPONSE:`, duplicateIds);
    }
    
    // Use composite key (id + assignmentId + childId) to handle edge cases
    // Mais aussi utiliser l'index pour garantir l'unicité absolue
    const gradesMap = new Map<string, any>();
    const seenKeys = new Set<string>();
    let index = 0;
    
    gradesData.data.grades.forEach((grade: any, originalIndex: number) => {
      // Create composite key to ensure uniqueness
      const compositeKey = `${grade.id}-${grade.assignmentId || ''}-${grade.childId || ''}`;
      
      // Skip if we've already seen this composite key (même grade logique)
      if (seenKeys.has(compositeKey)) {
        console.warn(`[ParentHomeworkPage] Duplicate grade found: ${compositeKey}`, grade);
        return;
      }
      
      seenKeys.add(compositeKey);
      // Ajouter l'index au grade pour garantir l'unicité
      gradesMap.set(`${compositeKey}-${index++}`, { ...grade, _originalIndex: originalIndex });
    });
    
    const result = Array.from(gradesMap.values());
    if (result.length !== gradesData.data.grades.length) {
      console.warn(`[ParentHomeworkPage] Deduplicated grades: ${gradesData.data.grades.length} -> ${result.length}`);
    }
    
    // Vérifier qu'il n'y a pas de doublons d'ID dans le résultat final
    const finalIdCounts = new Map<string, number>();
    result.forEach((grade: any) => {
      finalIdCounts.set(grade.id, (finalIdCounts.get(grade.id) || 0) + 1);
    });
    const finalDuplicateIds = Array.from(finalIdCounts.entries()).filter(([id, count]) => count > 1);
    if (finalDuplicateIds.length > 0) {
      console.error(`[ParentHomeworkPage] DUPLICATE IDs IN FINAL RESULT:`, finalDuplicateIds);
    }
    
    return result;
  }, [gradesData?.data?.grades]);
  
  const statistics = gradesData?.data?.statistics || null;

  // Fetch course materials
  const { data: materialsData, isLoading: isLoadingMaterials, error: materialsError } = useCourseMaterials(
    selectedChildId,
    selectedCourseId
  );
  const materials = materialsData?.data?.materials || null;

  // Extract unique courses from assignments for filter
  const courses = React.useMemo(() => {
    const courseMap = new Map<string, { id: string; name: string }>();
    
    // Add courses from active assignments
    if (assignments) {
      assignments.forEach((assignment) => {
        if (!courseMap.has(assignment.courseId)) {
          courseMap.set(assignment.courseId, {
            id: assignment.courseId,
            name: assignment.courseName,
          });
        }
      });
    }
    
    return Array.from(courseMap.values());
  }, [assignments]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Cours & Devoirs</h1>
              <p className="text-sm sm:text-base text-emerald-100">
                Suivez les devoirs actifs, les échéances et les notes de vos enfants
              </p>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm" role="region" aria-label="Statistiques des devoirs">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm font-medium">Devoirs Actifs</span>
                </div>
                <div className="text-2xl font-bold" aria-live="polite">
                  {assignments?.length || 0}
                </div>
              </div>
              <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm" role="region" aria-label="Statistiques des échéances">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm font-medium">Échéances</span>
                </div>
                <div className="text-2xl font-bold" aria-live="polite">
                  {deadlines?.length || 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Upcoming Deadlines */}
          <UpcomingDeadlines
            deadlines={deadlines}
            isLoading={isLoadingDeadlines}
            error={deadlinesError as Error | null}
            children={children}
            selectedChildId={selectedChildId}
            onChildChange={setSelectedChildId}
          />

          {/* Active Assignments */}
          <ActiveAssignments
            assignments={assignments}
            isLoading={isLoadingAssignments}
            error={assignmentsError as Error | null}
            children={children}
            courses={courses}
            filters={filters}
            onFiltersChange={setFilters}
          />

          {/* Grades Received */}
          <GradesReceived
            grades={grades}
            statistics={statistics}
            isLoading={isLoadingGrades}
            error={gradesError as Error | null}
            children={children}
            courses={courses}
            selectedChildId={selectedChildId}
            selectedCourseId={selectedCourseId}
            onChildChange={setSelectedChildId}
            onCourseChange={setSelectedCourseId}
            onDateRangeChange={(startDate, endDate) => {
              setDateRange({ startDate, endDate });
            }}
          />

          {/* Course Materials */}
          <CourseMaterials
            materials={materials}
            isLoading={isLoadingMaterials}
            error={materialsError as Error | null}
            children={children}
            courses={courses}
            selectedChildId={selectedChildId}
            selectedCourseId={selectedCourseId}
            onChildChange={setSelectedChildId}
            onCourseChange={setSelectedCourseId}
          />
        </div>
      </div>
    </div>
  );
}

