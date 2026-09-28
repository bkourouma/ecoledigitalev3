"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Filter,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
} from "@ecoledigitale/ui";
import { createApiHeaders } from "@/lib/api-utils";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTeacherAssignments, useTeacherStudentsByClass } from "@/lib/hooks/use-teachers";

type ClassPerformanceItem = {
  classId: string;
  className: string;
  classCode: string;
  programmeName?: string;
  studentCount?: number;
  averageGrade?: number;
  completionRate?: number;
};

type StudentProgressItem = {
  studentId: string;
  firstName?: string;
  lastName?: string;
  className?: string;
  courseName?: string;
  currentGrade?: number;
  progress?: number;
  assignmentsCompleted?: number;
  totalAssignments?: number;
};

const PIE_COLORS = ["#16a34a", "#dc2626", "#64748b"];

export default function TeacherReportsDashboardPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || "no-academic-year";
  const [selectedClass, setSelectedClass] = useState("all");
  const [timeRange, setTimeRange] = useState("month");

  const { data: assignments = [], isLoading: assignmentsLoading } = useTeacherAssignments();
  const { data: studentsData, isLoading: studentsLoading } = useTeacherStudentsByClass("all", false);

  const { data: classesPerformance = [], isLoading: classesLoading, error: classesError } = useQuery({
    queryKey: ["teacher-classes-performance", session?.user?.email, activeAcademicYearId],
    queryFn: async (): Promise<ClassPerformanceItem[]> => {
      const response = await fetch("/api/teacher/classes/performance", {
        headers: createApiHeaders(session),
      });
      if (!response.ok) {
        throw new Error("Impossible de charger la performance des classes");
      }
      const data = await response.json();
      return data.data || [];
    },
    enabled: !!session?.user?.email,
  });

  const { data: progressData = [], isLoading: progressLoading, error: progressError } = useQuery({
    queryKey: ["teacher-students-progress", session?.user?.email, selectedClass, timeRange, activeAcademicYearId],
    queryFn: async (): Promise<StudentProgressItem[]> => {
      const params = new URLSearchParams();
      if (selectedClass !== "all") params.append("classId", selectedClass);
      params.append("timeRange", timeRange);
      const response = await fetch(`/api/teacher/students/progress?${params.toString()}`, {
        headers: createApiHeaders(session),
      });
      if (!response.ok) {
        throw new Error("Impossible de charger la progression des étudiants");
      }
      const data = await response.json();
      return data.data || [];
    },
    enabled: !!session?.user?.email,
  });

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login");
      return;
    }
    const roles = (session as any)?.roles ?? [];
    const isTeacher = Array.isArray(roles) && roles.some((r: string) => ["teacher", "Enseignant"].includes(r));
    if (!isTeacher) {
      router.push("/");
    }
  }, [session, status, router]);

  const classes = classesPerformance.map((item) => ({
    id: item.classId,
    name: item.className || "Classe",
  }));

  const uniqueStudents = useMemo(() => {
    const map = new Map<string, StudentProgressItem>();
    for (const row of progressData) {
      if (!map.has(row.studentId)) {
        map.set(row.studentId, row);
      }
    }
    return Array.from(map.values());
  }, [progressData]);

  const stats = useMemo(() => {
    const totalClasses = classesPerformance.length;
    const totalStudents = uniqueStudents.length;
    const avgGrade =
      classesPerformance.length > 0
        ? classesPerformance.reduce((sum, c) => sum + (c.averageGrade || 0), 0) / classesPerformance.length
        : 0;
    const avgCompletion =
      classesPerformance.length > 0
        ? classesPerformance.reduce((sum, c) => sum + (c.completionRate || 0), 0) / classesPerformance.length
        : 0;

    const improving = uniqueStudents.filter((s) => (s.progress || 0) > 0.5).length;
    const atRisk = uniqueStudents.filter((s) => (s.currentGrade || 0) < 10).length;
    const stable = Math.max(totalStudents - improving - atRisk, 0);

    return {
      totalClasses,
      totalStudents,
      avgGrade,
      avgCompletion,
      improving,
      atRisk,
      stable,
      totalAssignments: assignments.length,
    };
  }, [classesPerformance, uniqueStudents, assignments.length]);

  const classRankingData = useMemo(() => {
    return classesPerformance
      .slice()
      .sort((a, b) => (b.averageGrade || 0) - (a.averageGrade || 0))
      .slice(0, 8)
      .map((item) => ({
        name: (item.classCode || item.className || "Classe").slice(0, 10),
        moyenne: Number((item.averageGrade || 0).toFixed(1)),
        completion: Number((item.completionRate || 0).toFixed(1)),
      }));
  }, [classesPerformance]);

  const trendDistributionData = useMemo(
    () => [
      { name: "En progression", value: stats.improving },
      { name: "À risque", value: stats.atRisk },
      { name: "Stables", value: stats.stable },
    ],
    [stats.improving, stats.atRisk, stats.stable]
  );

  const assignmentCompletionByClass = useMemo(() => {
    const grouped = progressData.reduce<Record<string, { completed: number; total: number }>>((acc, row) => {
      const key = row.className || "N/A";
      if (!acc[key]) {
        acc[key] = { completed: 0, total: 0 };
      }
      acc[key].completed += row.assignmentsCompleted || 0;
      acc[key].total += row.totalAssignments || 0;
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([className, value]) => ({
        className: className.slice(0, 12),
        taux: value.total > 0 ? Number(((value.completed / value.total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.taux - a.taux)
      .slice(0, 8);
  }, [progressData]);

  const insights = useMemo(() => {
    const lines: string[] = [];

    if (stats.avgGrade < 10) {
      lines.push("La moyenne globale est sous 10/20: prioriser les remédiations sur les classes les plus faibles.");
    } else if (stats.avgGrade >= 14) {
      lines.push("La moyenne globale est solide: opportunité de renforcer les objectifs d'excellence.");
    }

    if (stats.atRisk > 0) {
      lines.push(`${stats.atRisk} étudiant(s) sont à risque (note < 10/20): prévoir un suivi individualisé.`);
    }

    if (stats.avgCompletion < 70) {
      lines.push("Le taux de complétion est faible: ajuster charge de devoirs et calendrier de remise.");
    }

    if (lines.length === 0) {
      lines.push("Les indicateurs sont globalement stables. Continuer le suivi hebdomadaire.");
    }

    return lines;
  }, [stats]);

  if (status === "loading" || classesLoading || progressLoading || studentsLoading || assignmentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!session) return null;

  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ["teacher", "Enseignant"].includes(r));
  if (!isTeacher) return null;

  if (classesError || progressError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Erreur de chargement</h2>
              <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
                {(classesError as Error)?.message || (progressError as Error)?.message || "Erreur inconnue"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold text-white whitespace-nowrap text-2xl leading-tight md:text-3xl">Dashboard Analytique Enseignant</h1>
          <p className="text-slate-300 whitespace-nowrap text-sm md:text-base text-muted-foreground">
            Vue unifiée des évaluations, progression et performance des classes
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtres d'analyse
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Classe</label>
              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger>
                  <SelectValue placeholder="Toutes les classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les classes</SelectItem>
                  {classes.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Période</label>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Classes analysées</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="text-3xl font-bold">{stats.totalClasses}</span>
            <BookOpen className="h-6 w-6 text-blue-500" />
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Étudiants suivis</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="text-3xl font-bold">{stats.totalStudents}</span>
            <Users className="h-6 w-6 text-green-500" />
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Moyenne globale</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="text-3xl font-bold">{stats.avgGrade.toFixed(1)}/20</span>
            <Award className="h-6 w-6 text-purple-500" />
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Complétion devoirs</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="text-3xl font-bold">{stats.avgCompletion.toFixed(0)}%</span>
            {stats.avgCompletion >= 70 ? (
              <TrendingUp className="h-6 w-6 text-green-500" />
            ) : (
              <TrendingDown className="h-6 w-6 text-red-500" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Ranking performance classes
            </CardTitle>
            <CardDescription>Moyenne et taux de complétion par classe</CardDescription>
          </CardHeader>
          <CardContent>
            {classRankingData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={classRankingData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="moyenne" fill="#7c3aed" name="Moyenne /20" />
                  <Bar dataKey="completion" fill="#0ea5e9" name="Complétion %" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[320px] flex items-center justify-center text-gray-500">Aucune donnée</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribution des tendances étudiants</CardTitle>
            <CardDescription>Lecture rapide des profils de progression</CardDescription>
          </CardHeader>
          <CardContent>
            {trendDistributionData.some((d) => d.value > 0) ? (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie data={trendDistributionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label>
                    {trendDistributionData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[320px] flex items-center justify-center text-gray-500">Aucune donnée</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Taux de complétion des devoirs par classe</CardTitle>
        </CardHeader>
        <CardContent>
          {assignmentCompletionByClass.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={assignmentCompletionByClass}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="className" />
                <YAxis />
                <Tooltip formatter={(value: number) => `${value}%`} />
                <Bar dataKey="taux" fill="#16a34a" name="Taux de complétion %" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">Aucune donnée</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Insights et recommandations</CardTitle>
          <CardDescription>Analyse automatique à partir des données d'évaluation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {insights.map((text, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <Badge variant="outline">{idx + 1}</Badge>
              <p className="text-sm text-gray-700">{text}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

