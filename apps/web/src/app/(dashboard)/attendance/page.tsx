"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
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
} from "@ecoledigitale/ui";
import {
  Calendar,
  Clock,
  Users,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  Edit,
  Loader2,
  Download,
  FileText,
  FileSpreadsheet,
  X,
  BookOpen,
  User,
  Building2,
} from "lucide-react";
import {
  useSessionInstancesSimple,
  AttendanceSession,
} from "@/lib/hooks/use-attendance";
import { useClasses } from "@/lib/hooks/use-classes";
import { useTeachers } from "@/lib/hooks/use-teachers";
import { exportToPDF, exportToExcel, exportToCSV, AttendanceExportData } from "@/lib/utils/export";

const AttendancePage = () => {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  const [exportingSession, setExportingSession] = useState<string | null>(null);

  // Fetch data
  const { data: sessionsData, isLoading: sessionsLoading, error: sessionsError } = useSessionInstancesSimple();
  const { data: classesData } = useClasses();
  const { data: teachersData } = useTeachers();

  const sessions = sessionsData?.data || [];
  const classes = classesData?.data || [];
  const teachers = teachersData?.data || [];

  // Filter sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter((session: any) => {
      const matchesSearch =
        searchQuery === "" ||
        (session.className && session.className.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (session.courseName && session.courseName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (session.teacherName && session.teacherName.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus = statusFilter === "all" || session.status === statusFilter;
      
      // Find class ID from class name for filtering
      const sessionClass = classes.find((cls: any) => cls.name === session.className);
      const matchesClass = classFilter === "all" || (sessionClass && sessionClass.id === classFilter);
      
      // Find teacher ID from teacher name for filtering
      const sessionTeacher = teachers.find((teacher: any) => 
        `${teacher.firstName} ${teacher.lastName}` === session.teacherName
      );
      const matchesTeacher = teacherFilter === "all" || (sessionTeacher && sessionTeacher.id === teacherFilter);

      return matchesSearch && matchesStatus && matchesClass && matchesTeacher;
    });
  }, [sessions, searchQuery, statusFilter, classFilter, teacherFilter, classes, teachers]);

  const getStatusLabel = (status: string) => {
    const statuses: Record<string, string> = {
      scheduled: 'Programmé',
      in_progress: 'En cours',
      completed: 'Terminé',
      cancelled: 'Annulé',
    };
    return statuses[status] || status;
  };

  const handleCreateNew = () => {
    router.push("/attendance/new");
  };

  const handleViewSession = (session: any) => {
    router.push(`/attendance/${session.id}`);
  };

  const handleExportIndividualSession = async (session: any, format: 'pdf' | 'excel' | 'csv') => {
    setExportingSession(session.id);
    try {
      // Find the class by name to get enrolled students
      const currentClass = classes.find((cls: any) => cls.name === session.className);

      if (!currentClass) {
        console.error('Class not found for session');
        return;
      }

      // Fetch enrolled students for the class
      const enrollmentsResponse = await fetch(`/api/v1/enrollments?classId=${currentClass.id}&status=active`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!enrollmentsResponse.ok) {
        throw new Error('Failed to fetch enrollments');
      }

      const enrollmentsData = await enrollmentsResponse.json();

      // Fetch attendance records for this session
      const attendanceResponse = await fetch(`/api/v1/attendance-legacy/records?sessionId=${session.id}`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      let attendanceRecords: any[] = [];
      if (attendanceResponse.ok) {
        const attendanceData = await attendanceResponse.json();
        attendanceRecords = attendanceData.data || [];
      }

      // Create attendance map
      const attendanceMap = new Map();
      attendanceRecords.forEach(record => {
        attendanceMap.set(record.studentId, {
          status: record.attendanceStatus,
          notes: record.notes,
          arrivalTime: record.arrivalTime,
          departureTime: record.departureTime,
        });
      });

      // Prepare export data
      const students = enrollmentsData.data?.map((enrollment: any) => {
        const attendance = attendanceMap.get(enrollment.student.id);
        return {
          studentNumber: enrollment.student.studentNumber,
          name: `${enrollment.student.firstName} ${enrollment.student.lastName}`,
          attendanceStatus: attendance?.status || 'absent',
          arrivalTime: attendance?.arrivalTime || '',
          departureTime: attendance?.departureTime || '',
          notes: attendance?.notes || '',
        };
      }) || [];

      const exportData: AttendanceExportData = {
        sessionInfo: {
          className: session.className,
          courseName: session.courseName || 'Cours non défini',
          teacherName: session.teacherName || 'Enseignant non défini',
          sessionDate: new Date(session.sessionDate).toLocaleDateString('fr-FR'),
          sessionTime: session.sessionTime || 'Heure non définie',
          location: session.classroom || '',
          notes: session.notes || '',
        },
        students,
      };

      if (format === 'pdf') {
        exportToPDF(exportData);
      } else if (format === 'excel') {
        exportToExcel(exportData);
      } else {
        exportToCSV(exportData);
      }
    } catch (error) {
      console.error('Failed to export session:', error);
    } finally {
      setExportingSession(null);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Gestion des Présences
          </h1>
          <p className="text-muted-foreground sm:mt-2 whitespace-nowrap text-sm md:text-base">
            Gérez les sessions de cours et enregistrez les présences des étudiants
          </p>
        </div>
        <Button
          onClick={handleCreateNew}
          className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 w-full sm:w-auto"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle Session
        </Button>
      </div>

      {/* Quick Stats */}
      {!sessionsLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          <div className="bg-gradient-to-br from-emerald-500 to-green-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total sessions
                </p>
                <p className="text-3xl font-bold mt-1">{sessions.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Calendar className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Sessions terminées
                </p>
                <p className="text-3xl font-bold mt-1">
                  {sessions.filter((s: any) => s.status === 'completed').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <CheckCircle2 className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-emerald-400 to-green-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  En cours
                </p>
                <p className="text-3xl font-bold mt-1">
                  {sessions.filter((s: any) => s.status === 'in_progress').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Clock className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-400 to-emerald-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Programmées
                </p>
                <p className="text-3xl font-bold mt-1">
                  {sessions.filter((s: any) => s.status === 'scheduled').length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <AlertCircle className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filter Controls */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search Bar */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Rechercher par classe, cours ou enseignant..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 w-full"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Filters Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 gap-4 lg:gap-4 lg:flex lg:flex-row">
              {/* Status Filter */}
              <div className="w-full lg:w-48">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-11 border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 w-full">
                    <Filter className="h-4 w-4 mr-2 text-gray-400 flex-shrink-0" />
                    <SelectValue placeholder="Filtrer par statut" />
                  </SelectTrigger>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    <SelectItem value="all">Tous les statuts</SelectItem>
                    <SelectItem value="scheduled">Programmé</SelectItem>
                    <SelectItem value="in_progress">En cours</SelectItem>
                    <SelectItem value="completed">Terminé</SelectItem>
                    <SelectItem value="cancelled">Annulé</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Class Filter */}
              <div className="w-full lg:w-48">
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="h-11 border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 w-full">
                    <BookOpen className="h-4 w-4 mr-2 text-gray-400 flex-shrink-0" />
                    <SelectValue placeholder="Filtrer par classe" />
                  </SelectTrigger>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    <SelectItem value="all">Toutes les classes</SelectItem>
                    {classes.map((cls: any) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        <span className="truncate block">{cls.name} ({cls.code})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Teacher Filter */}
              <div className="w-full lg:w-48">
                <Select value={teacherFilter} onValueChange={setTeacherFilter}>
                  <SelectTrigger className="h-11 border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 w-full">
                    <User className="h-4 w-4 mr-2 text-gray-400 flex-shrink-0" />
                    <SelectValue placeholder="Filtrer par enseignant" />
                  </SelectTrigger>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    <SelectItem value="all">Tous les enseignants</SelectItem>
                    {teachers.map((teacher: any) => (
                      <SelectItem key={teacher.id} value={teacher.id}>
                        <span className="truncate block">{teacher.firstName} {teacher.lastName}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Results Count */}
            <div className="flex items-center justify-center lg:justify-start text-sm text-foreground/80 whitespace-nowrap">
              <span className="font-medium">{filteredSessions.length}</span>
              <span className="ml-1">
                {filteredSessions.length === 1 ? 'session trouvée' : 'sessions trouvées'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {sessionsError && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12 px-4">
            <div className="text-center space-y-4 max-w-md">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Erreur de chargement</h3>
                <p className="text-sm sm:text-base text-muted-foreground mt-2 break-words">
                  Impossible de charger les sessions. Vérifiez votre connexion.
                </p>
              </div>
              <Button onClick={() => window.location.reload()} className="w-full sm:w-auto">
                Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {sessionsLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16 px-4">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-emerald-100 to-green-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              </div>
              <p className="text-foreground/80 text-base sm:text-lg px-4">Chargement des sessions...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sessions List */}
      {!sessionsLoading && filteredSessions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredSessions.map((session: any) => {
            return (
              <div
                key={session.id}
                className="bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
              >
                <div className="relative z-10">
                  <div className="mb-4">
                    <h3 className="font-semibold text-base sm:text-lg text-white break-words">
                      {session.className}
                    </h3>
                    <p className="text-white/90 text-sm mt-1 break-words">
                      {session.courseName || 'Cours non défini'}
                    </p>
                  </div>

                  <div className="space-y-2 mb-4">
                    <p className="text-white/90 text-sm break-words">
                      <span className="font-medium">Enseignant:</span> {session.teacherName || 'Non défini'}
                    </p>
                    <p className="text-white/90 text-sm break-words">
                      <span className="font-medium">Statut:</span> {getStatusLabel(session.status)}
                    </p>
                    <p className="text-white/90 text-sm flex items-center flex-wrap">
                      <Calendar className="w-4 h-4 mr-1 flex-shrink-0" />
                      <span className="break-words">{new Date(session.sessionDate).toLocaleDateString('fr-FR')}</span>
                    </p>
                    <p className="text-white/90 text-sm flex items-center flex-wrap">
                      <Clock className="w-4 h-4 mr-1 flex-shrink-0" />
                      <span className="break-words">{session.sessionTime || 'Heure non définie'} ({session.durationMinutes || 0} min)</span>
                    </p>
                    {session.classroom && (
                      <p className="text-white/90 text-sm flex items-center flex-wrap">
                        <Building2 className="w-4 h-4 mr-1 flex-shrink-0" />
                        <span className="break-words">{session.classroom}</span>
                      </p>
                    )}
                    <p className="text-white/90 text-sm break-words">
                      <span className="font-medium">Présences prises:</span> {session.attendanceTaken ? 'Oui' : 'Non'}
                    </p>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewSession(session);
                      }}
                      title="Voir les détails"
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      Voir
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportIndividualSession(session, 'pdf');
                      }}
                      disabled={exportingSession === session.id}
                      title="Exporter en PDF"
                    >
                      {exportingSession === session.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportIndividualSession(session, 'excel');
                      }}
                      disabled={exportingSession === session.id}
                      title="Exporter en Excel"
                    >
                      {exportingSession === session.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileSpreadsheet className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Decorative background element */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full transform translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full transform -translate-x-12 translate-y-12 group-hover:scale-110 transition-transform duration-500"></div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State - No sessions at all */}
      {!sessionsLoading && sessions.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12 sm:py-16 px-4">
            <div className="text-center space-y-4 sm:space-y-6 max-w-md">
              <div className="bg-gradient-to-br from-emerald-100 to-green-100 rounded-full w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center mx-auto">
                <Calendar className="h-8 w-8 sm:h-10 sm:w-10 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">Aucune session trouvée</h3>
                <p className="text-sm sm:text-base text-foreground/80 break-words">
                  Commencez par créer votre première session de présence
                </p>
              </div>
              <Button
                onClick={handleCreateNew}
                className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 w-full sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer une session
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!sessionsLoading && sessions.length > 0 && filteredSessions.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12 sm:py-16 px-4">
            <div className="text-center space-y-4 sm:space-y-6 max-w-md">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center mx-auto">
                <Search className="h-8 w-8 sm:h-10 sm:w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">Aucun résultat trouvé</h3>
                <p className="text-sm sm:text-base text-foreground/80 break-words">
                  Aucune session ne correspond à vos critères de recherche
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setClassFilter("all");
                    setTeacherFilter("all");
                  }}
                  className="border-gray-300 hover:bg-gray-50 w-full sm:w-auto"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
                <Button
                  onClick={handleCreateNew}
                  className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle session
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AttendancePage;
