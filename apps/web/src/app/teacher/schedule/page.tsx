"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Calendar from "@/components/schedule/Calendar";
import AddSessionDialog from "@/components/schedule/AddSessionDialog";
import SessionDetails from "@/components/schedule/SessionDetails";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { createApiHeaders } from "@/lib/api-utils";

type ApiSession = {
  id: string;
  classId: string;
  className?: string;
  classCode?: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  startDateTime: string;
  endDateTime: string;
  notes?: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  classId: string;
  courseId: string;
};

type TeacherAssignment = {
  id: string;
  className?: string;
  classCode?: string;
  courseName?: string;
  courseCode?: string;
  datebut?: string;
  datefin?: string;
  status?: string;
};

type ScheduledSession = {
  id: string;
  sessionDate?: string;
  startTime?: string;
  endTime?: string;
  classId: string;
  className?: string;
  classCode?: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
};

export default function TeacherSchedulePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const teacherId = (session as any)?.user?.id as string | undefined;
  const jwtToken = (session as any)?.jwtToken as string | undefined;
  const tenantId = (session as any)?.tenantId as string | undefined;
  const tenantSlug = (session as any)?.tenantSlug as string | undefined;

  const [sessions, setSessions] = useState<ApiSession[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isSessionDetailsOpen, setIsSessionDetailsOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);

  // Auth checks with useEffect to avoid redirect issues
  const roles = (session as any)?.roles ?? [];
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

  // Prevent continuous reloads by controlling when fetchSessions or redirects re-trigger
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

  const teacherApiHeaders = useCallback(() => {
    const headers = createApiHeaders(
      tenantId || tenantSlug ? ({ tenantId, tenantSlug } as any) : null,
      {
        ...(teacherId ? { "X-User-Id": teacherId } : {}),
        "X-Academic-Year-Id": "",
      }
    );
    if (jwtToken && !headers.Authorization) {
      headers.Authorization = `Bearer ${jwtToken}`;
    }
    return headers;
  }, [jwtToken, teacherId, tenantId, tenantSlug]);

  const getScheduleRange = useCallback(() => {
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setMonth(end.getMonth() + 9);
    end.setHours(23, 59, 59, 999);

    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    };
  }, []);

  const fetchSessions = useCallback(async () => {
    if (!teacherId) return;
    setIsLoading(true);
    try {
      const { startISO, endISO } = getScheduleRange();
      const headers = teacherApiHeaders();
      const [sessionsRes, scheduledSessionsRes, assignmentsRes] = await Promise.all([
        fetch(
          `/api/v1/sessions?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}&include=class,course`,
          { headers }
        ),
        fetch("/api/v1/teacher-assignments/scheduled-sessions", { headers }),
        fetch("/api/v1/teacher-assignments?status=active&limit=100", { headers }),
      ]);

      const sessionsJson = await sessionsRes.json();
      if (!sessionsRes.ok) {
        throw new Error(sessionsJson?.message || "Erreur lors du chargement des sessions");
      }

      const assignmentsJson = await assignmentsRes.json().catch(() => ({ data: [] }));
      if (!assignmentsRes.ok) {
        console.warn("Impossible de charger les affectations enseignant", assignmentsJson);
      }

      const scheduledSessionsJson = await scheduledSessionsRes.json().catch(() => ({ data: [] }));
      if (!scheduledSessionsRes.ok) {
        console.warn("Impossible de charger les créneaux planifiés enseignant", scheduledSessionsJson);
      }

      const directSessions = sessionsJson.data || [];
      const legacyScheduledSessions = (scheduledSessionsRes.ok ? scheduledSessionsJson.data || [] : [])
        .map((item: ScheduledSession) => {
          if (!item.sessionDate || !item.startTime || !item.endTime) return null;
          return {
            id: item.id,
            classId: item.classId,
            className: item.className,
            classCode: item.classCode,
            courseId: item.courseId,
            courseName: item.courseName,
            courseCode: item.courseCode,
            startDateTime: `${item.sessionDate}T${item.startTime}`,
            endDateTime: `${item.sessionDate}T${item.endTime}`,
          } satisfies ApiSession;
        })
        .filter((item: ApiSession | null): item is ApiSession => item !== null);

      setSessions(directSessions.length > 0 ? directSessions : legacyScheduledSessions);
      setAssignments(assignmentsRes.ok ? assignmentsJson.data || [] : []);
    } catch (err) {
      toast.error("Erreur lors du chargement des sessions");
      setSessions([]);
      setAssignments([]);
    } finally {
      setIsLoading(false);
    }
  }, [getScheduleRange, teacherApiHeaders, teacherId]);

  useEffect(() => {
    if (status === 'loading') return;

    if (!session && status === 'unauthenticated' && !hasCheckedAuth) {
      setHasCheckedAuth(true);
      router.replace('/login');
      return;
    }

    if (session && !isTeacher && !hasCheckedAuth) {
      setHasCheckedAuth(true);
      router.replace('/');
      return;
    }

    if (session && isTeacher && !hasCheckedAuth) {
      setHasCheckedAuth(true);
      fetchSessions();
    }
  }, [session, status, isTeacher, router, hasCheckedAuth, fetchSessions]);


  useEffect(() => { 
    if (teacherId) fetchSessions(); 
  }, [fetchSessions, teacherId]);

  const events: CalendarEvent[] = useMemo(() => {
    console.group("🧩 Raw sessions data for TeacherSchedulePage");
    console.log(sessions);
    console.groupEnd();

    if (!Array.isArray(sessions)) {
      return [];
    }

    return sessions
      .filter((s: any) => {
        // Filter out invalid sessions
        return s && s.id && s.startDateTime && s.endDateTime;
      })
      .map((s: any) => {
        console.log("Session Entry:", s);

        // Prioritize direct fields from API, then check nested objects as fallback
        const className =
          s.className ||
          s.class?.name ||
          s.classDetails?.name ||
          s.classroom?.name ||
          s.classData?.name ||
          s.class?.title ||
          s.classDetails?.title ||
          `Unknown Class (${s.classId || 'N/A'})`;
        
        const courseName =
          s.courseName ||
          s.course?.name ||
          s.courseDetails?.name ||
          s.courseData?.name ||
          s.course?.title ||
          s.courseDetails?.title ||
          `Unknown Course (${s.courseId || 'N/A'})`;

        console.log(" → Class Name:", className);
        console.log(" → Course Name:", courseName);

        const notes = s.notes ? ` - ${s.notes}` : "";

        // Safely parse dates with validation
        const startDate = s.startDateTime ? new Date(s.startDateTime) : new Date();
        const endDate = s.endDateTime ? new Date(s.endDateTime) : new Date(startDate.getTime() + 60 * 60 * 1000); // Default 1 hour duration

        // Validate dates
        if (isNaN(startDate.getTime())) {
          console.warn("Invalid startDateTime for session:", s.id, s.startDateTime);
          return null;
        }
        if (isNaN(endDate.getTime())) {
          console.warn("Invalid endDateTime for session:", s.id, s.endDateTime);
          return null;
        }

        return {
          id: s.id,
          title: `${className} – ${courseName}${notes}`,
          start: startDate,
          end: endDate,
          classId: s.classId || '',
          courseId: s.courseId || '',
        };
      })
      .filter((event): event is CalendarEvent => event !== null);
  }, [sessions]);

  const onMove = async (id: string, newStart: Date, newEnd: Date) => {
    const res = await fetch(`/api/v1/sessions/${id}`, {
      method: 'PATCH',
      headers: teacherApiHeaders(),
      body: JSON.stringify({ 
        startDateTime: newStart.toISOString(), 
        endDateTime: newEnd.toISOString() 
      })
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.message || 'Conflit: déplacement impossible');
      throw new Error('Move failed');
    }
    toast.success('Session déplacée avec succès');
    await fetchSessions();
  };

  const onResize = async (id: string, newEnd: Date) => {
    const res = await fetch(`/api/v1/sessions/${id}`, {
      method: 'PATCH',
      headers: teacherApiHeaders(),
      body: JSON.stringify({ endDateTime: newEnd.toISOString() })
    });
    if (!res.ok) {
      const err = await res.json();
      toast.error(err.message || 'Conflit: redimensionnement impossible');
      throw new Error('Resize failed');
    }
    toast.success('Durée ajustée avec succès');
    await fetchSessions();
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setIsSessionDetailsOpen(true);
  };

  const handleDateSelect = (start: Date, end: Date) => {
    setSelectedSlot({ start, end });
    setIsAddDialogOpen(true);
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (!session || !isTeacher) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      <div className="bg-white shadow-sm border-b border-purple-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                Mon Emploi du Temps
              </h1>
              <p className="text-gray-600 mt-2">
                Gérez vos cours avec drag-and-drop
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Planning des cours</CardTitle>
              <div className="flex gap-2">
                <AddSessionDialog onCreated={fetchSessions} />
                <Button onClick={fetchSessions} size="sm" disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rafraîchir'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {Array.isArray(events) ? (
              <>
                <Calendar 
                  events={events} 
                  onMove={onMove} 
                  onResize={onResize}
                  onEventClick={handleEventClick}
                  onDateSelect={handleDateSelect}
                />

                {!isLoading && events.length === 0 && assignments.length > 0 ? (
                  <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <h3 className="font-semibold text-amber-900">Cours affectés sans créneaux planifiés</h3>
                    <p className="mt-1 text-sm text-amber-800">
                      Ces cours sont bien affectés à votre compte, mais aucun créneau horaire n'a encore été généré dans le planning.
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {assignments.map((assignment) => (
                        <Card key={assignment.id} className="border-amber-200 bg-white">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base">
                              {assignment.courseName || "Cours"}
                              {assignment.courseCode ? ` (${assignment.courseCode})` : ""}
                            </CardTitle>
                            <CardDescription>
                              {assignment.className || "Classe non renseignée"}
                              {assignment.classCode ? ` - ${assignment.classCode}` : ""}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="text-sm text-muted-foreground">
                            {assignment.datebut && assignment.datefin
                              ? `Affectation du ${new Date(assignment.datebut).toLocaleDateString("fr-FR")} au ${new Date(assignment.datefin).toLocaleDateString("fr-FR")}`
                              : "Affectation active"}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
              </div>
            )}
          </CardContent>
        </Card>

        {selectedEvent && (
          <SessionDetails 
            id={selectedEvent.id}
            initialNotes={selectedEvent.title}
            open={isSessionDetailsOpen}
            onOpenChange={(open) => {
              setIsSessionDetailsOpen(open);
              if (!open) {
                setSelectedEvent(null);
              }
            }}
            hideTrigger
            onUpdated={() => {
              fetchSessions();
              setIsSessionDetailsOpen(false);
              setSelectedEvent(null);
            }} 
            onDeleted={() => {
              fetchSessions();
              setIsSessionDetailsOpen(false);
              setSelectedEvent(null);
            }} 
          />
        )}

        <AddSessionDialog
          onCreated={() => {
            fetchSessions();
            setIsAddDialogOpen(false);
            setSelectedSlot(null);
          }}
          open={isAddDialogOpen}
          onOpenChange={(open) => {
            setIsAddDialogOpen(open);
            if (!open) {
              setSelectedSlot(null);
            }
          }}
          initialStart={selectedSlot?.start ?? null}
          initialEnd={selectedSlot?.end ?? null}
          hideTrigger
        />
      </div>
    </div>
  );
}
