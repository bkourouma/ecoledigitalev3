'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { redirect, useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowLeft, GraduationCap, Mail, Phone, Calendar, User, Clock } from 'lucide-react';
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

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Actif</Badge>;
      case 'suspended':
        return <Badge className="bg-yellow-100 text-yellow-800">Suspendu</Badge>;
      case 'dropped':
        return <Badge className="bg-red-100 text-red-800">Abandonné</Badge>;
      case 'transfer':
        return <Badge className="bg-blue-100 text-blue-800">Transféré</Badge>;
      case 'graduated':
        return <Badge className="bg-purple-100 text-purple-800">Diplômé</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
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
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-emerald-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 py-6">
            <Link href="/parent/children">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Retour à la liste
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                Détails de l'Enfant
              </h1>
              <p className="text-gray-600 mt-2">
                Informations détaillées et résumé académique
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoadingChild ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
          </div>
        ) : childError ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <p className="text-red-600 font-medium">Erreur lors du chargement</p>
                <p className="text-gray-600 text-sm mt-2">
                  {childError.message || 'Impossible de charger les informations de l\'enfant'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : !child ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <p className="text-gray-600">Enfant non trouvé</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Child Information Card */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-2xl flex items-center gap-3">
                      <User className="h-6 w-6 text-emerald-600" />
                      {child.name}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      Informations personnelles et académiques
                    </CardDescription>
                  </div>
                  {getStatusBadge(child.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Student Number */}
                  <div className="flex items-start gap-3">
                    <div className="bg-emerald-100 p-2 rounded-lg">
                      <GraduationCap className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Numéro d'étudiant</p>
                      <p className="text-lg font-semibold text-white">#{child.studentNumber}</p>
                    </div>
                  </div>

                  {/* Current Year */}
                  <div className="flex items-start gap-3">
                    <div className="bg-blue-100 p-2 rounded-lg">
                      <GraduationCap className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Année actuelle</p>
                      <p className="text-lg font-semibold text-white">Année {child.currentYear}</p>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="flex items-start gap-3">
                    <div className="bg-purple-100 p-2 rounded-lg">
                      <Mail className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Email</p>
                      <p className="text-lg font-semibold text-white">{child.email}</p>
                    </div>
                  </div>

                  {/* Date of Birth */}
                  <div className="flex items-start gap-3">
                    <div className="bg-amber-100 p-2 rounded-lg">
                      <Calendar className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Date de naissance</p>
                      <p className="text-lg font-semibold text-white">
                        {formatDate(child.dateOfBirth)}
                      </p>
                    </div>
                  </div>

                  {/* Phone */}
                  {child.phone && (
                    <div className="flex items-start gap-3">
                      <div className="bg-green-100 p-2 rounded-lg">
                        <Phone className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">Téléphone</p>
                        <p className="text-lg font-semibold text-white">{child.phone}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Grades Summary */}
            <ChildGradesSummary
              gradesSummary={gradesSummary}
              isLoading={isLoadingGrades}
              error={gradesError as Error | null}
            />

            {/* Schedule Link */}
            <Card>
              <CardContent className="pt-6">
                <Link href={`/parent/children/${childId}/schedule`}>
                  <Button className="w-full" variant="outline" size="lg">
                    <Clock className="h-5 w-5 mr-2 text-emerald-600" />
                    Voir l'emploi du temps hebdomadaire
                  </Button>
                </Link>
              </CardContent>
            </Card>

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

