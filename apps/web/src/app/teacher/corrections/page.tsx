"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  Label,
} from "@ecoledigitale/ui";
import {
  GraduationCap,
  Search,
  Download,
  Eye,
  Edit,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import toast from "react-hot-toast";
import AssignmentDownloadUnified from '@/components/assignments/AssignmentDownloadUnified';
import { createApiHeaders } from '@/lib/api-utils';
import Link from 'next/link';

interface Submission {
  id: string;
  assignment: {
    id: string;
    title: string;
    type: string;
  };
  course: {
    id: string;
    name: string;
    code: string;
  };
  class: {
    id: string;
    name: string;
  } | null;
  student: {
    id: string;
    number: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
  };
  file: {
    url: string;
    name: string;
    size_mb: number;
  };
  grade: {
    manual_score: number | null;
    final_score: number | null;
    feedback: string | null;
  };
  status: 'submitted' | 'graded' | 'in_progress';
  submitted_at: string | null;
  graded_at: string | null;
  is_late: boolean;
}

interface CorrectionsResponse {
  success: boolean;
  data: {
    submissions: Submission[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
  error?: string;
}

export default function TeacherCorrectionsPage() {
  const { data: session, status } = useSession();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [gradeModalOpen, setGradeModalOpen] = useState(false);
  const [gradeForm, setGradeForm] = useState({ score: '', feedback: '' });
  const [grading, setGrading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<Array<{ id: string; name: string; code?: string }>>([]);

  const fetchSubmissions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      if (classFilter !== 'all') {
        params.append('class_id', classFilter);
      }
      if (courseFilter !== 'all') {
        params.append('course_id', courseFilter);
      }

      console.log('🔍 Fetching submissions with params:', Object.fromEntries(params));

      // Use the Next.js API route which forwards to backend
      const response = await fetch(`/api/teacher/corrections?${params}`, {
        headers: createApiHeaders(session),
      });

      const data: CorrectionsResponse = await response.json();

      console.log('📦 API Response:', {
        ok: response.ok,
        status: response.status,
        success: data.success,
        submissionsCount: data.data?.submissions?.length || 0,
        error: data.error
      });

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch submissions');
      }

      if (data.success) {
        console.log('✅ Setting submissions:', data.data.submissions.length);
        setSubmissions(data.data.submissions);
      } else {
        throw new Error(data.error || 'Failed to fetch submissions');
      }
    } catch (error) {
      console.error('❌ Error fetching submissions:', error);
      setError(error instanceof Error ? error.message : 'An error occurred');
      toast.error('Erreur lors du chargement des soumissions');
    } finally {
      setLoading(false);
    }
  }, [session, statusFilter, classFilter, courseFilter]);

  useEffect(() => {
    if (classFilter && classFilter !== 'all') {
      const coursesFromSubmissions = Array.from(new Set(
        submissions
          .filter(sub => sub.class?.id === classFilter)
          .map(sub => JSON.stringify({ id: sub.course.id, name: sub.course.name, code: sub.course.code }))
      )).map(str => JSON.parse(str));
      setAvailableCourses(coursesFromSubmissions);
    } else {
      setAvailableCourses([]);
    }
  }, [classFilter, submissions]);

  useEffect(() => {
    if (!session?.user?.id) return;
    void fetchSubmissions();
  }, [session?.user?.id, fetchSubmissions]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  const handleGradeSubmission = async () => {
    if (!selectedSubmission || !gradeForm.score) return;

    const score = parseFloat(gradeForm.score);
    if (isNaN(score) || score < 0 || score > 20) {
      toast.error('La note doit être entre 0 et 20');
      return;
    }

    try {
      setGrading(true);

      const response = await fetch(`/api/assignments/${selectedSubmission.assignment.id}/submissions/${selectedSubmission.id}/grade`, {
        method: 'POST',
        headers: createApiHeaders(session),
        body: JSON.stringify({
          manual_score: score,
          feedback: gradeForm.feedback || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to grade submission');
      }

      if (data.success) {
        // Update the submission in the list
        setSubmissions(prev => prev.map(sub =>
          sub.id === selectedSubmission.id
            ? {
                ...sub,
                grade: {
                  manual_score: score,
                  final_score: score,
                  feedback: gradeForm.feedback || null,
                },
                status: 'graded' as const,
                graded_at: new Date().toISOString(),
              }
            : sub
        ));

        toast.success('Note enregistrée avec succès');
        setGradeModalOpen(false);
        setGradeForm({ score: '', feedback: '' });
        setSelectedSubmission(null);
      } else {
        throw new Error(data.error || 'Failed to grade submission');
      }
    } catch (error) {
      console.error('Error grading submission:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur lors de la notation');
    } finally {
      setGrading(false);
    }
  };

  const getStatusBadge = (status: string, isLate: boolean) => {
    if (status === 'graded') {
      return (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
          Corrigé
        </Badge>
      );
    }
    if (status === 'submitted') {
      return (
        <Badge variant={isLate ? "destructive" : "secondary"}>
          {isLate ? 'En retard' : 'Soumis'}
        </Badge>
      );
    }
    if (status === 'in_progress') {
      return (
        <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-300">
          En cours
        </Badge>
      );
    }
    return <Badge variant="outline">En cours</Badge>;
  };

  const getGradeDisplay = (grade: Submission['grade']) => {
    if (grade.final_score !== null) {
      const score = grade.final_score;
      const colorClass =
        score >= 15 ? 'text-emerald-400' : score >= 10 ? 'text-amber-400' : 'text-red-400';
      return <span className={`font-semibold ${colorClass}`}>{score}/20</span>;
    }
    return <span className="text-muted-foreground">—</span>;
  };

  const handleExport = async () => {
    try {
      setExporting(true);

      // Create CSV content with BOM for proper Excel encoding
      const BOM = '\uFEFF';
      const headers = [
        'Étudiant',
        'Numéro Étudiant',
        'Classe',
        'Devoir',
        'Cours',
        'Soumis le',
        'Statut',
        'Note',
        'Commentaires',
        'En retard'
      ];

      const csvContent = [
        headers.join(','),
        ...filteredSubmissions.map(submission => [
          `"${submission.student.full_name.replace(/"/g, '""')}"`,
          `"${submission.student.number.replace(/"/g, '""')}"`,
          `"${submission.class?.name || ''}"`,
          `"${submission.assignment.title.replace(/"/g, '""')}"`,
          `"${submission.course.name.replace(/"/g, '""')} (${submission.course.code})"`,
          `"${submission.submitted_at ? format(new Date(submission.submitted_at), 'dd/MM/yyyy HH:mm', { locale: fr }) : ''}"`,
          `"${submission.status === 'graded' ? 'Corrigé' : submission.status === 'submitted' ? 'Soumis' : 'En cours'}"`,
          `"${submission.grade.final_score || ''}"`,
          `"${(submission.grade.feedback || '').replace(/"/g, '""')}"`,
          `"${submission.is_late ? 'Oui' : 'Non'}"`
        ].join(','))
      ].join('\n');

      // Create and download file with BOM for Excel compatibility
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `corrections_${format(new Date(), 'yyyy-MM-dd_HH-mm', { locale: fr })}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('Export réussi');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Erreur lors de l\'export');
    } finally {
      setExporting(false);
    }
  };


  // Get unique classes from submissions data
  const uniqueClasses = Array.from(new Set(
    submissions
      .filter(sub => sub.class !== null)
      .map(sub => JSON.stringify({ id: sub.class!.id, name: sub.class!.name }))
  )).map(str => JSON.parse(str));

  // Debug logging
  console.log('🔍 Debug Info:', {
    submissionsCount: submissions.length,
    uniqueClassesCount: uniqueClasses.length,
    uniqueClasses,
    loading,
    error
  });

  const filteredSubmissions = submissions.filter(submission => {
    const matchesSearch = submission.student.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      submission.assignment.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      submission.course.name.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesClass = classFilter === 'all' || submission.class?.id === classFilter;
    const matchesCourse = courseFilter === 'all' || submission.course.id === courseFilter;

    return matchesSearch && matchesClass && matchesCourse;
  });

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
          <span className="ml-2 text-lg text-muted-foreground">Chargement des corrections...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Erreur</h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={fetchSubmissions}>Réessayer</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
          <GraduationCap className="h-8 w-8 text-purple-400 shrink-0" />
          Corrections des Devoirs
        </h1>
        <p className="text-muted-foreground">
          Gérez et corrigez les soumissions de vos étudiants
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Rechercher par étudiant, devoir ou cours..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div className="sm:w-48">
              <Select value={classFilter} onValueChange={(value) => {
                setClassFilter(value);
                setCourseFilter('all'); // Reset course filter when class changes
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Classe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les classes</SelectItem>
                  {uniqueClasses.length === 0 ? (
                    <SelectItem value="empty" disabled>Aucune classe disponible</SelectItem>
                  ) : (
                    uniqueClasses.map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:w-48">
              <Select
                value={courseFilter}
                onValueChange={setCourseFilter}
                disabled={classFilter === 'all'}
              >
                <SelectTrigger>
                  <SelectValue placeholder={classFilter === 'all' ? 'Sélectionnez une classe' : 'Cours'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les cours</SelectItem>
                  {availableCourses.length === 0 ? (
                    <SelectItem value="empty" disabled>Aucun cours disponible</SelectItem>
                  ) : (
                    availableCourses.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.name} ({course.code})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="submitted">À corriger</SelectItem>
                  <SelectItem value="in_progress">En cours</SelectItem>
                  <SelectItem value="graded">Corrigés</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:w-auto">
              <Button
                onClick={handleExport}
                disabled={exporting || filteredSubmissions.length === 0}
                variant="outline"
                className="w-full sm:w-auto"
              >
                {exporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Export...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Exporter CSV
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submissions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Soumissions ({filteredSubmissions.length})</CardTitle>
          <CardDescription className="text-muted-foreground">
            Liste des devoirs soumis par vos étudiants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredSubmissions.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Aucune soumission</h3>
              <p className="text-muted-foreground">
                {statusFilter === 'all'
                  ? "Aucune soumission trouvée"
                  : `Aucune soumission avec le statut "${statusFilter}"`
                }
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-muted-foreground">Étudiant</TableHead>
                    <TableHead className="text-muted-foreground">Devoir</TableHead>
                    <TableHead className="text-muted-foreground">Cours</TableHead>
                    <TableHead className="text-muted-foreground">Soumis le</TableHead>
                    <TableHead className="text-muted-foreground">Statut</TableHead>
                    <TableHead className="text-muted-foreground">Note</TableHead>
                    <TableHead className="text-muted-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSubmissions.map((submission) => (
                    <TableRow key={submission.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium text-foreground">{submission.student.full_name}</div>
                          <div className="text-sm text-muted-foreground">{submission.student.number}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{submission.assignment.title}</div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium text-foreground">{submission.course.name}</div>
                          <div className="text-sm text-muted-foreground">{submission.course.code}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {submission.submitted_at 
                            ? format(new Date(submission.submitted_at), 'dd/MM/yyyy à HH:mm', { locale: fr })
                            : '-'
                          }
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(submission.status, submission.is_late)}
                      </TableCell>
                      <TableCell>
                        {getGradeDisplay(submission.grade)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {submission.assignment.type === 'evaluation' && (
                            <Button asChild variant="outline" size="sm">
                              <Link href={`/academic/evaluations/${submission.assignment.id}/grading/${submission.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                          {submission.file.url && (
                            <AssignmentDownloadUnified
                              assignmentId={submission.assignment.id}
                              fileUrl={submission.file.url}
                              fileName={submission.file.name}
                              variant="outline"
                              size="sm"
                              showFileName={false}
                            />
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedSubmission(submission);
                              setGradeForm({
                                score: submission.grade.final_score?.toString() || '',
                                feedback: submission.grade.feedback || '',
                              });
                              setGradeModalOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grade Modal */}
      <Dialog open={gradeModalOpen} onOpenChange={setGradeModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Corriger la soumission</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {selectedSubmission && (
                <>
                  <strong className="text-foreground">{selectedSubmission.student.full_name}</strong>
                  {' — '}
                  {selectedSubmission.assignment.title}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="score" className="text-foreground">Note (sur 20)</Label>
              <Input
                id="score"
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={gradeForm.score}
                onChange={(e) => setGradeForm(prev => ({ ...prev, score: e.target.value }))}
                placeholder="Ex: 15.5"
                className="text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <Label htmlFor="feedback" className="text-foreground">Commentaires (optionnel)</Label>
              <Textarea
                id="feedback"
                value={gradeForm.feedback}
                onChange={(e) => setGradeForm(prev => ({ ...prev, feedback: e.target.value }))}
                placeholder="Commentaires sur le travail de l'étudiant..."
                rows={4}
                className="text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setGradeModalOpen(false);
                setGradeForm({ score: '', feedback: '' });
                setSelectedSubmission(null);
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={handleGradeSubmission}
              disabled={grading || !gradeForm.score}
            >
              {grading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Enregistrer
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
