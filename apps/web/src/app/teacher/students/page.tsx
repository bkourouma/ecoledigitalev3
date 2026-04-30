"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  Filter,
  BookOpen,
  Award,
  TrendingUp,
  Eye,
  Download,
  Loader2,
  Grid,
  List
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { useTeacherStudentsByClass } from '@/lib/hooks/use-teachers';

export default function TeacherStudentsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClass, setSelectedClass] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Fetch data using new hook
  const { data, isLoading, error } = useTeacherStudentsByClass(selectedClass, false);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session) {
      router.push('/login');
      return;
    }

    // Check if user has teacher role
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

  // Check if user has teacher role
  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  if (!isTeacher) {
    return null;
  }

  // Extract data from API response
  const classes = data?.classes || [];
  const students = data?.students || [];

  // Filter students based on search (class filter already applied by API)
  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      const matchesSearch =
        student.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.matricule.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.email.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSearch;
    });
  }, [students, searchTerm]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'inactive':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Actif';
      case 'warning':
        return 'Attention';
      case 'inactive':
        return 'Inactif';
      default:
        return 'Inconnu';
    }
  };

  const handleViewStudent = (studentId: string) => {
    router.push(`/teacher/students/${studentId}`);
  };

  // Calculate statistics
  const totalStudents = filteredStudents.length;
  const activeStudents = filteredStudents.filter(s => s.status === 'active').length;
  const averageGrade = filteredStudents.length > 0
    ? filteredStudents.reduce((sum, s) => sum + (s.average || 0), 0) / filteredStudents.length
    : 0;
  const averageAttendance = filteredStudents.length > 0
    ? filteredStudents.reduce((sum, s) => sum + (s.attendance || 0), 0) / filteredStudents.length
    : 0;

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Erreur de chargement</h1>
          <p className="text-muted-foreground mb-4">Impossible de charger les étudiants. Veuillez réessayer.</p>
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
              <h1 className="text-3xl font-bold text-foreground flex items-center">
                <Users className="w-8 h-8 text-purple-400 mr-3" />
                Mes Étudiants
              </h1>
              <p className="mt-2 text-muted-foreground">
                Gestion et suivi de vos étudiants
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 rounded-lg border border-border bg-secondary/50 p-1">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className={`p-2 ${
                    viewMode === 'grid' 
                      ? 'bg-purple-600 hover:bg-purple-700 text-white' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Users className="w-6 h-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted-foreground">Total Étudiants</p>
                  <p className="text-2xl font-bold text-foreground">{totalStudents}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Award className="w-6 h-6 text-blue-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted-foreground">Moyenne Générale</p>
                  <p className="text-2xl font-bold text-foreground">{averageGrade.toFixed(1)}/20</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="p-2 bg-green-100 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-green-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted-foreground">Présence Moyenne</p>
                  <p className="text-2xl font-bold text-foreground">{averageAttendance.toFixed(0)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Rechercher un étudiant..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="space-y-2">
              <Select
                value={selectedClass}
                onValueChange={(value) => setSelectedClass(value)}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Toutes les classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les classes</SelectItem>
                  {classes.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name} ({cls.studentCount} étudiants)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Students Grid/List */}
        {filteredStudents.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              {searchTerm || selectedClass !== 'all' ? 'Aucun étudiant trouvé' : 'Aucun étudiant assigné'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm || selectedClass !== 'all'
                ? 'Aucun étudiant ne correspond à vos critères de recherche.'
                : "Vous n'avez pas encore d'étudiants assignés."}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStudents.map((student: any) => (
              <Card key={student.id} className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center gap-2 text-foreground">
                        <Users className="h-5 w-5 text-purple-400 shrink-0" />
                        {student.firstName} {student.lastName}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {student.matricule} • {student.className}
                      </CardDescription>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(student.status)}`}>
                      {getStatusLabel(student.status)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center text-sm text-muted-foreground">
                      <BookOpen className="w-4 h-4 mr-2 shrink-0 text-purple-400/90" />
                      {student.className} ({student.classCode})
                    </div>
                    
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Award className="w-4 h-4 mr-2 shrink-0 text-purple-400/90" />
                      Moyenne: {student.average ? `${student.average.toFixed(1)}/20` : '-/20'}
                    </div>

                    <div className="flex items-center text-sm text-muted-foreground">
                      <TrendingUp className="w-4 h-4 mr-2 shrink-0 text-purple-400/90" />
                      Présence: {student.attendance ? `${student.attendance.toFixed(0)}%` : '-%'}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border">
                    <Button
                      onClick={() => handleViewStudent(student.id)}
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
                        <h3 className="text-lg font-semibold text-foreground">{student.firstName} {student.lastName}</h3>
                        <p className="text-sm text-muted-foreground">{student.matricule} • {student.className}</p>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          <span>Moyenne: {student.average ? `${student.average.toFixed(1)}/20` : '-/20'}</span>
                          <span>Présence: {student.attendance ? `${student.attendance.toFixed(0)}%` : '-%'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className={`px-3 py-1 text-sm rounded-full ${getStatusColor(student.status)}`}>
                        {getStatusLabel(student.status)}
                      </span>
                      <Button
                        onClick={() => handleViewStudent(student.id)}
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
