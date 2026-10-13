"use client";

import React, { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { useTeacherEvaluations } from '@/lib/hooks/use-evaluations';
import { useTeacherCourses } from '@/lib/hooks/use-courses';
import { useCurrentTeacherId } from '@/lib/hooks/use-current-teacher';
import { AntSelect } from "@/platform/ui/FormField";
import { 
  Archive, 
  Calendar, 
  Users, 
  Award, 
  BookOpen, 
  Filter,
  Search,
  Eye,
  Download,
  BarChart3,
  TrendingUp,
  FileText
} from 'lucide-react';

export default function EvaluationHistoryPage() {
  const { data: session, status } = useSession();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedPeriod, setSelectedPeriod] = useState('all');

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has teacher role
  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    redirect('/');
  }

  // Get current teacher ID and fetch data
  const { data: teacherId, isLoading: loadingTeacherId } = useCurrentTeacherId();
  const { data: teacherCoursesData, isLoading: loadingCourses } = useTeacherCourses(teacherId);
  const { data: evaluationsData, isLoading: loadingEvaluations } = useTeacherEvaluations(teacherId, {
    type: selectedType === 'all' ? undefined : selectedType as 'evaluation' | 'homework',
    search: searchTerm || undefined,
    limit: 50
  });

  // Transform courses data for dropdown - deduplicate by courseId
  const courses = useMemo(() => {
    if (!teacherCoursesData || teacherCoursesData.length === 0) {
      return [{ id: 'all', name: 'Tous les cours' }];
    }

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

    return [
      { id: 'all', name: 'Tous les cours' },
      ...Array.from(coursesMap.values()).map((course: any) => ({
        id: course.courseId,
        name: course.courseName
      }))
    ];
  }, [teacherCoursesData]);

  const evaluationTypes = [
    { id: 'all', name: 'Tous les types' },
    { id: 'evaluation', name: 'Évaluations' },
    { id: 'homework', name: 'Devoirs' }
  ];

  const periods = [
    { id: 'all', name: 'Toutes les périodes' },
    { id: 'current', name: 'Semestre actuel' },
    { id: 'last', name: 'Semestre dernier' },
    { id: 'year', name: 'Cette année' }
  ];

  // Transform API data to match the expected format
  const evaluations = (evaluationsData?.assignments || []).map((assignment: any) => ({
    id: assignment.id,
    title: assignment.title,
    course: assignment.course_title || 'Cours inconnu',
    courseId: assignment.course_id,
    type: assignment.type,
    date: assignment.ends_at ? new Date(assignment.ends_at).toISOString().split('T')[0] : '',
    totalPoints: 0, // Not available in current API
    studentsCount: 0, // Not available in current API
    submissionsCount: 0, // Not available in current API
    averageGrade: 0, // Not available in current API
    minGrade: 0, // Not available in current API
    maxGrade: 0, // Not available in current API
    status: assignment.status === 'published' ? 'completed' : assignment.status,
    correctedCount: 0 // Not available in current API
  }));

  // Filter evaluations
  const filteredEvaluations = evaluations.filter(evaluation => {
    const matchesSearch =
      evaluation.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      evaluation.course.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCourse = selectedCourse === 'all' || evaluation.courseId === selectedCourse;
    const matchesType = selectedType === 'all' || evaluation.type === selectedType;

    return matchesSearch && matchesCourse && matchesType;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'evaluation':
        return BookOpen;
      case 'homework':
        return FileText;
      case 'exam':
        return BookOpen;
      case 'quiz':
        return Award;
      case 'project':
        return Users;
      default:
        return FileText;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'evaluation':
        return 'Évaluation';
      case 'homework':
        return 'Devoir';
      case 'exam':
        return 'Examen';
      case 'quiz':
        return 'Quiz';
      case 'project':
        return 'Projet';
      default:
        return 'Évaluation';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'exam':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'homework':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'quiz':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'project':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  // Show loading state
  if (loadingTeacherId || loadingCourses || loadingEvaluations) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  // Calculate overall statistics
  const totalEvaluations = filteredEvaluations.length;
  const totalStudents = filteredEvaluations.reduce((sum, eval_) => sum + eval_.studentsCount, 0);
  const overallAverage = filteredEvaluations.reduce((sum, eval_) => sum + eval_.averageGrade, 0) / totalEvaluations || 0;
  const completionRate = filteredEvaluations.reduce((sum, eval_) => sum + (eval_.submissionsCount / eval_.studentsCount), 0) / totalEvaluations * 100 || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-purple-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
                Historique des Évaluations
              </h1>
              <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
                Consultez l'historique complet de vos évaluations et leurs résultats
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <button className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                <Download className="w-4 h-4" />
                <span>Exporter</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Évaluations</p>
                <p className="text-3xl font-bold text-purple-600">{totalEvaluations}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <Archive className="w-8 h-8 text-purple-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Étudiants Évalués</p>
                <p className="text-3xl font-bold text-blue-600">{totalStudents}</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Users className="w-8 h-8 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Moyenne Générale</p>
                <p className="text-3xl font-bold text-green-600">{overallAverage.toFixed(1)}/20</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <BarChart3 className="w-8 h-8 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Taux de Participation</p>
                <p className="text-3xl font-bold text-orange-600">{completionRate.toFixed(0)}%</p>
              </div>
              <div className="bg-orange-100 p-3 rounded-lg">
                <TrendingUp className="w-8 h-8 text-orange-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <AntSelect
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </AntSelect>

            <AntSelect
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {evaluationTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </AntSelect>

            <AntSelect
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name}
                </option>
              ))}
            </AntSelect>
          </div>
        </div>

        {/* Evaluations List */}
        <div className="space-y-4">
          {filteredEvaluations.map((evaluation) => {
            const TypeIcon = getTypeIcon(evaluation.type);
            
            return (
              <div key={evaluation.id} className="bg-white rounded-xl shadow-sm border border-purple-100 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-3">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {evaluation.title}
                      </h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getTypeColor(evaluation.type)}`}>
                        {getTypeLabel(evaluation.type)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <BookOpen className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">{evaluation.course}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">{formatDate(evaluation.date)}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {evaluation.submissionsCount}/{evaluation.studentsCount} étudiants
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Award className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {evaluation.totalPoints} points
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Moyenne</p>
                        <p className="text-lg font-semibold text-gray-900">
                          {evaluation.averageGrade.toFixed(1)}/20
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Note Min/Max</p>
                        <p className="text-lg font-semibold text-gray-900">
                          {evaluation.minGrade} - {evaluation.maxGrade}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Participation</p>
                        <p className="text-lg font-semibold text-gray-900">
                          {((evaluation.submissionsCount / evaluation.studentsCount) * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col space-y-2 ml-6">
                    <button className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                      <Eye className="w-4 h-4" />
                      <span>Détails</span>
                    </button>
                    <button className="flex items-center space-x-2 px-4 py-2 border border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors">
                      <BarChart3 className="w-4 h-4" />
                      <span>Analyses</span>
                    </button>
                    <button className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                      <Download className="w-4 h-4" />
                      <span>Export</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredEvaluations.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-12 text-center">
            <Archive className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune évaluation trouvée</h3>
            <p className="text-gray-600">
              Aucune évaluation ne correspond à vos critères de recherche.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
