'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionInstancesSimple } from '@/lib/hooks/use-attendance';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar, Users, Clock, Save, UserCheck, UserX, Eye, FileDown } from 'lucide-react';
import { createApiHeaders } from '@/lib/api-utils';

interface TeacherAssignment {
  id: string;
  classCourseId?: string;
  classId?: string;
  courseId?: string;
  courseName: string;
  courseCode: string;
  className: string;
  teacherName: string;
  datebut: string;
  datefin: string;
  status?: string;
  createdAt?: string;
}

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  matricule: string;
  email: string;
}

interface AttendanceRecord {
  studentId: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  notes?: string;
}

// API functions
const fetchTeacherByEmail = async (email: string, session?: Session | null): Promise<string | null> => {
  const response = await fetch(`/api/v1/teachers?email=${encodeURIComponent(email)}`, {
    headers: createApiHeaders(session ?? undefined),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch teacher by email');
  }
  const result = await response.json();
  return result.data?.[0]?.id || null;
};

const fetchTeacherAssignments = async (teacherId?: string): Promise<TeacherAssignment[]> => {
  if (!teacherId) {
    return [];
  }
  
  const response = await fetch(`/api/v1/teacher-assignments?teacherId=${teacherId}`, {
    headers: createApiHeaders(),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch teacher assignments');
  }
  const result = await response.json();
  // Handle API response format with data property
  return result.data || result;
};

const fetchStudentsByAssignment = async (assignmentId: string): Promise<Student[]> => {
  // Use the Next.js proxy route instead of direct backend call
  const response = await fetch(`/api/teacher/assignments/${assignmentId}/students`, {
    headers: createApiHeaders(),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch students: ${response.status} ${errorText}`);
  }
  const result = await response.json();
  // Handle API response format - students endpoint returns array directly
  return Array.isArray(result) ? result : result.data || [];
};

interface AttendanceSession {
  id: string;
  sessionDate: string;
  sessionTitle: string;
  createdAt: string;
  timeSlot?: string;
  durationHours?: number;
  summary: {
    total: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
  };
}

interface PlannedSessionInstance {
  id: string;
  classId?: string;
  courseId?: string;
  className?: string;
  courseName?: string;
  sessionDate?: string;
  startDatetime?: string;
  endDatetime?: string;
  durationMinutes?: number;
  startDateTime?: string;
  endDateTime?: string;
  start_datetime?: string;
  end_datetime?: string;
  start_time?: string;
  end_time?: string;
}

const getWeekRange = (dateIso: string) => {
  const base = new Date(`${dateIso}T00:00:00`);
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setDate(base.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const toYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  return { weekStart: toYmd(monday), weekEnd: toYmd(sunday) };
};

const fetchPlannedSessionsForWeek = async (weekStart: string, weekEnd: string): Promise<PlannedSessionInstance[]> => {
  const startISO = new Date(`${weekStart}T00:00:00`).toISOString();
  const endISO = new Date(`${weekEnd}T23:59:59`).toISOString();

  const response = await fetch(
    `/api/v1/sessions?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}&include=class,course`,
    { headers: createApiHeaders() }
  );
  if (!response.ok) {
    throw new Error('Failed to fetch planned sessions');
  }
  const result = await response.json();
  return Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
};

const getPlannedStartDate = (session: PlannedSessionInstance): Date | null => {
  const raw =
    session.startDateTime ||
    session.startDatetime ||
    session.start_datetime ||
    null;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (session.sessionDate && session.start_time) {
    const d = new Date(`${String(session.sessionDate).slice(0, 10)}T${session.start_time}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};

const getPlannedEndDate = (session: PlannedSessionInstance): Date | null => {
  const raw =
    session.endDateTime ||
    session.endDatetime ||
    session.end_datetime ||
    null;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (session.sessionDate && session.end_time) {
    const d = new Date(`${String(session.sessionDate).slice(0, 10)}T${session.end_time}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};

const fetchAttendanceHistory = async (assignmentId: string): Promise<AttendanceSession[]> => {
  const response = await fetch(`/api/teacher/attendance/${assignmentId}`, {
    credentials: 'include', // Ensure cookies are sent
    headers: createApiHeaders(),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error('Failed to fetch attendance history');
  }
  const result = await response.json();
  return Array.isArray(result) ? result : result.data || [];
};


interface AttendanceStudentRecord {
  id: string;
  sessionId: string;
  studentId: string;
  attendanceStatus: 'present' | 'absent' | 'late' | 'excused' | 'medical_leave';
  arrivalTime?: string | null;
  departureTime?: string | null;
  notes?: string | null;
  studentNumber?: string;
  studentName?: string;
}

const fetchSessionRecords = async (sessionId: string): Promise<AttendanceStudentRecord[]> => {
  const limit = 100;
  let page = 1;
  let all: AttendanceStudentRecord[] = [];
  while (true) {
    const response = await fetch(`/api/attendance/records?sessionId=${sessionId}&limit=${limit}&page=${page}`);
    if (!response.ok) {
      throw new Error('Failed to fetch attendance records');
    }
    const result = await response.json();
    const data = (result.data || []) as AttendanceStudentRecord[];
    all = all.concat(Array.isArray(data) ? data : []);
    const pagination = result.pagination;
    if (!pagination || page >= pagination.pages) break;
    page += 1;
  }
  return all;
};


const saveAttendance = async (data: {
  assignmentId: string;
  date: string;
  timeSlot: string;
  sessionTitle: string;
  durationHours: number;
  records: AttendanceRecord[];
  courseNameSnapshot?: string | null;
  courseCodeSnapshot?: string | null;
  classNameSnapshot?: string | null;
  teacherNameSnapshot?: string | null;
  teacherEmailSnapshot?: string | null;
}) => {
  const response = await fetch('/api/teacher/attendance', {
    method: 'POST',
    headers: createApiHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to save attendance');
  }

  return response.json();
};

export default function TeacherAttendancePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const [selectedAssignment, setSelectedAssignment] = useState<string>('');
  const [attendanceMode, setAttendanceMode] = useState<'manual' | 'planning'>('planning');
  const [selectedPlannedSessionId, setSelectedPlannedSessionId] = useState<string>('');
  const [startHour, setStartHour] = useState<string>('');
  const [endHour, setEndHour] = useState<string>('');
  const [sessionDate, setSessionDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Détails d'une séance (modal)
  const [detailsSession, setDetailsSession] = useState<AttendanceSession | null>(null);
  const { data: sessionRecords = [], isLoading: sessionRecordsLoading } = useQuery({
    queryKey: ['session-records', detailsSession?.id],
    queryFn: () => fetchSessionRecords(detailsSession!.id),
    enabled: !!detailsSession?.id,
  });

  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, AttendanceRecord>>({});

  const sessionEmail =
    typeof session?.user?.email === 'string' ? session.user.email.trim() : '';
  const userEmail =
    sessionEmail ||
    (process.env.NODE_ENV === 'development' ? 'koffi.nguessan.ci@example.com' : '');

  // Fetch teacher ID by email
  const { data: teacherId } = useQuery({
    queryKey: ['teacher-id', userEmail, session?.user?.id],
    queryFn: () => fetchTeacherByEmail(userEmail, session),
    enabled: !!userEmail,
  });

  // Keep this for assignment availability fallback compatibility.
  const { data: sessionInstancesData, isLoading: isLoadingSessionInstances, error: sessionInstancesError } = useSessionInstancesSimple();

  // Fetch teacher assignments using the teacher ID
  const { data: assignmentsRaw = [] } = useQuery({
    queryKey: ['teacher-assignments', teacherId],
    queryFn: () => fetchTeacherAssignments(teacherId),
    enabled: !!teacherId,
  });


  // Extract unique class_id + course_id combinations from session instances
  const sessionInstanceKeys = useMemo(() => {
    if (!sessionInstancesData?.data) return new Set<string>();
    const keys = new Set<string>();
    sessionInstancesData.data.forEach((si: any) => {
      // Session instances should now have classId and courseId from the scheduled_sessions join
      if (si.classId && si.courseId) {
        const key = `${si.classId}-${si.courseId}`;
        keys.add(key);
      }
    });
    return keys;
  }, [sessionInstancesData]);

  // Deduplicate assignments by classCourseId, keeping the most recent or active one
  // Then filter to only include assignments that have session instances
  const assignments = useMemo(() => {
    const seen = new Map<string, TeacherAssignment>();
    assignmentsRaw.forEach((assignment: TeacherAssignment) => {
      // Use classCourseId as the deduplication key (same course + class combination)
      const key = assignment.classCourseId || `${assignment.courseCode}-${assignment.className}`;
      const existing = seen.get(key);
      
      if (!existing) {
        seen.set(key, assignment);
      } else {
        // Prefer active assignments, then most recent ones, then longest date range
        const isExistingActive = existing.status === 'active';
        const isCurrentActive = assignment.status === 'active';
        const existingDate = new Date(existing.createdAt || existing.datebut);
        const currentDate = new Date(assignment.createdAt || assignment.datebut);
        const existingRange = new Date(existing.datefin).getTime() - new Date(existing.datebut).getTime();
        const currentRange = new Date(assignment.datefin).getTime() - new Date(assignment.datebut).getTime();
        
        if (isCurrentActive && !isExistingActive) {
          // Prefer active over inactive
          seen.set(key, assignment);
        } else if (isCurrentActive === isExistingActive) {
          if (currentDate > existingDate) {
            // Prefer more recent
            seen.set(key, assignment);
          } else if (currentDate.getTime() === existingDate.getTime() && currentRange > existingRange) {
            // If same date, prefer longer date range
            seen.set(key, assignment);
          }
        }
      }
    });

    // Always show deduplicated assignments; planning sessions are filtered separately below.
    return Array.from(seen.values());
  }, [assignmentsRaw, sessionInstanceKeys, sessionInstancesData, isLoadingSessionInstances]);

  const { weekStart, weekEnd } = useMemo(() => getWeekRange(sessionDate), [sessionDate]);

  const { data: weeklyPlannedSessions = [] } = useQuery({
    queryKey: ['attendance-week-planned-sessions', weekStart, weekEnd],
    queryFn: () => fetchPlannedSessionsForWeek(weekStart, weekEnd),
    enabled: attendanceMode === 'planning',
  });

  const plannedSessionsForAssignment = useMemo(() => {
    const selected = assignments.find((a) => a.id === selectedAssignment);
    const allInstances: PlannedSessionInstance[] = Array.isArray(weeklyPlannedSessions)
      ? weeklyPlannedSessions
      : [];

    if (!selected) return [];

    const normalize = (value?: string) => (value || '').trim().toLowerCase();
    const selectedClassId = selected.classId || '';
    const selectedCourseId = selected.courseId || '';
    const selectedClassName = normalize(selected.className);
    const selectedCourseName = normalize(selected.courseName);
    const selectedCourseCode = normalize(selected.courseCode);

    return allInstances
      .filter((si) => {
        // Primary match by IDs when available
        if (selectedClassId && selectedCourseId && si.classId && si.courseId) {
          return si.classId === selectedClassId && si.courseId === selectedCourseId;
        }

        // Fallback by names/codes for tenants where IDs are not consistently exposed
        const sessionClassName = normalize(si.className);
        const sessionCourseName = normalize(si.courseName);
        const sessionCourseCode = normalize((si as any).courseCode);

        const classMatches = selectedClassName && sessionClassName && sessionClassName === selectedClassName;
        const courseMatchesByName = selectedCourseName && sessionCourseName && sessionCourseName === selectedCourseName;
        const courseMatchesByCode = selectedCourseCode && sessionCourseCode && sessionCourseCode === selectedCourseCode;

        return Boolean(classMatches && (courseMatchesByName || courseMatchesByCode));
      })
      .sort((a, b) => {
        const aTime = new Date(a.startDatetime || a.sessionDate || '').getTime();
        const bTime = new Date(b.startDatetime || b.sessionDate || '').getTime();
        return bTime - aTime;
      });
  }, [assignments, selectedAssignment, weeklyPlannedSessions]);

  // Fetch attendance history for selected assignment
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['attendance-history', selectedAssignment],
    queryFn: () => fetchAttendanceHistory(selectedAssignment),
    enabled: !!selectedAssignment,
  });

  const recordedPlanningKeys = useMemo(() => {
    const keys = new Set<string>();
    history.forEach((h) => {
      const date = String(h.sessionDate || '').slice(0, 10);
      const slot = String(h.timeSlot || '').trim();
      if (date && slot) keys.add(`${date}|${slot}`);
    });
    return keys;
  }, [history]);

  const availablePlannedSessions = useMemo(() => {
    return plannedSessionsForAssignment.filter((session) => {
      const start = getPlannedStartDate(session);
      if (!start) return true;
      const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      const startLabel = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
      const end = getPlannedEndDate(session);
      const slot = end
        ? `${startLabel}-${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
        : startLabel;
      return !recordedPlanningKeys.has(`${date}|${slot}`);
    });
  }, [plannedSessionsForAssignment, recordedPlanningKeys]);

  useEffect(() => {
    setSelectedPlannedSessionId('');
    setStartHour('');
    setEndHour('');
  }, [selectedAssignment]);

  useEffect(() => {
    if (attendanceMode === 'manual') {
      setSelectedPlannedSessionId('');
    }
  }, [attendanceMode]);

  useEffect(() => {
    if (attendanceMode !== 'planning' || !selectedPlannedSessionId) return;
    const selectedPlanned = availablePlannedSessions.find((s) => s.id === selectedPlannedSessionId);
    if (!selectedPlanned) return;

    const startDate = getPlannedStartDate(selectedPlanned);
    if (startDate) {
      const y = startDate.getFullYear();
      const m = String(startDate.getMonth() + 1).padStart(2, '0');
      const d = String(startDate.getDate()).padStart(2, '0');
      setSessionDate(`${y}-${m}-${d}`);
    }

    if (startDate) {
      const hh = String(startDate.getHours()).padStart(2, '0');
      const mm = String(startDate.getMinutes()).padStart(2, '0');
      setStartHour(`${hh}:${mm}`);
    }

    const endDate = getPlannedEndDate(selectedPlanned);
    if (endDate) {
      const hh = String(endDate.getHours()).padStart(2, '0');
      const mm = String(endDate.getMinutes()).padStart(2, '0');
      setEndHour(`${hh}:${mm}`);
    }
  }, [attendanceMode, selectedPlannedSessionId, availablePlannedSessions]);

  // Fetch students for selected assignment
  const { data: students = [], isLoading: studentsLoading } = useQuery({
    queryKey: ['assignment-students', selectedAssignment],
    queryFn: () => fetchStudentsByAssignment(selectedAssignment),
    enabled: !!selectedAssignment,
  });

  // Auto-generate session title from selected context
  useEffect(() => {
    if (selectedAssignment && startHour && endHour && history.length >= 0) {
      // Count existing sessions and add 1 for the next session
      const nextSessionNumber = history.length + 1;
      const formattedNumber = nextSessionNumber.toString().padStart(2, '0');
      const modeLabel = attendanceMode === 'planning' ? 'Planning' : 'Manuelle';
      const autoTitle = `Seance N°${formattedNumber} (${modeLabel}) - ${startHour} à ${endHour}`;
      setSessionTitle(autoTitle);
    }
  }, [selectedAssignment, startHour, endHour, attendanceMode, history.length]);


  // Save attendance mutation
  const saveAttendanceMutation = useMutation({
    mutationFn: saveAttendance,
    onSuccess: (_data, variables) => {
      toast({
        title: "Succès",
        description: "Présences enregistrées avec succès",
      });
      // Reset form
      setAttendanceRecords({});
      setSessionTitle('');
      // Rafraîchir l'historique pour ce cours
      if (variables?.assignmentId) {
        queryClient.invalidateQueries({ queryKey: ['attendance-history', variables.assignmentId] });
      }
    },
    onError: (_error) => {
      toast({
        title: "Erreur",
        description: "Échec de l'enregistrement des présences",
        variant: "destructive",
      });
    },
  });

  const handleAttendanceChange = (studentId: string, status: AttendanceRecord['status']) => {
    setAttendanceRecords(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        studentId,
        status,
      }
    }));
  };

  const handleNotesChange = (studentId: string, notes: string) => {
    setAttendanceRecords(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        studentId,
        status: prev[studentId]?.status || 'present',
        notes,
      }
    }));
  };

  const handleSaveAttendance = () => {
    if (!selectedAssignment || !startHour || !endHour || !sessionTitle.trim()) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner un cours, une heure de début, une heure de fin et saisir un titre de séance",
        variant: "destructive",
      });
      return;
    }
    const [sh, sm] = startHour.split(':').map(Number);
    const [eh, em] = endHour.split(':').map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    if (endMinutes <= startMinutes) {
      toast({
        title: "Erreur",
        description: "L'heure de fin doit être après l'heure de début.",
        variant: "destructive",
      });
      return;
    }

    if (attendanceMode === 'planning' && !selectedPlannedSessionId) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner une séance planifiée.",
        variant: "destructive",
      });
      return;
    }

    const records = students.map(student =>
      attendanceRecords[student.id] || {
        studentId: student.id,
        status: 'present' as const,
      }
    );

    const selectedPlanned = availablePlannedSessions.find((s) => s.id === selectedPlannedSessionId);
    const durationHours = attendanceMode === 'planning' && selectedPlanned?.durationMinutes
      ? Math.max(1, Math.round(selectedPlanned.durationMinutes / 60))
      : Math.max(1, Math.round((endMinutes - startMinutes) / 60));

    const assignmentMeta = assignments.find((a) => a.id === selectedAssignment);

    saveAttendanceMutation.mutate({
      assignmentId: selectedAssignment,
      date: sessionDate,
      timeSlot: `${startHour}-${endHour}`,
      sessionTitle,
      durationHours,
      records,
      courseNameSnapshot: assignmentMeta?.courseName ?? null,
      courseCodeSnapshot: assignmentMeta?.courseCode ?? null,
      classNameSnapshot: assignmentMeta?.className ?? null,
      teacherNameSnapshot: assignmentMeta?.teacherName ?? null,
      teacherEmailSnapshot: sessionEmail || userEmail || null,
    });
  };


  // Historique: actions
  const openDetails = (session: AttendanceSession) => setDetailsSession(session);

  const exportSessionCsv = async (session: AttendanceSession) => {
    try {
      const rows = await fetchSessionRecords(session.id);

      // Excel (fr-FR) attend souvent le point-virgule et un BOM UTF-8
      const DELIM = ';';
      const BOM = '\uFEFF';

      const headers = ['Date', 'Étudiant', 'Matricule', 'Statut', 'Notes'];

      const escapeCsv = (value: unknown) => {
        const raw = (value ?? '').toString();
        // Échapper les guillemets et encapsuler si nécessaire
        const needsQuotes = raw.includes(DELIM) || raw.includes('"') || raw.includes('\n') || raw.includes('\r');
        const escaped = raw.replace(/"/g, '""');
        return needsQuotes ? `"${escaped}"` : escaped;
      };

      const statusLabel = (s: string) => {
        switch (s) {
          case 'present': return 'Présent';
          case 'absent': return 'Absent';
          case 'late': return 'Retard';
          case 'excused': return 'Excusé';
          default: return s;
        }
      };

      const lines: string[] = [];
      lines.push(headers.join(DELIM));

      for (const r of rows) {
        const date = new Date(session.sessionDate).toLocaleDateString('fr-FR');
        lines.push([
          escapeCsv(date),
          escapeCsv(r.studentName || ''),
          escapeCsv(r.studentNumber || ''),
          escapeCsv(statusLabel(r.attendanceStatus)),
          escapeCsv(r.notes || ''),
        ].join(DELIM));
      }

      const csv = BOM + lines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `presences_${new Date(session.sessionDate).toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: 'Erreur', description: "Échec de l'export CSV", variant: 'destructive' });
    }
  };

  const getStatusBadge = (status: AttendanceRecord['status']) => {
    const variants = {
      present: { variant: 'default' as const, label: 'Présent', icon: UserCheck },
      absent: { variant: 'destructive' as const, label: 'Absent', icon: UserX },
      late: { variant: 'secondary' as const, label: 'Retard', icon: Clock },
      excused: { variant: 'outline' as const, label: 'Excusé', icon: UserCheck },
    };

    const config = variants[status];
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const selectedAssignmentData = assignments.find(a => a.id === selectedAssignment);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Gestion des Présences</h1>
          <p className="text-gray-200 mt-2">Enregistrez les présences de vos étudiants</p>
        </div>
        <div className="flex items-center gap-2 text-purple-600">
          <Users className="w-6 h-6" />
          <span className="font-semibold">Présences</span>
        </div>
      </div>

      {/* Configuration Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Configuration de la séance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Mode de saisie</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={attendanceMode === 'planning' ? 'default' : 'outline'}
                onClick={() => setAttendanceMode('planning')}
              >
                Depuis planning
              </Button>
              <Button
                type="button"
                variant={attendanceMode === 'manual' ? 'default' : 'outline'}
                onClick={() => setAttendanceMode('manual')}
              >
                Manuel
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="assignment">Cours assigné</Label>
              <Select value={selectedAssignment} onValueChange={setSelectedAssignment}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un cours" />
                </SelectTrigger>
            <SelectContent>
              {assignments.map((assignment) => (
                <SelectItem key={assignment.id} value={assignment.id}>
                  {assignment.courseName} ({assignment.courseCode}) - {assignment.className}
                </SelectItem>
              ))}
              {assignments.length === 0 && (
                <div className="p-2 text-sm text-gray-500">Aucun cours disponible</div>
              )}
            </SelectContent>
              </Select>
            </div>

            {attendanceMode === 'planning' && (
              <div className="space-y-2">
                <Label>Séance du planning (semaine du {new Date(`${weekStart}T00:00:00`).toLocaleDateString('fr-FR')} au {new Date(`${weekEnd}T00:00:00`).toLocaleDateString('fr-FR')})</Label>
                <Select value={selectedPlannedSessionId} onValueChange={setSelectedPlannedSessionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner une séance planifiée" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePlannedSessions.map((session) => {
                      const start = getPlannedStartDate(session);
                      const end = getPlannedEndDate(session);
                      const dateLabel = session.sessionDate
                        ? new Date(session.sessionDate).toLocaleDateString('fr-FR')
                        : (start ? start.toLocaleDateString('fr-FR') : '-');
                      const startLabel = start
                        ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
                        : '--:--';
                      const endLabel = end
                        ? `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
                        : '--:--';
                      return (
                        <SelectItem key={session.id} value={session.id}>
                          {dateLabel} - {startLabel} à {endLabel}
                        </SelectItem>
                      );
                    })}
                    {availablePlannedSessions.length === 0 && (
                      <div className="p-2 text-sm text-gray-500">Aucune séance planifiée pour ce cours</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {attendanceMode !== 'planning' && <div />}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date de la séance</Label>
              <Input
                id="date"
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="startHour">Heure début</Label>
              <Input
                id="startHour"
                type="time"
                value={startHour}
                onChange={(e) => setStartHour(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endHour">Heure fin</Label>
              <Input
                id="endHour"
                type="time"
                value={endHour}
                onChange={(e) => setEndHour(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Titre de la séance</Label>
              <Input
                id="title"
                placeholder="Ex: Cours magistral - Chapitre 3"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
              />
            </div>
          </div>

          {selectedAssignmentData && (
            <div className="p-4 bg-purple-50 rounded-lg">
              <h3 className="font-semibold text-purple-900">Cours sélectionné</h3>
              <p className="text-purple-700">
                {selectedAssignmentData.courseName} ({selectedAssignmentData.courseCode})
              </p>
              <p className="text-purple-600 text-sm">
                Classe: {selectedAssignmentData.className} •
                Enseignant: {selectedAssignmentData.teacherName}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Students Attendance Section */}
      {selectedAssignment && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Liste des étudiants ({students.length})
              </CardTitle>
              <Button
                onClick={handleSaveAttendance}
                disabled={saveAttendanceMutation.isPending || !sessionTitle.trim()}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Save className="w-4 h-4 mr-2" />
                {saveAttendanceMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {studentsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Chargement des étudiants...</p>
              </div>
            ) : students.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Aucun étudiant trouvé pour ce cours</p>
              </div>
            ) : (
              <div className="space-y-4">
                {students.map((student) => {
                  const record = attendanceRecords[student.id];
                  return (
                    <div key={student.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold">
                            {student.firstName} {student.lastName}
                          </h4>
                          <p className="text-sm text-gray-500">
                            {student.matricule} • {student.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {record && getStatusBadge(record.status)}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Statut de présence</Label>
                          <Select
                            value={record?.status || 'present'}
                            onValueChange={(value) => handleAttendanceChange(student.id, value as AttendanceRecord['status'])}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="present">Présent</SelectItem>
                              <SelectItem value="absent">Absent</SelectItem>
                              <SelectItem value="late">Retard</SelectItem>
                              <SelectItem value="excused">Excusé</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Notes (optionnel)</Label>
                          <Input
                            placeholder="Commentaires..."
                            value={record?.notes || ''}
                            onChange={(e) => handleNotesChange(student.id, e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedAssignment && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Historique des séances
            </CardTitle>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Chargement de l'historique...</p>
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Aucun historique disponible pour ce cours</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((s) => (
                  <div key={s.id} className="border rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{new Date(s.sessionDate).toLocaleDateString()}</div>
                      <div className="text-sm text-gray-500">{s.sessionTitle}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">Total: {s.summary.total}</Badge>
                        <Badge variant="default">Présents: {s.summary.present}</Badge>
                        <Badge variant="secondary">Retards: {s.summary.late}</Badge>
                        <Badge variant="destructive">Absents: {s.summary.absent}</Badge>
                        <Badge variant="outline">Excusés: {s.summary.excused}</Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => openDetails(s)}>
                          <Eye className="w-4 h-4 mr-1" /> Voir étudiants
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => exportSessionCsv(s)}>
                          <FileDown className="w-4 h-4 mr-1" /> Exporter Excel
                        </Button>


                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}


      {/* Modal Détails séance */}
      <Dialog open={!!detailsSession} onOpenChange={(open) => { if (!open) setDetailsSession(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Liste des étudiants — {detailsSession && new Date(detailsSession.sessionDate).toLocaleDateString()} ({detailsSession?.sessionTitle})
            </DialogTitle>
          </DialogHeader>

          {sessionRecordsLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
              <p className="text-gray-500 mt-2">Chargement...</p>
            </div>
          ) : sessionRecords.length === 0 ? (
            <p className="text-gray-500">Aucun enregistrement</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto divide-y">
              {sessionRecords.map((r) => {
                const statusForBadge = (r.attendanceStatus === 'medical_leave' ? 'excused' : r.attendanceStatus) as AttendanceRecord['status'];
                return (
                  <div key={r.id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="font-medium">{r.studentName}</div>
                      <div className="text-sm text-gray-500">{r.studentNumber}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(statusForBadge)}
                      {r.notes && <span className="text-sm text-gray-500">{r.notes}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
