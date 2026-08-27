'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, MapPin, User, AlertCircle, BookOpen } from 'lucide-react';
import { ParentScheduleSession } from '@ecoledigitale/contracts';

interface UpcomingClassesProps {
  upcomingClasses: ParentScheduleSession[] | null;
  isLoading?: boolean;
  error?: Error | null;
}

export function UpcomingClasses({ upcomingClasses, isLoading, error }: UpcomingClassesProps) {
  // Format time (HH:MM)
  const formatTime = (time: string) => {
    if (!time) return '';
    // Handle both HH:MM:SS and HH:MM formats
    return time.substring(0, 5);
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    if (dateOnly.getTime() === today.getTime()) {
      return "Aujourd'hui";
    }

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateOnly.getTime() === tomorrow.getTime()) {
      return 'Demain';
    }

    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  // Check if class is today
  const isToday = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);
    return dateOnly.getTime() === today.getTime();
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Prochains Cours
          </CardTitle>
          <CardDescription>
            Les 7 prochains jours (maximum 10 cours)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement des prochains cours">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500" aria-hidden="true"></div>
            <span className="sr-only">Chargement en cours...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Prochains Cours
          </CardTitle>
          <CardDescription>
            Les 7 prochains jours (maximum 10 cours)
          </CardDescription>
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

  // Empty state
  if (!upcomingClasses || upcomingClasses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Prochains Cours
          </CardTitle>
          <CardDescription>
            Les 7 prochains jours (maximum 10 cours)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Calendar className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun cours à venir</h3>
            <p className="text-gray-600">
              Aucun cours n'est prévu dans les 7 prochains jours.
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
          Prochains Cours
        </CardTitle>
        <CardDescription>
          Les 7 prochains jours (maximum 10 cours)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {upcomingClasses.map((classItem) => {
            const today = isToday(classItem.date);

            return (
              <div
                key={classItem.id}
                className={`border rounded-lg p-4 transition-shadow hover:shadow-md ${
                  today
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-white border-gray-300 shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Date and Time */}
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className={`h-4 w-4 ${today ? 'text-emerald-600' : 'text-gray-600'}`} />
                      <span className={`text-sm font-semibold ${today ? 'text-emerald-700' : 'text-gray-700'}`}>
                        {formatDate(classItem.date)}
                      </span>
                      {today && (
                        <Badge variant="default" className="bg-emerald-600 text-white text-xs">
                          Aujourd'hui
                        </Badge>
                      )}
                    </div>

                    {/* Course Name */}
                    <div className="flex items-center gap-2 mb-2">
                      <BookOpen className="h-5 w-5 text-emerald-600" />
                      <h4 className="text-lg font-semibold text-gray-900">
                        {classItem.courseName}
                      </h4>
                      {classItem.courseCode && (
                        <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">
                          {classItem.courseCode}
                        </Badge>
                      )}
                    </div>

                    {/* Time, Teacher, Classroom */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      {/* Time */}
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <Clock className="h-4 w-4 text-emerald-600" />
                        <span className="font-medium">
                          {formatTime(classItem.startTime)} - {formatTime(classItem.endTime)}
                        </span>
                      </div>

                      {/* Teacher */}
                      {classItem.teacherName && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <User className="h-4 w-4 text-blue-600" />
                          <span>{classItem.teacherName}</span>
                        </div>
                      )}

                      {/* Classroom */}
                      {classItem.classroom && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <MapPin className="h-4 w-4 text-purple-600" />
                          <span>{classItem.classroom}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

