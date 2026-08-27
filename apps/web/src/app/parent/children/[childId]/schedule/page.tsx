'use client';

import React, { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { redirect, useParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import Link from 'next/link';
import { useChildDetails, useChildSchedule, useUpcomingClasses } from '@/lib/hooks/use-parent-children';
import { useChildEmploiTemps } from '@/lib/hooks/use-professional-emploi-temps';
import { ChildEmploiTemps } from '../../../components/ChildEmploiTemps';
import { ChildSchedule } from '../../../components/ChildSchedule';
import { UpcomingClasses } from '../../../components/UpcomingClasses';

export default function ChildSchedulePage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const childId = params?.childId as string;

  // State for current week
  const [currentWeek, setCurrentWeek] = useState<string>(() => {
    // Default to current week (Monday)
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust to Monday
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().split('T')[0];
  });

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

  // Fetch child details, schedule, and upcoming classes
  const { data: childData, isLoading: isLoadingChild, error: childError } = useChildDetails(childId);
  const { data: scheduleData, isLoading: isLoadingSchedule, error: scheduleError } = useChildSchedule(childId, currentWeek);
  const { data: upcomingClassesData, isLoading: isLoadingUpcoming, error: upcomingError } = useUpcomingClasses(childId);
  // Module professionnel : ces élèves n'ont pas de classe ni de séances au sens
  // du portail classique. Dès qu'ils ont des créneaux, c'est la grille du module
  // professionnel qui fait foi — la même que dans l'espace étudiant.
  const { data: professionalSlots } = useChildEmploiTemps(childId);
  const isProfessional = Array.isArray(professionalSlots) && professionalSlots.length > 0;

  const child = childData?.data?.child;
  const { weekStart, weekEnd } = useMemo(() => {
    const start = currentWeek;
    const [y, m, d] = currentWeek.split('-').map(Number);
    const endDate = new Date(y, m - 1, d);
    endDate.setDate(endDate.getDate() + 6);
    const yy = endDate.getFullYear();
    const mm = String(endDate.getMonth() + 1).padStart(2, '0');
    const dd = String(endDate.getDate()).padStart(2, '0');
    return { weekStart: start, weekEnd: `${yy}-${mm}-${dd}` };
  }, [currentWeek]);
  const schedule = scheduleData?.data?.schedule || [];
  const upcomingClasses = upcomingClassesData?.data?.upcomingClasses || [];

  // Navigation functions
  const goToPreviousWeek = () => {
    const weekDate = new Date(currentWeek);
    weekDate.setDate(weekDate.getDate() - 7);
    setCurrentWeek(weekDate.toISOString().split('T')[0]);
  };

  const goToNextWeek = () => {
    const weekDate = new Date(currentWeek);
    weekDate.setDate(weekDate.getDate() + 7);
    setCurrentWeek(weekDate.toISOString().split('T')[0]);
  };

  const goToCurrentWeek = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust to Monday
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    setCurrentWeek(monday.toISOString().split('T')[0]);
  };

  // Format week range for display
  const formatWeekRange = (start: string, end: string) => {
    if (!start || !end) return '';
    const startDate = new Date(start);
    const endDate = new Date(end);
    const startFormatted = startDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const endFormatted = endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    return `${startFormatted} - ${endFormatted}`;
  };

  // Check if current week is selected
  const isCurrentWeek = useMemo(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return currentWeek === monday.toISOString().split('T')[0];
  }, [currentWeek]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card shadow-sm border-b border-border">
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
                Emploi du Temps
              </h1>
              {child && (
                <p className="text-gray-600 mt-2">
                  Planning hebdomadaire de {child.name}
                </p>
              )}
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
        ) : isProfessional ? (
          /* Module professionnel : grille hebdomadaire + cascade de filtres,
             identique à « Mon emploi du temps » de l'espace étudiant. */
          <ChildEmploiTemps childId={childId} />
        ) : (
          <div className="space-y-6">
            {/* Week Navigation */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToPreviousWeek}
                    className="flex items-center gap-2 w-full sm:w-auto"
                    aria-label="Aller à la semaine précédente"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Semaine précédente
                  </Button>

                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="flex items-center gap-2 justify-center mb-1">
                        <Calendar className="h-5 w-5 text-emerald-600" />
                        <span className="font-semibold text-white">
                          {formatWeekRange(weekStart, weekEnd)}
                        </span>
                      </div>
                      {!isCurrentWeek && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={goToCurrentWeek}
                          className="text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        >
                          Retour à cette semaine
                        </Button>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToNextWeek}
                    className="flex items-center gap-2 w-full sm:w-auto"
                    aria-label="Aller à la semaine suivante"
                  >
                    Semaine suivante
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Weekly Schedule */}
            <ChildSchedule
              schedule={schedule}
              weekStart={weekStart}
              weekEnd={weekEnd}
              isLoading={isLoadingSchedule}
              error={scheduleError as Error | null}
            />

            {/* Upcoming Classes */}
            <UpcomingClasses
              upcomingClasses={upcomingClasses}
              isLoading={isLoadingUpcoming}
              error={upcomingError as Error | null}
            />
          </div>
        )}
      </div>
    </div>
  );
}

