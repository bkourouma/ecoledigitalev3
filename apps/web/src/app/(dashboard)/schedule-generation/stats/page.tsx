"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Progress,
  Separator,
} from "@ecoledigitale/ui";
import {
  BarChart3,
  Clock,
  BookOpen,
  Users,
  Calendar as CalendarIcon,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  Download,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import StatsCards from "@/components/schedule/StatsCards";
import ClassSelector from "@/components/schedule/ClassSelector";

interface Class {
  id: string;
  name: string;
  capacity: number;
  programmeName: string;
}

interface ScheduleStats {
  total_sessions: number;
  total_courses: number;
  total_hours: number;
  first_session: string;
  last_session: string;
  completed_sessions: number;
  cancelled_sessions: number;
}

interface CalendarSession {
  course_id?: string;
  course_name: string;
  course_code: string;
  duration_minutes: number;
  status: string;
  teacher_name: string;
  session_date: string;
}

interface CalendarData {
  sessions: CalendarSession[];
  stats: ScheduleStats;
}

function normalizeTeacherNameToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isPlaceholderTeacherName(value: string): boolean {
  return ["tbd", "non assigne", "unknown teacher"].includes(normalizeTeacherNameToken(value));
}

export default function ScheduleStatsPage() {
  const router = useRouter();
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const { data: activeAcademicYearData, isLoading: isLoadingAcademicYear } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;

  // Fetch classes
  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["classes", activeAcademicYearId ?? "no-academic-year"],
    queryFn: async () => {
      const response = await fetch("/api/v1/classes", {
        headers: createApiHeaders(undefined, {
          // Override any stale localStorage value injected by the fetch interceptor.
          "X-Academic-Year-Id": activeAcademicYearId ?? "",
        }),
      });
      if (!response.ok) throw new Error("Failed to fetch classes");
      const result = await response.json();
      // Ensure we return an array
      const classesData = result.data || result || [];
      return Array.isArray(classesData) ? classesData : [];
    },
    enabled: !isLoadingAcademicYear,
  });

  // Fetch schedule stats
  const { data: stats, isLoading: isLoadingStats } = useQuery<ScheduleStats>({
    queryKey: ["schedule-stats", selectedClassId, activeAcademicYearId ?? "no-academic-year"],
    queryFn: async () => {
      if (!selectedClassId) return null;
      
      const response = await fetch(
        `/api/v1/schedule-generation/classes/${selectedClassId}/schedule-stats`,
        {
          headers: createApiHeaders(undefined, {
            "X-Academic-Year-Id": activeAcademicYearId ?? "",
          }),
        }
      );
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
    enabled: !!selectedClassId && !isLoadingAcademicYear,
  });

  // Fetch detailed calendar data for analysis
  const { data: calendarData } = useQuery<CalendarData>({
    queryKey: ["schedule-calendar-full", selectedClassId, activeAcademicYearId ?? "no-academic-year"],
    queryFn: async () => {
      if (!selectedClassId) return null;
      
      const response = await fetch(
        `/api/v1/schedule-generation/classes/${selectedClassId}/calendar`,
        {
          headers: createApiHeaders(undefined, {
            "X-Academic-Year-Id": activeAcademicYearId ?? "",
          }),
        }
      );
      if (!response.ok) throw new Error("Failed to fetch calendar");
      return response.json();
    },
    enabled: !!selectedClassId && !isLoadingAcademicYear,
  });

  // Fetch active teacher assignments for fallback teacher names when old session_instances miss teacher_id
  const { data: assignmentTeacherNames = {} } = useQuery<Record<string, string>>({
    queryKey: ["schedule-teacher-names", selectedClassId, activeAcademicYearId ?? "no-academic-year"],
    queryFn: async () => {
      if (!selectedClassId) return {};

      const response = await fetch(
        `/api/v1/teacher-assignments?classId=${encodeURIComponent(selectedClassId)}&status=active&showAll=true&limit=200`,
        {
          headers: createApiHeaders(undefined, {
            "X-Academic-Year-Id": activeAcademicYearId ?? "",
          }),
        }
      );
      if (!response.ok) throw new Error("Failed to fetch teacher assignments");

      const result = await response.json();
      const assignments = Array.isArray(result?.data) ? result.data : [];

      return assignments.reduce((acc: Record<string, string>, assignment: any) => {
        const courseCode = typeof assignment?.courseCode === "string" ? assignment.courseCode.trim() : "";
        const teacherName = typeof assignment?.teacherName === "string" ? assignment.teacherName.trim() : "";

        if (courseCode && teacherName) {
          acc[courseCode] = teacherName;
        }

        return acc;
      }, {});
    },
    enabled: !!selectedClassId && !isLoadingAcademicYear,
  });

  const resolveTeacherName = (session: CalendarSession): string | undefined => {
    const rawTeacherName = typeof session.teacher_name === "string" ? session.teacher_name.trim() : "";
    if (rawTeacherName && !isPlaceholderTeacherName(rawTeacherName)) {
      return rawTeacherName;
    }
    if (rawTeacherName && !["tbd", "non assigné", "unknown teacher"].includes(rawTeacherName.toLowerCase())) {
      return rawTeacherName;
    }

    const fallbackTeacherName = assignmentTeacherNames[session.course_code];
    return fallbackTeacherName || undefined;
  };

  const calculateCourseStats = () => {
    if (!calendarData?.sessions) return [];
    
    const courseStats: { [key: string]: any } = {};
    
    calendarData.sessions.forEach(session => {
      const key = session.course_code;
      if (!courseStats[key]) {
        courseStats[key] = {
          name: session.course_name,
          code: session.course_code,
          totalSessions: 0,
          totalHours: 0,
          completedSessions: 0,
          cancelledSessions: 0,
          teacher: resolveTeacherName(session),
        };
      }

      if (!courseStats[key].teacher) {
        courseStats[key].teacher = resolveTeacherName(session);
      }
      
      courseStats[key].totalSessions++;
      courseStats[key].totalHours += session.duration_minutes / 60;
      
      if (session.status === 'completed') courseStats[key].completedSessions++;
      if (session.status === 'cancelled') courseStats[key].cancelledSessions++;
    });
    
    return Object.values(courseStats);
  };

  const getCompletionRate = () => {
    if (!stats || stats.total_sessions === 0) return 0;
    return Math.round((stats.completed_sessions / stats.total_sessions) * 100);
  };

  const getCancellationRate = () => {
    if (!stats || stats.total_sessions === 0) return 0;
    return Math.round((stats.cancelled_sessions / stats.total_sessions) * 100);
  };

  const formatDate = (dateString: string): string => {
    if (!dateString) return "Non défini";
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const courseStats = useMemo(() => calculateCourseStats(), [calendarData, assignmentTeacherNames]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Statistiques des Emplois du Temps</h1>
            <p className="text-muted-foreground text-base">Analysez les performances et métriques de vos plannings</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              onClick={() => router.push("/schedule-generation/calendar")}
              className="bg-background hover:bg-accent border-border text-foreground"
            >
              <CalendarIcon className="h-4 w-4 mr-2" />
              Calendrier
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/schedule-generation")}
              className="bg-background hover:bg-accent border-border text-foreground"
            >
              <Eye className="h-4 w-4 mr-2" />
              Génération
            </Button>
          </div>
        </div>

        {/* Class Selection */}
        <ClassSelector
          classes={classes}
          selectedClassId={selectedClassId}
          onClassChange={setSelectedClassId}
          showStats={true}
          stats={stats}
        />
      </motion.div>

      {selectedClassId && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {isLoadingStats ? (
            <Card className="bg-card border-border">
              <CardContent className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-2 text-muted-foreground">Chargement des statistiques...</p>
              </CardContent>
            </Card>
          ) : stats ? (
            <>
              {/* Stats Cards */}
              <StatsCards stats={stats} />

              {/* Course Breakdown */}
              {courseStats.length > 0 && (
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center text-foreground">
                      <BookOpen className="h-5 w-5 mr-2 text-foreground" />
                      Répartition par Cours
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Détail des heures et sessions par matière
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {courseStats.map((course: any, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-accent/50 rounded-lg border border-border">
                          <div className="flex items-center space-x-4">
                            <div>
                              <h4 className="font-medium text-foreground">{course.name}</h4>
                              <p className="text-sm text-muted-foreground">{course.code}</p>
                              {course.teacher && (
                                <p className="text-xs text-muted-foreground">Enseignant: {course.teacher}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-6 text-sm">
                            <div className="text-center">
                              <div className="font-medium text-foreground">{course.totalSessions}</div>
                              <div className="text-muted-foreground">Sessions</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium text-foreground">{Math.round(course.totalHours)}</div>
                              <div className="text-muted-foreground">Heures</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium text-primary">{course.completedSessions}</div>
                              <div className="text-muted-foreground">Terminées</div>
                            </div>
                            {course.cancelledSessions > 0 && (
                              <div className="text-center">
                                <div className="font-medium text-destructive">{course.cancelledSessions}</div>
                                <div className="text-muted-foreground">Annulées</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="bg-card border-border">
              <CardContent className="p-8 text-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Aucune donnée disponible</h3>
                <p className="text-muted-foreground mb-4">
                  Il n'y a pas encore d'emploi du temps approuvé pour cette classe.
                </p>
                <Button onClick={() => router.push("/schedule-generation")}>
                  Générer un emploi du temps
                </Button>
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}

      {!selectedClassId && (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Sélectionnez une classe</h3>
            <p className="text-muted-foreground">
              Choisissez une classe pour voir ses statistiques d'emploi du temps.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
