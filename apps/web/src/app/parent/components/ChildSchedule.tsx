'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, MapPin, User, AlertCircle, BookOpen } from 'lucide-react';
import { ScheduleSession } from '@ecoledigitale/contracts';

interface ChildScheduleProps {
  schedule: ScheduleSession[];
  weekStart: string;
  weekEnd: string;
  isLoading?: boolean;
  error?: Error | null;
}

const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const dayNamesShort = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function ChildSchedule({ schedule, weekStart, weekEnd, isLoading, error }: ChildScheduleProps) {
  // Format week dates
  const formatWeekRange = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const startFormatted = startDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const endFormatted = endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    return `${startFormatted} - ${endFormatted}`;
  };

  // Get all dates in the week - MUST be called before any conditional returns
  const weekDates = useMemo(() => {
    const dates: string[] = [];
    const startDate = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
  }, [weekStart]);

  // Group schedule by day - MUST be called before any conditional returns
  const scheduleByDay = useMemo(() => {
    const grouped: Record<string, ScheduleSession[]> = {};
    
    // Initialize all days
    const startDate = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      grouped[dateKey] = [];
    }

    // Group sessions by date
    if (schedule && Array.isArray(schedule)) {
      schedule.forEach((session) => {
        const dateKey = session.date;
        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        grouped[dateKey].push(session);
      });

      // Sort sessions within each day by start time
      Object.keys(grouped).forEach((dateKey) => {
        grouped[dateKey].sort((a, b) => {
          const timeA = a.startTime || '';
          const timeB = b.startTime || '';
          return timeA.localeCompare(timeB);
        });
      });
    }

    return grouped;
  }, [schedule, weekStart]);

  // Get day name from date
  const getDayName = (dateString: string) => {
    const date = new Date(dateString);
    const dayIndex = date.getDay();
    // Convert Sunday (0) to 6, Monday (1) to 0, etc.
    const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
    return dayNames[adjustedIndex];
  };

  // Get day number from date
  const getDayNumber = (dateString: string) => {
    const date = new Date(dateString);
    return date.getDate();
  };

  // Get month name from date
  const getMonthName = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { month: 'long' });
  };

  // Format time (HH:MM)
  const formatTime = (time: string) => {
    if (!time) return '';
    // Handle both HH:MM:SS and HH:MM formats
    return time.substring(0, 5);
  };

  // Loading state - AFTER all hooks
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Emploi du Temps Hebdomadaire
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement du planning hebdomadaire">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500" aria-hidden="true"></div>
            <span className="sr-only">Chargement en cours...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state - AFTER all hooks
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Emploi du Temps Hebdomadaire
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium">Erreur lors du chargement</p>
            <p className="text-gray-600 text-sm mt-2">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state - AFTER all hooks
  if (!schedule || schedule.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Emploi du Temps Hebdomadaire
          </CardTitle>
          <CardDescription>
            {formatWeekRange(weekStart, weekEnd)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Calendar className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun cours prévu</h3>
            <p className="text-gray-600">
              Aucun cours n'est prévu pour cette semaine.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-emerald-600" />
          Emploi du Temps Hebdomadaire
        </CardTitle>
        <CardDescription className="text-white">
          {formatWeekRange(weekStart, weekEnd)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Weekly Grid View */}
          <div className="overflow-x-auto">
            <div className="min-w-full">
              {/* Days Header */}
              <div className="grid grid-cols-7 gap-2 mb-4" role="rowgroup" aria-label="En-têtes des jours de la semaine">
                {weekDates.map((dateKey) => {
                  const dayName = getDayName(dateKey);
                  const dayNumber = getDayNumber(dateKey);
                  const sessions = scheduleByDay[dateKey] || [];
                  const isToday = dateKey === new Date().toISOString().split('T')[0];

                  return (
                    <div
                      key={dateKey}
                      className={`text-center p-3 rounded-lg border ${
                        isToday
                          ? 'bg-emerald-100 border-emerald-400'
                          : 'bg-white border-gray-300 shadow-sm'
                      }`}
                    >
                      <div className={`text-sm font-medium ${isToday ? 'text-emerald-800' : 'text-gray-700'}`}>{dayName}</div>
                      <div
                        className={`text-2xl font-bold mt-1 ${
                          isToday ? 'text-emerald-700' : 'text-gray-900'
                        }`}
                      >
                        {dayNumber}
                      </div>
                      <div className={`text-xs mt-1 ${isToday ? 'text-emerald-700' : 'text-gray-600'}`}>
                        {sessions.length} {sessions.length === 1 ? 'cours' : 'cours'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Schedule by Day */}
              <div className="space-y-6">
                {weekDates.map((dateKey) => {
                  const sessions = scheduleByDay[dateKey] || [];
                  const dayName = getDayName(dateKey);
                  const dayNumber = getDayNumber(dateKey);
                  const isToday = dateKey === new Date().toISOString().split('T')[0];

                  if (sessions.length === 0) {
                    return null;
                  }

                  return (
                    <div key={dateKey} className="border border-gray-300 rounded-lg p-4 bg-white shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div
                          className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg ${
                            isToday
                              ? 'bg-emerald-500 text-white'
                              : 'bg-gray-300 text-gray-800'
                          }`}
                        >
                          {dayNumber}
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{dayName}</h3>
                          <p className="text-sm text-gray-600">
                            {new Date(dateKey).toLocaleDateString('fr-FR', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {sessions.map((session) => (
                          <div
                            key={session.id}
                            className="bg-gradient-to-r from-emerald-50 to-blue-50 rounded-lg p-4 border border-emerald-200 hover:shadow-md transition-shadow"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <BookOpen className="h-5 w-5 text-emerald-600" />
                                  <h4 className="text-lg font-semibold text-gray-900">
                                    {session.courseName}
                                  </h4>
                                  {session.courseCode && (
                                    <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">
                                      {session.courseCode}
                                    </Badge>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                                  {/* Time */}
                                  <div className="flex items-center gap-2 text-sm text-gray-700">
                                    <Clock className="h-4 w-4 text-emerald-600" />
                                    <span className="font-medium">
                                      {formatTime(session.startTime)} - {formatTime(session.endTime)}
                                    </span>
                                  </div>

                                  {/* Teacher */}
                                  {session.teacherName && (
                                    <div className="flex items-center gap-2 text-sm text-gray-700">
                                      <User className="h-4 w-4 text-blue-600" />
                                      <span>{session.teacherName}</span>
                                    </div>
                                  )}

                                  {/* Classroom */}
                                  {session.classroom && (
                                    <div className="flex items-center gap-2 text-sm text-gray-700">
                                      <MapPin className="h-4 w-4 text-purple-600" />
                                      <span>{session.classroom}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

