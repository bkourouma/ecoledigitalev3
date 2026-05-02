'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { redirect, useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  ArrowLeft,
  GraduationCap,
  Mail,
  Phone,
  Calendar,
  Clock,
  Hash,
  BookOpen,
  MessageSquare,
} from 'lucide-react';
import { useChildDetails, useChildGradesSummary, useChildAttendance, useAbsenceHistory, AbsenceHistoryFilters } from '@/lib/hooks/use-parent-children';
import { ChildGradesSummary } from '../../components/ChildGradesSummary';
import { AttendanceRecords } from '../../components/AttendanceRecords';
import { AbsenceHistory } from '../../components/AbsenceHistory';

export default function ChildDetailPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const childId = params?.childId as string;

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has parent role
  const roles = (session as any)?.roles ?? [];
  const isParent = Array.isArray(roles) && roles.includes('parent');

  if (!isParent) {
    redirect('/');
  }

  // State for attendance pagination
  const [attendancePage, setAttendancePage] = React.useState(1);

  // State for absence history filters
  const [absenceFilters, setAbsenceFilters] = React.useState<AbsenceHistoryFilters>({});

  // Fetch child details, grades summary, attendance records, and absence history
  const { data: childData, isLoading: isLoadingChild, error: childError } = useChildDetails(childId);
  const { data: gradesData, isLoading: isLoadingGrades, error: gradesError } = useChildGradesSummary(childId);
  const { data: attendanceData, isLoading: isLoadingAttendance, error: attendanceError } = useChildAttendance(childId, attendancePage);
  const { data: absenceData, isLoading: isLoadingAbsence, error: absenceError } = useAbsenceHistory(childId, absenceFilters);

  const child = childData?.data?.child;
  const gradesSummary = gradesData?.data?.gradesSummary || null;
  const attendanceRecords = attendanceData?.data?.attendanceRecords || null;
  const attendancePagination = attendanceData?.data?.pagination || null;
  const absences = absenceData?.data?.absences || null;
  const absenceStatistics = absenceData?.data?.statistics || null;

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      suspended: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      dropped: 'bg-red-500/15 text-red-400 border-red-500/30',
      transfer: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      graduated: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    };
    const labels: Record<string, string> = {
      active: 'Actif',
      suspended: 'Suspendu',
      dropped: 'Abandonné',
      transfer: 'Transféré',
      graduated: 'Diplômé',
    };
    return (
      <Badge variant="outline" className={styles[status] ?? 'bg-muted text-muted-foreground'}>
        {labels[status] ?? status}
      </Badge>
    );
  };

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();

  const getGradient = (id: string) => {
    const gradients = [
      'from-emerald-500 to-teal-600',
      'from-blue-500 to-indigo-600',
      'from-purple-500 to-pink-600',
      'from-amber-500 to-orange-600',
      'from-rose-500 to-red-600',
      'from-cyan-500 to-blue-600',
    ];
    const sum = Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0);
    return gradients[sum % gradients.length];
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Non renseigné';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/parent/children">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour à la liste
            </Button>
          </Link>

          {child && (
            <div className="mt-4 flex flex-col lg:flex-row lg:items-center gap-6">
              <div
                className={`flex-shrink-0 h-20 w-20 rounded-2xl bg-gradient-to-br ${getGradient(child.id)} flex items-center justify-center text-white font-bold text-2xl shadow-lg`}
                aria-hidden="true"
              >
                {getInitials(child.name)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-bold text-foreground">{child.name}</h1>
                  {getStatusBadge(child.status)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4" />
                    Année {child.currentYear}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono">
                    <Hash className="h-3.5 w-3.5" />
                    {child.studentNumber}
                  </span>
                  <span className="flex items-center gap-1.5 truncate">
                    <Mail className="h-4 w-4" />
                    {child.email}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link href={`/parent/children/${childId}/schedule`}>
                  <Button variant="outline" size="sm">
                    <Clock className="h-4 w-4 mr-2" />
                    Emploi du temps
                  </Button>
                </Link>
                <Link href="/parent/homework">
                  <Button variant="outline" size="sm">
                    <BookOpen className="h-4 w-4 mr-2" />
                    Devoirs
                  </Button>
                </Link>
                <Link href="/parent/messages">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Contacter
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoadingChild ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
          </div>
        ) : childError ? (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="pt-6 text-center py-8">
              <p className="text-red-400 font-medium">Erreur lors du chargement</p>
              <p className="text-muted-foreground text-sm mt-2">
                {childError.message || "Impossible de charger les informations de l'enfant"}
              </p>
            </CardContent>
          </Card>
        ) : !child ? (
          <Card>
            <CardContent className="pt-6 text-center py-8">
              <p className="text-muted-foreground">Enfant non trouvé</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Informations personnelles</CardTitle>
                <CardDescription>Coordonnées et données académiques</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <InfoTile
                    icon={<Hash className="h-4 w-4" />}
                    label="Numéro d'étudiant"
                    value={`#${child.studentNumber}`}
                    tone="emerald"
                  />
                  <InfoTile
                    icon={<GraduationCap className="h-4 w-4" />}
                    label="Année actuelle"
                    value={`Année ${child.currentYear}`}
                    tone="blue"
                  />
                  <InfoTile
                    icon={<Calendar className="h-4 w-4" />}
                    label="Date de naissance"
                    value={formatDate(child.dateOfBirth)}
                    tone="amber"
                  />
                  <InfoTile
                    icon={<Mail className="h-4 w-4" />}
                    label="Email"
                    value={child.email}
                    tone="purple"
                    mono
                  />
                  {child.phone && (
                    <InfoTile
                      icon={<Phone className="h-4 w-4" />}
                      label="Téléphone"
                      value={child.phone}
                      tone="emerald"
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            <ChildGradesSummary
              gradesSummary={gradesSummary}
              isLoading={isLoadingGrades}
              error={gradesError as Error | null}
            />

            {/* Attendance Records */}
            <AttendanceRecords
              attendanceRecords={attendanceRecords}
              pagination={attendancePagination}
              isLoading={isLoadingAttendance}
              error={attendanceError as Error | null}
              onPageChange={setAttendancePage}
            />

            {/* Absence History */}
            <AbsenceHistory
              absences={absences}
              statistics={absenceStatistics}
              isLoading={isLoadingAbsence}
              error={absenceError as Error | null}
              onFiltersChange={setAbsenceFilters}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
  tone,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'emerald' | 'blue' | 'purple' | 'amber';
  mono?: boolean;
}) {
  const tones = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  } as const;

  return (
    <div className="rounded-xl border border-border bg-background/50 p-4 flex items-start gap-3">
      <div className={`flex-shrink-0 rounded-lg border p-2 ${tones[tone]}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={`text-sm font-semibold text-foreground mt-0.5 truncate ${mono ? 'font-mono' : ''}`}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

