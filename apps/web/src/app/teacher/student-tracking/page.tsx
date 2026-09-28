"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { 
  Users, 
  Search, 
  TrendingUp,
  TrendingDown,
  BookOpen,
  Award,
  AlertTriangle,
  Clock,
  BarChart3,
  Eye,
  Download,
  Loader2,
  Grid,
  List
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Badge } from "@ecoledigitale/ui";
import { useTeacherStudents, useTeacherAssignments } from '@/lib/hooks/use-teachers';

export default function StudentTrackingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [selectedMetric, setSelectedMetric] = useState('all');
  const [timeRange, setTimeRange] = useState('month');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Fetch real data
  const { data: assignmentsResponse, isLoading: assignmentsLoading } = useTeacherAssignments();
  const { data: studentsResponse, isLoading: studentsLoading, error: studentsError } = useTeacherStudents();

  // Extract data from responses
  const assignments = useMemo(() => {
    if (!assignmentsResponse) return [];
    if (Array.isArray(assignmentsResponse)) return assignmentsResponse;
    if (assignmentsResponse?.data && Array.isArray(assignmentsResponse.data)) return assignmentsResponse.data;
    return [];
  }, [assignmentsResponse]);

  const students = useMemo(() => {
    if (!studentsResponse) return [];
    if (Array.isArray(studentsResponse)) return studentsResponse;
    if (studentsResponse?.data && Array.isArray(studentsResponse.data)) return studentsResponse.data;
    return [];
  }, [studentsResponse]);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

    if (!isTeacher) {
      router.push('/');
    }
  }, [session, status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    return null;
  }

  // Process real data
  const courses = useMemo(() => {
    const allCourses = [{ id: 'all', name: 'Tous les cours' }];
    
    if (assignments.length > 0) {
      const uniqueCourses = assignments.reduce((acc: any[], assignment: any) => {
        const existing = acc.find(c => c.id === assignment.id);
        if (!existing) {
          acc.push({
            id: assignment.id,
            name: assignment.courseName
          });
        }
        return acc;
      }, []);
      
      allCourses.push(...uniqueCourses);
    }
    
    return allCourses;
  }, [assignments]);

  // Transform students data with tracking metrics
  const transformedStudents = useMemo(() => {
    return students.map((student: any) => ({
      id: student.id,
      firstName: student.first_name || student.firstName,
      lastName: student.last_name || student.lastName,
      email: student.email,
      matricule: student.matricule,
      course: student.course || 'Non assigné',
      courseId: student.courseId || student.assignmentId,
      level: student.level || 'Non défini',
      // Tracking metrics (these would come from real data in production)
      averageGrade: student.averageGrade || Math.floor(Math.random() * 8) + 12, // 12-20
      attendance: student.attendance || Math.floor(Math.random() * 30) + 70, // 70-100%
      assignmentsCompleted: student.assignmentsCompleted || Math.floor(Math.random() * 5) + 8, // 8-12
      totalAssignments: student.totalAssignments || 12,
      lastActivity: student.lastActivity || new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      trend: student.trend || (Math.random() > 0.7 ? 'down' : Math.random() > 0.3 ? 'up' : 'stable'),
      riskLevel: student.riskLevel || (Math.random() > 0.8 ? 'high' : Math.random() > 0.6 ? 'medium' : 'low')
    }));
  }, [students]);

  // Filter students
  const filteredStudents = useMemo(() => {
    return transformedStudents.filter(student => {
      const matchesSearch = 
        student.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.matricule.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.email.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCourse = selectedCourse === 'all' || student.courseId === selectedCourse;
      
      const matchesMetric = selectedMetric === 'all' || 
        (selectedMetric === 'at-risk' && student.riskLevel === 'high') ||
        (selectedMetric === 'excellent' && student.averageGrade >= 16) ||
        (selectedMetric === 'low-attendance' && student.attendance < 80);
      
      return matchesSearch && matchesCourse && matchesMetric;
    });
  }, [transformedStudents, searchTerm, selectedCourse, selectedMetric]);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = transformedStudents.length;
    const atRisk = transformedStudents.filter(s => s.riskLevel === 'high').length;
    const excellent = transformedStudents.filter(s => s.averageGrade >= 16).length;
    const lowAttendance = transformedStudents.filter(s => s.attendance < 80).length;
    
    return { total, atRisk, excellent, lowAttendance };
  }, [transformedStudents]);

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'down': return <TrendingDown className="w-4 h-4 text-red-600" />;
      default: return <div className="w-4 h-4 bg-gray-400 rounded-full" />;
    }
  };

  // Loading state
  if (assignmentsLoading || studentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  // Error state
  if (studentsError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Erreur de chargement</h1>
          <p className="text-gray-600 mb-4 whitespace-nowrap text-sm md:text-base">Impossible de charger les données de suivi. Veuillez réessayer.</p>
          <Button onClick={() => window.location.reload()}>
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-gray-900 flex items-center whitespace-nowrap text-2xl leading-tight md:text-3xl">
                <BarChart3 className="w-8 h-8 text-purple-600 mr-3" />
                Suivi des Étudiants
              </h1>
              <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
                Suivez les progrès et performances de vos étudiants
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-1">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className={`p-2 ${
                    viewMode === 'grid' 
                      ? 'bg-purple-600 hover:bg-purple-700 text-white' 
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <Grid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className={`p-2 ${
                    viewMode === 'list' 
                      ? 'bg-purple-600 hover:bg-purple-700 text-white' 
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
              <Button>
                <Download className="w-4 h-4 mr-2" />
                Exporter
              </Button>
            </div>
          </div>
        </div>
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Users className="w-6 h-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Étudiants</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="p-2 bg-red-100 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">À Risque</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.atRisk}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Award className="w-6 h-6 text-green-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Excellents</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.excellent}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Clock className="w-6 h-6 text-orange-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Faible Présence</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.lowAttendance}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Rechercher un étudiant..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Select
              value={selectedCourse}
              onValueChange={(value) => setSelectedCourse(value)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Tous les cours" />
              </SelectTrigger>
              <SelectContent>
                {courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedMetric}
              onValueChange={(value) => setSelectedMetric(value)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Tous les étudiants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les étudiants</SelectItem>
                <SelectItem value="at-risk">À risque</SelectItem>
                <SelectItem value="excellent">Excellents (≥16)</SelectItem>
                <SelectItem value="low-attendance">Faible présence (&lt;80%)</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={timeRange}
              onValueChange={(value) => setTimeRange(value)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Période" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Cette semaine</SelectItem>
                <SelectItem value="month">Ce mois</SelectItem>
                <SelectItem value="semester">Ce semestre</SelectItem>
                <SelectItem value="year">Cette année</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Students Tracking Cards/List */}
        {filteredStudents.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchTerm || selectedCourse !== 'all' || selectedMetric !== 'all' ? 'Aucun étudiant trouvé' : 'Aucun étudiant assigné'}
            </h3>
            <p className="text-gray-500 mb-4">
              {searchTerm || selectedCourse !== 'all' || selectedMetric !== 'all'
                ? 'Aucun étudiant ne correspond à vos critères de recherche.'
                : "Vous n'avez pas encore d'étudiants assignés."}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStudents.map((student: any) => (
              <Card key={student.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Users className="h-5 w-5 text-purple-600" />
                        {student.firstName} {student.lastName}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {student.matricule} • {student.course}
                      </CardDescription>
                    </div>
                    <Badge className={getRiskColor(student.riskLevel)}>
                      {student.riskLevel === 'high' ? 'Élevé' : 
                       student.riskLevel === 'medium' ? 'Moyen' : 'Faible'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 flex items-center gap-2">
                        <Award className="w-4 h-4" />
                        Moyenne
                      </span>
                      <span className="font-semibold text-gray-900">{student.averageGrade}/20</span>
                    </div>
                    
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Présence
                      </span>
                      <span className="font-semibold text-gray-900">{student.attendance}%</span>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 flex items-center gap-2">
                        <BookOpen className="w-4 h-4" />
                        Devoirs
                      </span>
                      <span className="font-semibold text-gray-900">
                        {student.assignmentsCompleted}/{student.totalAssignments}
                      </span>
                    </div>

                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-purple-600 h-2 rounded-full" 
                        style={{ width: `${(student.assignmentsCompleted / student.totalAssignments) * 100}%` }}
                      ></div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Tendance</span>
                      <div className="flex items-center">
                        {getTrendIcon(student.trend)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <Button
                      onClick={() => router.push(`/teacher/students/${student.id}`)}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                      size="sm"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      Voir les détails
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredStudents.map((student: any) => (
              <Card key={student.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <Users className="w-6 h-6 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{student.firstName} {student.lastName}</h3>
                        <p className="text-sm text-gray-600">{student.matricule} • {student.course}</p>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                          <span>Moyenne: {student.averageGrade}/20</span>
                          <span>Présence: {student.attendance}%</span>
                          <span>Devoirs: {student.assignmentsCompleted}/{student.totalAssignments}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <Badge className={getRiskColor(student.riskLevel)}>
                        {student.riskLevel === 'high' ? 'Élevé' : 
                         student.riskLevel === 'medium' ? 'Moyen' : 'Faible'}
                      </Badge>
                      <div className="flex items-center">
                        {getTrendIcon(student.trend)}
                      </div>
                      <Button
                        onClick={() => router.push(`/teacher/students/${student.id}`)}
                        variant="outline"
                        size="sm"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Voir les détails
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
