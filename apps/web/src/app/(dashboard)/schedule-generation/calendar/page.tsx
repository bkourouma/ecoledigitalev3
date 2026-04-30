"use client";

import { useState } from "react";
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
  Eye,
  BarChart3,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import CalendarView from "@/components/schedule/CalendarView";
import ClassSelector from "@/components/schedule/ClassSelector";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

interface Class {
  id: string;
  name: string;
  capacity: number;
  programmeName: string;
}

interface CalendarSession {
  instance_id: string;
  session_date: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
  classroom: string;
  class_id: string;
  class_name: string;
  course_id: string;
  course_name: string;
  course_code: string;
  teacher_id: string;
  teacher_name: string;
  day_of_week: string | number;
  duration_minutes: number;
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

interface CalendarData {
  classId: string;
  sessions: CalendarSession[];
  stats: ScheduleStats;
  view: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

export default function ScheduleCalendarPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "month">("month");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<CalendarSession | null>(null);

  // Fetch classes
  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["classes"],
    queryFn: async () => {
      const response = await fetch("/api/v1/classes", {
        headers: {
      "X-Tenant": "imhotepacademy",
      "Content-Type": "application/json",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
      });
      if (!response.ok) throw new Error("Failed to fetch classes");
      const result = await response.json();
      // Ensure we return an array
      const classesData = result.data || result || [];
      return Array.isArray(classesData) ? classesData : [];
    },
  });

  // Fetch calendar data
  const { data: calendarData, isLoading: isLoadingCalendar } = useQuery<CalendarData>({
    queryKey: ["schedule-calendar", selectedClassId, currentDate, viewMode],
    queryFn: async () => {
      if (!selectedClassId) return null;
      
      const startDate = getViewStartDate(currentDate, viewMode);
      const endDate = getViewEndDate(currentDate, viewMode);
      
      const response = await fetch(
        `/api/v1/schedule-generation/classes/${selectedClassId}/calendar?startDate=${startDate}&endDate=${endDate}&view=${viewMode}`,
        {
          headers: {
      "X-Tenant": "6eb9c106-b650-4398-b6fa-091b6828c4ba",
      "Content-Type": "application/json",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        }
      );
      if (!response.ok) throw new Error("Failed to fetch calendar");
      return response.json();
    },
    enabled: !!selectedClassId,
  });

  const getViewStartDate = (date: Date, view: "week" | "month"): string => {
    const d = new Date(date);
    if (view === "week") {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
      d.setDate(diff);
    } else {
      d.setDate(1); // First day of month
    }
    return d.toISOString().split('T')[0];
  };

  const getViewEndDate = (date: Date, view: "week" | "month"): string => {
    const d = new Date(date);
    if (view === "week") {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? 0 : 7); // Sunday
      d.setDate(diff);
    } else {
      d.setMonth(d.getMonth() + 1, 0); // Last day of month
    }
    return d.toISOString().split('T')[0];
  };

  const navigateDate = (direction: "prev" | "next") => {
    const newDate = new Date(currentDate);
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() + (direction === "next" ? 7 : -7));
    } else {
      newDate.setMonth(newDate.getMonth() + (direction === "next" ? 1 : -1));
    }
    setCurrentDate(newDate);
  };

  // Delete session instance mutation
  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/v1/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          "X-Tenant": "6eb9c106-b650-4398-b6fa-091b6828c4ba",
          "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete session');
      }
      // 204 No Content response doesn't have a body
      return response.status === 204 ? {} : response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch calendar data
      queryClient.invalidateQueries({ queryKey: ["schedule-calendar", selectedClassId, currentDate, viewMode] });
      setShowDeleteConfirm(false);
      setSessionToDelete(null);
    },
  });

  const handleDeleteClick = (session: CalendarSession) => {
    setSessionToDelete(session);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (sessionToDelete) {
      deleteSessionMutation.mutate(sessionToDelete.instance_id);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setSessionToDelete(null);
  };



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
            <h1 className="text-3xl font-bold text-foreground">Calendrier des Cours</h1>
            <p className="text-muted-foreground text-base">Consultez les emplois du temps approuvés</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              onClick={() => router.push("/schedule-generation/stats")}
              className="bg-background hover:bg-accent"
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              Statistiques
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/schedule-generation")}
              className="bg-background hover:bg-accent"
            >
              <Eye className="h-4 w-4 mr-2" />
              Génération
            </Button>
          </div>
        </div>

        {/* Class Selection */}
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <ClassSelector
              classes={classes}
              selectedClassId={selectedClassId}
              onClassChange={setSelectedClassId}
              showStats={true}
              stats={calendarData?.stats}
            />
          </div>
          <Card className="w-48 bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground flex items-center">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                Mois
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Select value={viewMode} onValueChange={(value: "week" | "month") => setViewMode(value)}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Semaine</SelectItem>
                  <SelectItem value="month">Mois</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {selectedClassId && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Navigation and Stats */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button variant="outline" size="sm" onClick={() => navigateDate("prev")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-xl font-semibold text-foreground">
                {viewMode === "month" 
                  ? currentDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
                  : `Semaine du ${getViewStartDate(currentDate, "week")}`
                }
              </h2>
              <Button variant="outline" size="sm" onClick={() => navigateDate("next")}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            
            {calendarData?.stats && (
              <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
                  {calendarData.stats.total_sessions} sessions
                </Badge>
                <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
                  {calendarData.stats.total_courses} cours
                </Badge>
                <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
                  {Math.round(calendarData.stats.total_hours)} heures
                </Badge>
              </div>
            )}
          </div>

          {/* Calendar Content */}
          {isLoadingCalendar ? (
            <Card className="bg-card border-border">
              <CardContent className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-2 text-muted-foreground">Chargement du calendrier...</p>
              </CardContent>
            </Card>
          ) : calendarData?.sessions?.length ? (
            <CalendarView
              sessions={calendarData.sessions}
              viewMode={viewMode}
              onSessionClick={(session) => {
                console.log("Session clicked:", session);
                // TODO: Implement session details modal
              }}
              onSessionDelete={handleDeleteClick}
            />
          ) : (
            <Card className="bg-card border-border">
              <CardContent className="p-8 text-center">
                <CalendarIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Aucun cours programmé</h3>
                <p className="text-muted-foreground mb-4">
                  Il n'y a pas de cours programmés pour cette période.
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
              Choisissez une classe pour voir son calendrier de cours.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Supprimer la session"
        description={sessionToDelete ? `Êtes-vous sûr de vouloir supprimer la session "${sessionToDelete.course_name}" du ${new Date(sessionToDelete.session_date).toLocaleDateString('fr-FR')} ? Cette action est irréversible.` : ''}
        confirmText="Supprimer"
        cancelText="Annuler"
        onConfirm={handleConfirmDelete}
        variant="destructive"
        loading={deleteSessionMutation.isPending}
      />
    </div>
  );
}
