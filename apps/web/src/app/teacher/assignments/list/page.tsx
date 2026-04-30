"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  BookOpen,
  Plus,
  Search,
  BarChart3,
  CheckCircle,
  AlertCircle,
  Loader2,
  Calendar,
  Clock,
  Eye,
  Edit,
  Trash2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Badge } from "@ecoledigitale/ui";
import AssignmentDownloadUnified from "@/components/assignments/AssignmentDownloadUnified";
import { useDeleteAssignment, useTeacherEvaluations } from '@/lib/hooks/use-evaluations';
import { useTeacherCourses } from '@/lib/hooks/use-courses';
import { useCurrentTeacherId } from '@/lib/hooks/use-current-teacher';

export default function TeacherAssignmentsListPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

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

  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  // Get current teacher ID and fetch data
  const { data: teacherId, isLoading: loadingTeacherId } = useCurrentTeacherId();
  const { data: teacherCoursesData, isLoading: loadingCourses } = useTeacherCourses(teacherId);
  const { data: assignmentsData, isLoading: loadingAssignments } = useTeacherEvaluations(teacherId, {
    type: selectedType === 'all' ? undefined : selectedType as 'evaluation' | 'homework',
    search: searchTerm || undefined,
    limit: 100
  });
  const deleteAssignmentMutation = useDeleteAssignment();

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

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session || !isTeacher) {
    return null;
  }

  const assignmentTypes = [
    { id: 'all', name: 'Tous les types' },
    { id: 'evaluation', name: 'Évaluations' },
    { id: 'homework', name: 'Devoirs' }
  ];

  const statusOptions = [
    { id: 'all', name: 'Tous les statuts' },
    { id: 'draft', name: 'Brouillon' },
    { id: 'published', name: 'Publié' },
    { id: 'completed', name: 'Terminé' }
  ];

  // Transform API data to match the expected format
  const assignments = (assignmentsData?.assignments || []).map((assignment: any) => ({
    id: assignment.id,
    title: assignment.title,
    course: assignment.course_title || 'Cours inconnu',
    courseId: assignment.course_id,
    type: assignment.type,
    status: assignment.status,
    createdAt: assignment.created_at,
    dueDate: assignment.ends_at,
    submissionsCount: 0,
    totalStudents: 0,
    description: assignment.description,
    subject_document_url: assignment.subject_document_url as string | undefined,
  }));

  // Filter assignments
  const filteredAssignments = assignments.filter(assignment => {
    const matchesSearch =
      assignment.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      assignment.course.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCourse = selectedCourse === 'all' || assignment.courseId === selectedCourse;
    const matchesType = selectedType === 'all' || assignment.type === selectedType;
    const matchesStatus = selectedStatus === 'all' || assignment.status === selectedStatus;

    return matchesSearch && matchesCourse && matchesType && matchesStatus;
  });

  // Show loading state
  if (loadingTeacherId || loadingCourses || loadingAssignments) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          <span className="text-muted-foreground">Chargement des devoirs...</span>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline">Brouillon</Badge>;
      case 'published':
        return <Badge variant="default">Publié</Badge>;
      case 'archived':
        return <Badge variant="secondary">Archivé</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'evaluation':
        return <Badge variant="default">Évaluation</Badge>;
      case 'homework':
        return <Badge variant="secondary">Devoir</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'evaluation':
        return BookOpen;
      case 'homework':
        return FileText;
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
      default:
        return type;
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Non défini';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center">
                <FileText className="w-8 h-8 text-purple-400 mr-3 shrink-0" />
                Liste des Devoirs
              </h1>
              <p className="mt-2 text-muted-foreground">
                Gérez tous vos devoirs et évaluations créés
              </p>
            </div>
            <Button
              onClick={() => router.push('/teacher/assignments/create')}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Créer un devoir
            </Button>
          </div>
        </div>
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Devoirs</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{assignments.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Publiés</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {assignments.filter(a => a.status === 'published').length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Brouillons</CardTitle>
              <AlertCircle className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {assignments.filter(a => a.status === 'draft').length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Terminés</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {assignments.filter(a => a.status === 'completed').length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Search */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Rechercher un devoir..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 text-foreground placeholder:text-muted-foreground"
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
              value={selectedType}
              onValueChange={(value) => setSelectedType(value)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tous les types" />
              </SelectTrigger>
              <SelectContent>
                {assignmentTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedStatus}
              onValueChange={(value) => setSelectedStatus(value)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tous les statuts" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Assignments List */}
        {filteredAssignments.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              {assignments.length === 0 ? 'Aucun devoir créé' : 'Aucun devoir trouvé'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {assignments.length === 0
                ? "Vous n'avez pas encore créé de devoirs."
                : "Aucun devoir ne correspond à vos critères de recherche."}
            </p>
            <Button
              onClick={() => router.push('/teacher/assignments/create')}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Créer votre premier devoir
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredAssignments.map((assignment) => {
              const TypeIcon = getTypeIcon(assignment.type);

              return (
                <Card key={assignment.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-start space-x-4 flex-1">
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <TypeIcon className="w-6 h-6 text-purple-600" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-3 mb-2 flex-wrap">
                            <h3 className="text-lg font-semibold text-foreground">
                              {assignment.title}
                            </h3>
                            {getTypeBadge(assignment.type)}
                            {getStatusBadge(assignment.status)}
                          </div>

                          <div className="flex items-center space-x-6 text-sm text-muted-foreground flex-wrap gap-2">
                            <div className="flex items-center space-x-1">
                              <BookOpen className="w-4 h-4 shrink-0 text-purple-400/90" />
                              <span>{assignment.course}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Calendar className="w-4 h-4 shrink-0 text-purple-400/90" />
                              <span>Créé le {formatDate(assignment.createdAt)}</span>
                            </div>
                            {assignment.dueDate && (
                              <div className="flex items-center space-x-1">
                                <Clock className="w-4 h-4 shrink-0 text-purple-400/90" />
                                <span>Échéance: {formatDate(assignment.dueDate)}</span>
                              </div>
                            )}
                          </div>

                          {assignment.description && (
                            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                              {assignment.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 ml-4 shrink-0">
                        {assignment.type === 'homework' && assignment.subject_document_url && (
                          <AssignmentDownloadUnified
                            assignmentId={assignment.id}
                            fileUrl={assignment.subject_document_url}
                            fileName={`${assignment.title.replace(/[^\w\s.-]/g, "").trim().slice(0, 80) || "sujet"}.pdf`}
                            showFileName={false}
                            variant="outline"
                            size="sm"
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => router.push(`/teacher/assignments/${assignment.id}`)}
                          title="Voir les détails"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => router.push(`/teacher/assignments/${assignment.id}/edit`)}
                          title="Modifier"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm('Êtes-vous sûr de vouloir supprimer ce devoir ?')) {
                              deleteAssignmentMutation.mutate(assignment.id, {
                                onError: (error) => {
                                  console.error('Failed to delete assignment:', error);
                                  alert(error instanceof Error ? error.message : 'La suppression du devoir a échoué.');
                                },
                              });
                            }
                          }}
                          title="Supprimer"
                          className="text-red-500 hover:text-red-400 hover:bg-red-950/30"
                          disabled={deleteAssignmentMutation.isPending}
                        >
                          {deleteAssignmentMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
