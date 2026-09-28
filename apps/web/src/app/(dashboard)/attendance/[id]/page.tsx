"use client";

import { useRouter, useParams } from "next/navigation";
import { useState, useEffect, useMemo, useRef } from "react";
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
  ArrowLeft,
  Calendar,
  Clock,
  Users,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Save,
  User,
  BookOpen,
  Building2,
  Timer,
} from "lucide-react";
import {
  useSessionInstance,
  useSessionAttendanceRecords,
  useBatchMarkAttendance,
} from "@/lib/hooks/use-attendance";
import { useEnrollments } from "@/lib/hooks/use-enrollments";
import { useClasses } from "@/lib/hooks/use-classes";

export default function AttendanceSessionPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;

  const { data: sessionData, isLoading: sessionLoading, error: sessionError } = useSessionInstance(sessionId);
  const { data: attendanceRecordsData } = useSessionAttendanceRecords(sessionId);
  const batchMarkAttendanceMutation = useBatchMarkAttendance();

  const [attendanceData, setAttendanceData] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Get class ID from session to fetch enrollments
  // Handle different response formats: { data: {...} } or { success: true, data: {...} }
  const session = useMemo(() => {
    if (!sessionData) return null;
    // Backend returns { success: true, data: {...} }
    if ((sessionData as any)?.success && (sessionData as any)?.data) {
      return (sessionData as any).data;
    }
    // Direct data format
    if (sessionData?.data) {
      return sessionData.data;
    }
    // Fallback: assume sessionData is the session itself
    return sessionData;
  }, [sessionData]);
  const classId = session?.classId;
  const { data: classesData } = useClasses();
  const classItem = classesData?.data?.find((cls: any) => cls.id === classId);
  
  // Always call useEnrollments, even if classId is undefined (it will handle it)
  const { data: enrollmentsData } = useEnrollments({
    classId: classId || "",
    status: "active",
  });

  // Debug logging - MUST be before any conditional returns
  useEffect(() => {
    if (sessionError) {
      console.error('❌ Session error:', sessionError);
    }
    if (sessionData) {
      console.log('📊 Session data received:', sessionData);
    }
    if (session) {
      console.log('✅ Session parsed:', session);
    }
  }, [sessionError, sessionData, session]);

  // Deduplicate students by ID to prevent duplicate key errors
  const students = useMemo(() => {
    const enrollments = enrollmentsData?.data || [];
    const studentsList = enrollments.map((enrollment: any) => enrollment.student).filter(Boolean);
    
    // Deduplicate by student ID
    const seenIds = new Set<string>();
    const uniqueStudents: any[] = [];
    
    studentsList.forEach((student: any, index: number) => {
      if (student?.id && !seenIds.has(student.id)) {
        seenIds.add(student.id);
        uniqueStudents.push(student);
      } else if (student?.id) {
        console.warn(`[AttendanceSessionPage] Duplicate student ID found at index ${index}:`, student.id);
      }
    });
    
    return uniqueStudents;
  }, [enrollmentsData?.data]);

  const attendanceRecords = useMemo(() => {
    return attendanceRecordsData?.data || [];
  }, [attendanceRecordsData?.data]);

  // Track if we've initialized the attendance data
  const initializedRef = useRef(false);

  // Load existing attendance records into state
  useEffect(() => {
    // Skip if already initialized and we're not refreshing
    if (initializedRef.current && attendanceRecords.length === 0) return;

    if (attendanceRecords.length > 0 && students.length > 0) {
      const existingAttendance: Record<string, string> = {};
      const existingNotes: Record<string, string> = {};

      attendanceRecords.forEach((record: any) => {
        existingAttendance[record.studentId] = record.attendanceStatus || 'present';
        // Load notes, and if status requires excuse reason, also load excuseReason
        if (record.notes) {
          existingNotes[record.studentId] = record.notes;
        }
        // If status is excused/medical_leave and excuseReason exists, use it for notes field
        if ((record.attendanceStatus === 'excused' || record.attendanceStatus === 'medical_leave') && record.excuseReason) {
          existingNotes[record.studentId] = record.excuseReason;
        }
      });

      // Fill in missing students with 'present'
      students.forEach((student: any) => {
        if (!existingAttendance[student.id]) {
          existingAttendance[student.id] = 'present';
        }
      });

      // Only update state if it's different from current state to avoid overwriting user changes
      setAttendanceData(prev => {
        // Check if there are any differences
        const hasChanges = Object.keys(existingAttendance).some(
          studentId => existingAttendance[studentId] !== prev[studentId]
        ) || students.some((student: any) => !prev[student.id]);

        if (hasChanges || !initializedRef.current) {
          console.log('🔄 Loading attendance records into state:', existingAttendance);
          return existingAttendance;
        }
        return prev;
      });

      setNotes(prev => {
        const hasChanges = Object.keys(existingNotes).some(
          studentId => existingNotes[studentId] !== prev[studentId]
        );

        if (hasChanges || !initializedRef.current) {
          return existingNotes;
        }
        return prev;
      });

      initializedRef.current = true;
    } else if (students.length > 0 && attendanceRecords.length === 0 && !initializedRef.current) {
      // Initialize with 'present' for all students if no records exist (only on first load)
      const initialAttendance: Record<string, string> = {};
      students.forEach((student: any) => {
        initialAttendance[student.id] = 'present';
      });
      setAttendanceData(initialAttendance);
      initializedRef.current = true;
    }
  }, [attendanceRecords, students]);

  const handleAttendanceChange = (studentId: string, status: string) => {
    console.log(`🔄 Changing attendance for student ${studentId} to ${status}`);
    setAttendanceData(prev => {
      const updated = { ...prev, [studentId]: status };
      console.log('📝 Updated attendance state:', updated);
      return updated;
    });
  };

  const handleNotesChange = (studentId: string, note: string) => {
    setNotes(prev => ({ ...prev, [studentId]: note }));
  };

  const handleSaveAttendance = async () => {
    if (!sessionId) return;

    // Validate that excused/medical_leave statuses have excuse reasons
    const validationErrors: string[] = [];
    students.forEach((student: any) => {
      const status = attendanceData[student.id] || 'present';
      const studentNotes = notes[student.id] || '';
      
      if ((status === 'excused' || status === 'medical_leave') && !studentNotes.trim()) {
        validationErrors.push(`${student.firstName} ${student.lastName}`);
      }
    });

    if (validationErrors.length > 0) {
      alert(
        `Veuillez fournir une raison d'excuse pour les étudiants suivants marqués comme excusés ou en congé médical:\n\n${validationErrors.join('\n')}`
      );
      return;
    }

    setSaving(true);
    try {
      const attendanceRecords = students.map((student: any) => {
        const status = attendanceData[student.id] || 'present';
        const studentNotes = notes[student.id] || '';
        
        // For excused/medical_leave status, map notes to excuseReason
        const record: any = {
          studentId: student.id,
          attendanceStatus: status,
          notes: studentNotes,
        };

        // If status requires excuse reason, set excuseReason from notes
        if (status === 'excused' || status === 'medical_leave') {
          record.excuseReason = studentNotes || 'Non spécifié';
        }

        return record;
      });

      console.log('📤 Sending attendance records:', {
        sessionId,
        recordsCount: attendanceRecords.length,
        records: attendanceRecords.map(r => ({
          studentId: r.studentId,
          status: r.attendanceStatus,
          notes: r.notes,
          hasExcuseReason: !!r.excuseReason,
          excuseReason: r.excuseReason,
        })),
      });
      
      // Debug: Log current state to verify data is correct
      console.log('🔍 Current attendance state:', attendanceData);
      console.log('🔍 Current notes state:', notes);

      const result = await batchMarkAttendanceMutation.mutateAsync({
        sessionId,
        data: { attendanceRecords },
      });

      console.log('✅ Attendance saved successfully:', result);

      // Verify that records were actually saved
      if (result?.data && Array.isArray(result.data) && result.data.length > 0) {
        console.log(`✅ Successfully saved ${result.data.length} attendance records`);
        console.log('📦 Saved records data:', result.data);
        
        // Update local state with the saved data to reflect changes immediately
        const updatedAttendance: Record<string, string> = { ...attendanceData };
        const updatedNotes: Record<string, string> = { ...notes };
        
        result.data.forEach((savedRecord: any) => {
          console.log(`📝 Updating state for student ${savedRecord.studentId}: ${savedRecord.attendanceStatus}`);
          updatedAttendance[savedRecord.studentId] = savedRecord.attendanceStatus;
          if (savedRecord.notes) {
            updatedNotes[savedRecord.studentId] = savedRecord.notes;
          }
          // For excused/medical_leave, use excuseReason for notes
          if ((savedRecord.attendanceStatus === 'excused' || savedRecord.attendanceStatus === 'medical_leave') && savedRecord.excuseReason) {
            updatedNotes[savedRecord.studentId] = savedRecord.excuseReason;
          }
        });
        
        console.log('🔄 Final updated attendance state:', updatedAttendance);
        setAttendanceData(updatedAttendance);
        setNotes(updatedNotes);
        
        // Keep initializedRef as true to prevent useEffect from overwriting our updated state
        // The state is already updated with the saved data, so we don't need to reload
        initializedRef.current = true;
      } else {
        console.warn('⚠️ Warning: No attendance records returned in response', result);
      }

      // Wait a moment to ensure the mutation is fully processed and cache is invalidated
      await new Promise(resolve => setTimeout(resolve, 500));

      // Show success message before redirecting
      alert(`Présences enregistrées avec succès (${attendanceRecords.length} étudiant(s))`);

      // Redirect back to attendance list
      router.push("/attendance");
    } catch (error) {
      console.error('Error saving attendance:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide more specific error messages
      if (errorMessage.includes('excuse_reason_required') || errorMessage.includes('excuse_reason')) {
        alert('Erreur: Une raison d\'excuse est requise pour les étudiants marqués comme excusés ou en congé médical.');
      } else {
        alert(`Erreur lors de l'enregistrement des présences: ${errorMessage}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "present": return "bg-green-100 text-green-800 border-green-200";
      case "absent": return "bg-red-100 text-red-800 border-red-200";
      case "late": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "excused": return "bg-blue-100 text-blue-800 border-blue-200";
      case "medical_leave": return "bg-purple-100 text-purple-800 border-purple-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getStatusLabel = (status: string) => {
    const statuses: Record<string, string> = {
      present: 'Présent',
      absent: 'Absent',
      late: 'En retard',
      excused: 'Excusé',
      medical_leave: 'Congé médical',
    };
    return statuses[status] || status;
  };

  if (sessionLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-6xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-emerald-100 to-green-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
            <p className="text-foreground/80 text-base sm:text-lg px-4">Chargement des informations de la session...</p>
          </div>
        </div>
      </div>
    );
  }

  if (sessionError || (!sessionLoading && !session)) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-6xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 px-4">
            <div className="text-center space-y-4 max-w-md">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Session introuvable</h3>
                <p className="text-sm sm:text-base text-muted-foreground mt-2">
                  La session demandée n'existe pas ou vous n'avez pas les permissions pour la consulter.
                </p>
                {sessionError && (
                  <p className="text-sm text-red-600 mt-2 break-words">
                    Erreur: {sessionError instanceof Error ? sessionError.message : String(sessionError)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2 break-all">
                  ID de session: {sessionId}
                </p>
              </div>
              <Button onClick={() => router.push("/attendance")} className="w-full sm:w-auto">
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/attendance")}
          className="w-fit"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Session de Présence
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            {session.className} - {session.courseName || 'Cours non défini'}
          </p>
        </div>
      </div>

      {/* Session Info Card */}
      <Card className="mb-6 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Informations de la session
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">Classe</p>
                <p className="font-medium break-words">{session.className}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">Enseignant</p>
                <p className="font-medium break-words">{session.teacherName || 'Non défini'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-medium break-words">
                  {new Date(session.sessionDate).toLocaleDateString('fr-FR')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">Heure</p>
                <p className="font-medium break-words">{session.sessionTime || 'Non définie'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">Durée</p>
                <p className="font-medium break-words">{session.durationMinutes || 0} minutes</p>
              </div>
            </div>
            {session.classroom && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">Salle</p>
                  <p className="font-medium break-words">{session.classroom}</p>
                </div>
              </div>
            )}
          </div>
          {session.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{session.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendance List */}
      <Card className="shadow-lg">
        <CardHeader>
          <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
            <div className="flex-1 min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl whitespace-nowrap text-2xl leading-tight md:text-3xl">
                <Users className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                <span className="truncate">Liste des étudiants ({students.length})</span>
              </CardTitle>
              <CardDescription className="mt-1">
                Marquez la présence de chaque étudiant pour cette session
              </CardDescription>
            </div>
            <Button
              onClick={handleSaveAttendance}
              disabled={saving || batchMarkAttendanceMutation.isPending}
              className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white w-full sm:w-auto"
            >
              {saving || batchMarkAttendanceMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Enregistrer
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Aucun étudiant inscrit dans cette classe</p>
            </div>
          ) : (
            <div className="space-y-4">
              {students.map((student: any, index: number) => {
                const currentStatus = attendanceData[student.id] || 'present';
                const currentNotes = notes[student.id] || '';
                
                // Use composite key to ensure uniqueness even if student IDs are duplicated
                const uniqueKey = `attendance-student-${student.id}-${index}`;
                
                // Debug log to verify current status
                if (student.id === '5ebf8d56-897b-4a69-80c1-51b0e754631d') {
                  console.log(`🎯 Rendering Select for student ${student.id} with status:`, currentStatus, 'from state:', attendanceData[student.id]);
                }

                return (
                  <div
                    key={uniqueKey}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
                          {student.firstName?.[0] || student.lastName?.[0] || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {student.firstName} {student.lastName}
                          </p>
                          {student.studentNumber && (
                            <p className="text-sm text-muted-foreground truncate">
                              Matricule: {student.studentNumber}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center w-full sm:w-auto">
                      <div className="w-full sm:w-48">
                        <Select
                          key={`${student.id}-${currentStatus}`}
                          value={currentStatus}
                          onValueChange={(value) => handleAttendanceChange(student.id, value)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                            <SelectItem value="present">Présent</SelectItem>
                            <SelectItem value="absent">Absent</SelectItem>
                            <SelectItem value="late">En retard</SelectItem>
                            <SelectItem value="excused">Excusé</SelectItem>
                            <SelectItem value="medical_leave">Congé médical</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-full sm:w-64">
                        <Input
                          placeholder={
                            currentStatus === 'excused' || currentStatus === 'medical_leave'
                              ? "Raison d'excuse (requis)"
                              : "Notes (optionnel)"
                          }
                          value={currentNotes}
                          onChange={(e) => handleNotesChange(student.id, e.target.value)}
                          className={`h-10 w-full ${
                            (currentStatus === 'excused' || currentStatus === 'medical_leave') && !currentNotes.trim()
                              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                              : ''
                          }`}
                          required={currentStatus === 'excused' || currentStatus === 'medical_leave'}
                        />
                        {(currentStatus === 'excused' || currentStatus === 'medical_leave') && !currentNotes.trim() && (
                          <p className="text-xs text-red-600 mt-1">Une raison d'excuse est requise</p>
                        )}
                      </div>
                      <div className="w-full sm:w-auto">
                        <Badge
                          variant="outline"
                          className={`${getStatusColor(currentStatus)} w-fit`}
                        >
                          {getStatusLabel(currentStatus)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

