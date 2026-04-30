"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Alert,
  AlertDescription,
  Separator,
} from "@ecoledigitale/ui";
import {
  Calendar as CalendarIcon,
  Clock,
  BookOpen,
  Users,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Filter,
  Download,
  BarChart3,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import CalendarView from "@/components/schedule/CalendarView";
import { createApiHeaders } from "@/lib/api-utils";

interface CalendarSession {
  instance_id: string;
  session_date: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
  classroom: string;
  class_id: string;
  class_name: string;
  class_code: string;
  course_id: string;
  course_name: string;
  course_code: string;
  teacher_id: string;
  teacher_name: string;
  day_of_week: string;
  duration_minutes: number;
}

interface ScheduleStats {
  total_sessions: number;
  total_courses: number;
  total_classes: number;
  total_hours: number;
  first_session: string;
  last_session: string;
  completed_sessions: number;
  cancelled_sessions: number;
}

interface CalendarData {
  teacherId: string;
  sessions: CalendarSession[];
  stats: ScheduleStats;
  view: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

export default function TeacherScheduleCalendarPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "month">("month");

  // Get teacher ID from session
  const teacherId = (session as any)?.user?.id as string | undefined;

  // Helper functions - must be defined before useQuery
  const getViewStartDate = (date: Date, view: "week" | "month"): string => {
    const d = new Date(date);
    if (view === "week") {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
    } else {
      d.setDate(1);
    }
    return d.toISOString().split('T')[0];
  };

  const getViewEndDate = (date: Date, view: "week" | "month"): string => {
    const d = new Date(date);
    if (view === "week") {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? 0 : 7);
      d.setDate(diff);
    } else {
      d.setMonth(d.getMonth() + 1, 0);
    }
    return d.toISOString().split('T')[0];
  };

  // Fetch calendar data for teacher
  const { data: calendarData, isLoading: isLoadingCalendar, error } = useQuery<CalendarData>({
    queryKey: ["teacher-schedule-calendar", teacherId, currentDate, viewMode],
    queryFn: async () => {
      const startDate = getViewStartDate(currentDate, viewMode);
      const endDate = getViewEndDate(currentDate, viewMode);

      const response = await fetch(
        `/api/v1/teacher/assignments/calendar?startDate=${startDate}&endDate=${endDate}&view=${viewMode}`,
        {
          headers: createApiHeaders(),
        }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to fetch calendar");
      }
      return response.json();
    },
    enabled: !!teacherId,
  });

  const navigateDate = (direction: "prev" | "next") => {
    const newDate = new Date(currentDate);
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() + (direction === "next" ? 7 : -7));
    } else {
      newDate.setMonth(newDate.getMonth() + (direction === "next" ? 1 : -1));
    }
    setCurrentDate(newDate);
  };

  // Group sessions by class and course
  const groupedSessions = useMemo(() => {
    if (!calendarData?.sessions) return {};
    
    const grouped: { [key: string]: { [key: string]: CalendarSession[] } } = {};
    calendarData.sessions.forEach(session => {
      if (!grouped[session.class_name]) {
        grouped[session.class_name] = {};
      }
      if (!grouped[session.class_name][session.course_name]) {
        grouped[session.class_name][session.course_name] = [];
      }
      grouped[session.class_name][session.course_name].push(session);
    });
    return grouped;
  }, [calendarData?.sessions]);

  const stats = calendarData?.stats || {
    total_sessions: 0,
    total_courses: 0,
    total_classes: 0,
    total_hours: 0,
    first_session: null,
    last_session: null,
    completed_sessions: 0,
    cancelled_sessions: 0,
  };

  // Loading state
  if (isLoadingCalendar) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          <p className="text-gray-600">Chargement de votre calendrier...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <CalendarIcon className="w-16 h-16 mx-auto" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Erreur de chargement
          </h2>
          <p className="text-gray-600 mb-4">
            {error instanceof Error ? error.message : "Impossible de charger votre calendrier"}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

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
            <h1 className="text-3xl font-bold text-gray-900">Mon Calendrier</h1>
            <p className="text-gray-600">Consultez vos cours programmés</p>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push("/teacher/schedule")}
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Vue Hebdomadaire
          </Button>
        </div>
      </motion.div>

      {/* Statistics Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-4 gap-4"
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_sessions}</div>
            <p className="text-xs text-gray-500">Cours programmés</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Cours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_courses}</div>
            <p className="text-xs text-gray-500">Matières enseignées</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Classes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_classes}</div>
            <p className="text-xs text-gray-500">Groupes d'étudiants</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Heures</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round(stats.total_hours)}</div>
            <p className="text-xs text-gray-500">Heures totales</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Calendar Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateDate("prev")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[200px]">
            {currentDate.toLocaleDateString('fr-FR', {
              month: 'long',
              year: 'numeric',
              ...(viewMode === 'week' && { day: 'numeric' })
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateDate("next")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant={viewMode === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("week")}
          >
            Semaine
          </Button>
          <Button
            variant={viewMode === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("month")}
          >
            Mois
          </Button>
        </div>
      </motion.div>

      {/* Sessions by Class and Course */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-4"
      >
        {isLoadingCalendar ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-gray-500">Chargement du calendrier...</p>
            </CardContent>
          </Card>
        ) : Object.keys(groupedSessions).length === 0 ? (
          <Alert>
            <AlertDescription>
              Aucun cours programmé pour cette période.
            </AlertDescription>
          </Alert>
        ) : (
          Object.entries(groupedSessions).map(([className, courses]) => (
            <Card key={className}>
              <CardHeader>
                <CardTitle className="text-lg">{className}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(courses).map(([courseName, sessions]) => (
                  <div key={courseName} className="border-l-4 border-blue-500 pl-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-900">{courseName}</h3>
                      <Badge variant="secondary">{sessions.length} sessions</Badge>
                    </div>
                    <div className="space-y-2">
                      {sessions.slice(0, 3).map((session, idx) => (
                        <div key={session.instance_id} className="text-sm text-gray-600">
                          <div className="flex items-center space-x-2">
                            <Clock className="h-4 w-4" />
                            <span>
                              {new Date(session.session_date).toLocaleDateString('fr-FR')} - {session.start_datetime.split(' ')[1]} à {session.end_datetime.split(' ')[1]}
                            </span>
                          </div>
                        </div>
                      ))}
                      {sessions.length > 3 && (
                        <p className="text-xs text-gray-500 italic">
                          ... et {sessions.length - 3} autres sessions
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </motion.div>
    </div>
  );
}
