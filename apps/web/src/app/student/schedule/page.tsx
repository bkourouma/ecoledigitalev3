"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { AlertCircle, Calendar, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";
import { createApiHeaders } from "@/lib/api-utils";
import { useCurrentStudent } from "@/lib/hooks/use-student-data";
import {
  STUDENT_PROFILE_MISSING_MESSAGE,
  getStudentApiError,
  isStudentProfileMissingError,
} from "@/lib/student-profile-errors";

const timeSlots = [
  "06:00",
  "07:00",
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
];

const weekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

interface ScheduleSession {
  id?: string;
  startDatetime?: string;
  start_datetime?: string;
  endDatetime?: string;
  end_datetime?: string;
  sessionDate?: string;
  courseName?: string;
  course_name?: string;
  teacherName?: string;
  teacher_name?: string;
  classroom?: string;
}

interface StudentScheduleResponse {
  data?: ScheduleSession[];
}

interface ScheduleEvent {
  id: string;
  title: string;
  instructor: string;
  room: string;
  startTime: string;
  endTime: string;
  date: Date;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  dayOfWeek: number;
  type: "cours";
  color: string;
}

function getRoles(session: unknown): string[] {
  const rolesValue = (session as { roles?: unknown } | null)?.roles;
  if (!Array.isArray(rolesValue)) {
    return [];
  }

  return rolesValue.filter((role): role is string => typeof role === "string");
}

function normalizeRole(role: string): string {
  return role.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function buildScheduleUrl(startDate: string, endDate: string) {
  return `/api/v1/student/courses/schedule?startDate=${startDate}&endDate=${endDate}`;
}

function mapScheduleSessionsToEvents(sessions: ScheduleSession[] = []): ScheduleEvent[] {
  return sessions
    .map((session) => {
      const startRaw = session.startDatetime || session.start_datetime;
      const endRaw = session.endDatetime || session.end_datetime;
      const sessionDateRaw = session.sessionDate || startRaw;

      const sessionDate = sessionDateRaw ? new Date(sessionDateRaw) : null;
      const startTime = startRaw ? new Date(startRaw) : null;
      const endTime = endRaw ? new Date(endRaw) : null;

      if (!sessionDate || !startTime || !endTime) {
        return null;
      }

      if (
        Number.isNaN(sessionDate.getTime()) ||
        Number.isNaN(startTime.getTime()) ||
        Number.isNaN(endTime.getTime())
      ) {
        return null;
      }

      return {
        id: session.id || `${startRaw}-${endRaw}-${session.courseName || session.course_name || "course"}`,
        title: session.courseName || session.course_name || "Cours",
        instructor: session.teacherName || session.teacher_name || "TBD",
        room: session.classroom || "Non specifie",
        startTime: startRaw,
        endTime: endRaw,
        date: sessionDate,
        startHour: startTime.getHours(),
        startMinute: startTime.getMinutes(),
        endHour: endTime.getHours(),
        endMinute: endTime.getMinutes(),
        dayOfWeek: sessionDate.getDay() === 0 ? 6 : sessionDate.getDay() - 1,
        type: "cours",
        color: "bg-blue-500",
      };
    })
    .filter((event): event is ScheduleEvent => event !== null);
}

export default function StudentSchedulePage() {
  const { data: session, status } = useSession();
  const {
    data: currentStudent,
    isLoading: isLoadingStudent,
    error: currentStudentError,
  } = useCurrentStudent();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "day">("week");

  const weekDates = useMemo(() => {
    const week: Date[] = [];
    const startOfWeek = new Date(currentDate);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);

    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);

    for (let index = 0; index < 6; index += 1) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + index);
      week.push(date);
    }

    return week;
  }, [currentDate]);

  const weekStart = weekDates[0].toISOString().split("T")[0];
  const weekEnd = weekDates[5].toISOString().split("T")[0];

  const upcomingStartDate = useMemo(() => new Date().toISOString().split("T")[0], []);
  const upcomingEndDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 90);
    return date.toISOString().split("T")[0];
  }, []);

  const canLoadSchedule = Boolean(session && currentStudent?.id);

  const {
    data: scheduleData,
    isLoading: isLoadingWeeklySchedule,
    error: scheduleError,
  } = useQuery<StudentScheduleResponse>({
    queryKey: ["student-schedule-page", currentStudent?.id, weekStart, weekEnd],
    queryFn: async () => {
      const response = await fetch(buildScheduleUrl(weekStart, weekEnd), {
        headers: createApiHeaders(session),
      });

      if (!response.ok) {
        throw await getStudentApiError(response, "Erreur lors de la recuperation du planning");
      }

      return response.json();
    },
    enabled: canLoadSchedule,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: upcomingScheduleData,
    isLoading: isLoadingUpcomingSchedule,
    error: upcomingScheduleError,
  } = useQuery<StudentScheduleResponse>({
    queryKey: ["student-upcoming-schedule-page", currentStudent?.id, upcomingStartDate, upcomingEndDate],
    queryFn: async () => {
      const response = await fetch(buildScheduleUrl(upcomingStartDate, upcomingEndDate), {
        headers: createApiHeaders(session),
      });

      if (!response.ok) {
        throw await getStudentApiError(response, "Erreur lors de la recuperation du planning");
      }

      return response.json();
    },
    enabled: canLoadSchedule,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const scheduleEvents = useMemo(
    () => mapScheduleSessionsToEvents(scheduleData?.data ?? []),
    [scheduleData],
  );

  const upcomingEvents = useMemo(() => {
    const mappedEvents = mapScheduleSessionsToEvents(upcomingScheduleData?.data ?? []);

    return mappedEvents
      .filter((event) => new Date(event.startTime) > new Date())
      .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())
      .slice(0, 3);
  }, [upcomingScheduleData]);

  const scheduleLoading = isLoadingWeeklySchedule || isLoadingUpcomingSchedule;

  if (status === "loading" || isLoadingStudent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect("/login");
  }

  const normalizedRoles = getRoles(session).map(normalizeRole);
  const isStudent =
    normalizedRoles.includes("student") || normalizedRoles.includes("etudiant");

  if (!isStudent) {
    redirect("/");
  }

  if (currentStudentError && isStudentProfileMissingError(currentStudentError)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Profil etudiant introuvable</h3>
              <p className="text-muted-foreground">{STUDENT_PROFILE_MISSING_MESSAGE}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const blockingError = currentStudentError || scheduleError || upcomingScheduleError;

  if (blockingError) {
    const message =
      blockingError instanceof Error
        ? blockingError.message
        : "Impossible de charger votre planning.";

    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-red-600">Erreur de chargement</h3>
              <p className="text-muted-foreground">{message}</p>
              <Button
                className="mt-4"
                onClick={() => window.location.reload()}
                variant="outline"
              >
                Reessayer
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "cours":
        return <Badge className="bg-blue-100 text-blue-800">Cours</Badge>;
      case "tp":
        return <Badge className="bg-emerald-100 text-emerald-800">TP</Badge>;
      case "examen":
        return <Badge className="bg-red-100 text-red-800">Examen</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

  const getEventsForSlot = (timeSlot: string, dayIndex: number) => {
    const [hour, minute] = timeSlot.split(":").map(Number);
    const slotStart = hour * 60 + minute;

    return scheduleEvents.filter((event) => {
      const eventStart = event.startHour * 60 + event.startMinute;
      const eventEnd = event.endHour * 60 + event.endMinute;

      if (event.dayOfWeek !== dayIndex) {
        return false;
      }

      return eventStart < slotStart + 60 && eventEnd > slotStart;
    });
  };

  const navigateWeek = (direction: "prev" | "next") => {
    const nextDate = new Date(currentDate);
    nextDate.setDate(currentDate.getDate() + (direction === "next" ? 7 : -7));
    setCurrentDate(nextDate);
  };

  const todayEvents = scheduleEvents.filter((event) => {
    const eventDate = new Date(event.startTime);
    const today = new Date();
    return eventDate.toDateString() === today.toDateString();
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      <div className="bg-white shadow-sm border-b border-emerald-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                Mon Emploi du Temps
              </h1>
              <p className="text-gray-600 mt-2">
                Consultez votre planning et vos prochains cours
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                variant={viewMode === "week" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("week")}
              >
                Semaine
              </Button>
              <Button
                variant={viewMode === "day" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("day")}
              >
                Jour
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    {viewMode === "week" ? "Vue Semaine" : "Vue Jour"}
                  </CardTitle>
                  <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm" onClick={() => navigateWeek("prev")}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium px-4">
                      {weekDates[0].toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      -{" "}
                      {weekDates[5].toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => navigateWeek("next")}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {scheduleLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
                  </div>
                ) : viewMode === "week" ? (
                  <div className="overflow-x-auto">
                    <div className="grid grid-cols-7 gap-1 min-w-full">
                      <div className="p-2 text-center font-medium text-gray-500">Heure</div>
                      {weekDays.map((day, index) => (
                        <div key={day} className="p-2 text-center font-medium text-gray-700">
                          <div>{day}</div>
                          <div className="text-sm text-gray-500">{weekDates[index].getDate()}</div>
                        </div>
                      ))}

                      {timeSlots.map((time) => (
                        <React.Fragment key={time}>
                          <div className="p-2 text-sm text-gray-500 border-t">{time}</div>
                          {weekDays.map((_, dayIndex) => {
                            const events = getEventsForSlot(time, dayIndex);

                            return (
                              <div
                                key={`${time}-${dayIndex}`}
                                className="p-1 border-t min-h-[60px] relative"
                              >
                                {events.map((event) => {
                                  const [hour, minute] = time.split(":").map(Number);
                                  const slotStart = hour * 60 + minute;
                                  const eventStart = event.startHour * 60 + event.startMinute;
                                  const eventEnd = event.endHour * 60 + event.endMinute;
                                  const duration = eventEnd - eventStart;
                                  const topOffset = eventStart - slotStart;
                                  const height = Math.min(duration, 60);

                                  return (
                                    <div
                                      key={event.id}
                                      className={`absolute left-0 right-0 ${event.color} text-white text-xs p-1 rounded cursor-pointer hover:opacity-80 z-10`}
                                      style={{
                                        top: `${Math.max(0, topOffset)}px`,
                                        height: `${height}px`,
                                        minHeight: "20px",
                                      }}
                                      title={`${event.title} - ${event.instructor} - ${event.room}`}
                                    >
                                      <div className="font-medium truncate">{event.title}</div>
                                      <div className="text-xs opacity-90 truncate">
                                        {formatTime(event.startTime)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h3 className="font-semibold text-lg">{formatDate(new Date().toISOString())}</h3>
                    {todayEvents.length > 0 ? (
                      <div className="space-y-3">
                        {todayEvents.map((event) => (
                          <div
                            key={event.id}
                            className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg"
                          >
                            <div className={`w-4 h-4 rounded-full ${event.color}`}></div>
                            <div className="flex-1">
                              <div className="flex justify-between items-start">
                                <div>
                                  <h4 className="font-medium">{event.title}</h4>
                                  <p className="text-sm text-gray-600">{event.instructor}</p>
                                </div>
                                {getTypeBadge(event.type)}
                              </div>
                              <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-4 w-4" />
                                  {formatTime(event.startTime)} - {formatTime(event.endTime)}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-4 w-4" />
                                  {event.room}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-center py-8">Aucun cours prevu aujourd&apos;hui</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Aujourd&apos;hui</CardTitle>
              </CardHeader>
              <CardContent>
                {todayEvents.length > 0 ? (
                  <div className="space-y-3">
                    {todayEvents.map((event) => (
                      <div key={event.id} className="flex items-start space-x-3">
                        <div className={`w-3 h-3 rounded-full ${event.color} mt-1`}></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{event.title}</p>
                          <p className="text-xs text-gray-500">
                            {formatTime(event.startTime)} - {event.room}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Aucun cours aujourd&apos;hui</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prochains cours</CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingEvents.length > 0 ? (
                  <div className="space-y-3">
                    {upcomingEvents.map((event) => (
                      <div key={event.id} className="flex items-start space-x-3">
                        <div className={`w-3 h-3 rounded-full ${event.color} mt-1`}></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{event.title}</p>
                          <p className="text-xs text-gray-500">{formatDate(event.startTime)}</p>
                          <p className="text-xs text-gray-500">
                            {formatTime(event.startTime)} - {event.room}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Aucun cours a venir</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
