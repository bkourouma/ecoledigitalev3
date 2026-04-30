"use client";

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
} from "@ecoledigitale/ui";
import {
  Award,
  Search,
  TrendingUp,
  BookOpen,
  BarChart3,
  Calendar,
  Loader2,
  AlertCircle,
  FileText,
  MessageSquare,
  Star,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import toast from "react-hot-toast";
import { createApiHeaders } from "@/lib/api-utils";

interface Grade {
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
  grade: number;
  max_grade: number;
  coefficient: number;
  date: string;
  instructor: {
    id: string;
    first_name: string;
    last_name: string;
  };
  feedback: string | null;
}

interface GradesResponse {
  success: boolean;
  data: Grade[];
  statistics: {
    average: number;
    total_points: number;
    max_total_points: number;
    best_score: number;
    grade_distribution: {
      excellent: number;
      good: number;
      average: number;
      below_average: number;
    };
  };
  error?: string;
}

export default function StudentGradesPage() {
  const { data: session, status } = useSession();
  const [grades, setGrades] = useState<Grade[]>([]);
  const [stats, setStats] = useState({
    average: 0,
    total_points: 0,
    max_total_points: 0,
    best_score: 0,
    grade_distribution: {
      excellent: 0,
      good: 0,
      average: 0,
      below_average: 0
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams();
        if (courseFilter !== 'all') {
          params.append('courseId', courseFilter);
        }

        const response = await fetch(`/api/student/grades?${params}`, {
          headers: createApiHeaders(session),
        });
        const data: GradesResponse = await response.json();

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch grades');
        }

        if (data.success) {
          const gradesData = data.data || [];
          setGrades(gradesData);

          const statistics = data.statistics;
          if (statistics) {
            setStats({
              average: statistics.average || 0,
              total_points: statistics.total_points || 0,
              max_total_points: statistics.max_total_points || 0,
              best_score:
                statistics.best_score ??
                (gradesData.length > 0 ? Math.max(...gradesData.map((g) => g.grade)) : 0),
              grade_distribution: statistics.grade_distribution || {
                excellent: 0,
                good: 0,
                average: 0,
                below_average: 0,
              },
            });
          } else {
            const totalPoints = gradesData.reduce((sum, grade) => sum + grade.grade, 0);
            const maxTotalPoints = gradesData.reduce((sum, grade) => sum + grade.max_grade, 0);
            const average = gradesData.length > 0 ? totalPoints / gradesData.length : 0;
            const bestScore = gradesData.length > 0 ? Math.max(...gradesData.map((g) => g.grade)) : 0;

            setStats({
              average,
              total_points: totalPoints,
              max_total_points: maxTotalPoints,
              best_score: bestScore,
              grade_distribution: {
                excellent: gradesData.filter((g) => g.grade >= 15).length,
                good: gradesData.filter((g) => g.grade >= 10 && g.grade < 15).length,
                average: gradesData.filter((g) => g.grade >= 8 && g.grade < 10).length,
                below_average: gradesData.filter((g) => g.grade < 8).length,
              },
            });
          }
        } else {
          throw new Error(data.error || 'Failed to fetch grades');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error fetching grades:', error);
          setError(error instanceof Error ? error.message : 'An error occurred');
          toast.error('Erreur lors du chargement des notes');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, session, courseFilter, reloadKey]);

  // Redirect if not authenticated
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

  const getGradeColor = (score: number) => {
    if (score >= 16) return 'text-emerald-400';
    if (score >= 14) return 'text-emerald-300';
    if (score >= 12) return 'text-sky-400';
    if (score >= 10) return 'text-amber-400';
    if (score >= 8) return 'text-amber-500/90';
    return 'text-red-400';
  };

  const getGradeBadgeClass = (score: number) => {
    if (score >= 16) return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
    if (score >= 14) return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
    if (score >= 12) return 'border-sky-500/40 bg-sky-500/15 text-sky-200';
    if (score >= 10) return 'border-amber-500/40 bg-amber-500/15 text-amber-200';
    if (score >= 8) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    return 'border-red-500/40 bg-red-500/15 text-red-200';
  };

  const getGradeLabel = (score: number) => {
    if (score >= 16) return 'Excellent';
    if (score >= 14) return 'Très bien';
    if (score >= 12) return 'Bien';
    if (score >= 10) return 'Assez bien';
    if (score >= 8) return 'Passable';
    return 'Insuffisant';
  };

  const isNewGrade = (date: string) => {
    const gradeDate = new Date(date);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return gradeDate > weekAgo;
  };

  const filteredGrades = grades.filter(grade => {
    const matchesSearch =
      grade.assignment.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      grade.course.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      grade.course.code.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = typeFilter === 'all' || grade.assignment.type === typeFilter;

    return matchesSearch && matchesType;
  });

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
          <span className="ml-2 text-lg text-muted-foreground">Chargement des notes...</span>
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
              <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Erreur</h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => setReloadKey((k) => k + 1)}>Réessayer</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
          <Award className="h-8 w-8 text-purple-400 shrink-0" />
          Mes Notes
        </h1>
        <p className="text-muted-foreground">
          Consultez vos résultats et suivez votre progression
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-sky-500/15 rounded-lg shrink-0">
                <BookOpen className="h-6 w-6 text-sky-400" />
              </div>
              <div className="ml-4 min-w-0">
                <p className="text-sm font-medium text-muted-foreground">Total Devoirs</p>
                <p className="text-2xl font-bold text-foreground">{grades.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-emerald-500/15 rounded-lg shrink-0">
                <BarChart3 className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="ml-4 min-w-0">
                <p className="text-sm font-medium text-muted-foreground">Points Obtenus</p>
                <p className="text-2xl font-bold text-foreground">{stats.total_points.toFixed(0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-purple-500/15 rounded-lg shrink-0">
                <TrendingUp className="h-6 w-6 text-purple-400" />
              </div>
              <div className="ml-4 min-w-0">
                <p className="text-sm font-medium text-muted-foreground">Moyenne</p>
                <p className={`text-2xl font-bold ${getGradeColor(stats.average)}`}>
                  {stats.average.toFixed(1)}/20
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center">
              <div className="p-2 bg-amber-500/15 rounded-lg shrink-0">
                <Star className="h-6 w-6 text-amber-400" />
              </div>
              <div className="ml-4 min-w-0">
                <p className="text-sm font-medium text-muted-foreground">Meilleure Note</p>
                <p className={`text-2xl font-bold ${getGradeColor(stats.best_score)}`}>
                  {stats.best_score}/20
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Rechercher par devoir ou cours..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div className="sm:w-48">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="text-foreground">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="homework">Devoirs</SelectItem>
                  <SelectItem value="quiz">Quiz</SelectItem>
                  <SelectItem value="exam">Examens</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grades List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Mes Notes ({filteredGrades.length})</CardTitle>
          <CardDescription className="text-muted-foreground">
            Liste de vos devoirs notés
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredGrades.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Aucune note</h3>
              <p className="text-muted-foreground">
                {searchTerm || typeFilter !== 'all'
                  ? "Aucune note ne correspond à vos critères de recherche"
                  : "Vous n'avez pas encore de notes disponibles"
                }
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGrades.map((grade, index) => (
                <div
                  key={`student-grade-${index}`}
                  className="border border-border rounded-lg p-4 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                        <h3 className="font-semibold text-foreground break-words">{grade.assignment.title}</h3>
                        {isNewGrade(grade.date) && (
                          <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200 shrink-0">
                            Nouveau
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 mb-2">
                        <span className="flex items-center gap-1 min-w-0">
                          <BookOpen className="h-4 w-4 shrink-0" />
                          <span className="truncate">{grade.course.name} ({grade.course.code})</span>
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <Calendar className="h-4 w-4" />
                          Noté le {format(new Date(grade.date), 'dd/MM/yyyy', { locale: fr })}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Par {grade.instructor.first_name} {grade.instructor.last_name}
                        </span>
                      </div>
                      {grade.feedback && (
                        <div className="mt-3 p-3 rounded-lg border border-border bg-muted/40">
                          <div className="flex items-start gap-2">
                            <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground mb-1">Commentaires</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{grade.feedback}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-left sm:text-right sm:ml-6">
                      <div className={`text-2xl font-bold ${getGradeColor(grade.grade)}`}>
                        {grade.grade}/{grade.max_grade}
                      </div>
                      <Badge variant="outline" className={getGradeBadgeClass(grade.grade)}>
                        {getGradeLabel(grade.grade)}
                      </Badge>
                      {grade.coefficient > 1 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Coeff. {grade.coefficient}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
