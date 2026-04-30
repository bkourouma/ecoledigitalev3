'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar as CalendarIcon, CalendarDays, List, Filter, AlertCircle, GraduationCap } from 'lucide-react';
import { AcademicCalendarEvent, AcademicCalendarFilter } from '@ecoledigitale/contracts';
import { useAcademicCalendar } from '@/lib/hooks/use-parent-academic';
import { format, parseISO, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth } from 'date-fns';
import { fr } from 'date-fns/locale';

interface AcademicCalendarProps {
  academicYears?: Array<{ id: string; name: string }>;
  filters?: AcademicCalendarFilter;
  onFiltersChange?: (filters: AcademicCalendarFilter) => void;
}

type ViewMode = 'calendar' | 'list';

export function AcademicCalendar({
  academicYears = [],
  filters = {},
  onFiltersChange,
}: AcademicCalendarProps) {
  const [localFilters, setLocalFilters] = useState<AcademicCalendarFilter>(filters);
  const [startDate, setStartDate] = useState<string>(filters.startDate || '');
  const [endDate, setEndDate] = useState<string>(filters.endDate || '');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  // Use the hook with current filters
  const { data, isLoading, error } = useAcademicCalendar(
    localFilters.academicYearId,
    localFilters.semester,
    localFilters.startDate,
    localFilters.endDate
  );

  const events = data?.data?.events || [];

  // Handle filter change
  const handleFilterChange = (key: keyof AcademicCalendarFilter, value: string | number | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Handle date range change
  const handleDateRangeChange = () => {
    const newFilters = {
      ...localFilters,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Get event type badge
  const getEventTypeBadge = (type: string) => {
    const types: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      semester_start: { label: 'Début de Semestre', variant: 'default' },
      semester_end: { label: 'Fin de Semestre', variant: 'secondary' },
      holiday: { label: 'Vacances', variant: 'outline' },
      break: { label: 'Pause', variant: 'outline' },
      special_event: { label: 'Événement Spécial', variant: 'default' },
      academic_milestone: { label: 'Étape Académique', variant: 'secondary' },
    };
    return types[type] || { label: 'Autre', variant: 'outline' };
  };

  // Get events for a specific date
  const getEventsForDate = (date: Date) => {
    return events.filter((event) => {
      if (!event.eventDate) return false;
      const eventDate = parseISO(event.eventDate);
      return isSameDay(eventDate, date);
    });
  };

  // Calendar view helpers
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Group events by date for list view
  const eventsByDate = events.reduce((acc, event) => {
    if (!event.eventDate) return acc;
    const date = event.eventDate;
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(event);
    return acc;
  }, {} as Record<string, AcademicCalendarEvent[]>);

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-emerald-600" />
            Calendrier Académique
          </CardTitle>
          <CardDescription>
            Dates importantes de l'année académique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Chargement du calendrier...</p>
            </div>
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
            <CalendarIcon className="h-5 w-5 text-emerald-600" />
            Calendrier Académique
          </CardTitle>
          <CardDescription>
            Dates importantes de l'année académique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Erreur lors du chargement</p>
              <p className="text-gray-500 text-sm">{error.message || 'Une erreur est survenue'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-emerald-600" />
            Calendrier Académique
          </CardTitle>
          <CardDescription>
            Dates importantes de l'année académique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <CalendarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-2">Aucun événement disponible</p>
              <p className="text-gray-500 text-sm">Aucun événement du calendrier académique n'est actuellement disponible.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5 text-emerald-600" />
                Calendrier Académique
              </CardTitle>
              <CardDescription>
                Dates importantes de l'année académique
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="flex items-center gap-2"
              >
                <List className="h-4 w-4" />
                Liste
              </Button>
              <Button
                variant={viewMode === 'calendar' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('calendar')}
                className="flex items-center gap-2"
              >
                <CalendarDays className="h-4 w-4" />
                Calendrier
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filtres</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {academicYears.length > 0 && (
                <Select
                  value={localFilters.academicYearId || 'all'}
                  onValueChange={(value) => handleFilterChange('academicYearId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Toutes les années" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les années</SelectItem>
                    {academicYears.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select
                value={localFilters.semester?.toString() || 'all'}
                onValueChange={(value) => handleFilterChange('semester', value === 'all' ? undefined : parseInt(value, 10))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les semestres" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les semestres</SelectItem>
                  <SelectItem value="1">Semestre 1</SelectItem>
                  <SelectItem value="2">Semestre 2</SelectItem>
                </SelectContent>
              </Select>

              <div>
                <Label htmlFor="start-date">Date début</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    handleFilterChange('startDate', e.target.value || undefined);
                  }}
                />
              </div>

              <div>
                <Label htmlFor="end-date">Date fin</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    handleFilterChange('endDate', e.target.value || undefined);
                  }}
                />
              </div>
            </div>
          </div>

          {/* List View */}
          {viewMode === 'list' && (
            <div className="space-y-4">
              {Object.entries(eventsByDate)
                .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
                .map(([date, dateEvents], index: number) => (
                  <Card key={`${date}-${index}`} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <CardTitle className="text-lg">
                        {format(parseISO(date), 'EEEE d MMMM yyyy', { locale: fr })}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {dateEvents.map((event) => {
                          const eventType = getEventTypeBadge(event.eventType);

                          return (
                            <div key={event.eventId} className="flex items-start gap-3 p-3 border rounded-lg">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className="font-semibold text-gray-900">{event.eventName}</h4>
                                  <Badge variant={eventType.variant}>{eventType.label}</Badge>
                                </div>
                                {event.eventDescription && (
                                  <p className="text-sm text-gray-600 mb-2">{event.eventDescription}</p>
                                )}
                                <div className="flex items-center gap-4 text-sm text-gray-500">
                                  {event.academicYearName && (
                                    <div className="flex items-center gap-1">
                                      <GraduationCap className="h-4 w-4" />
                                      <span>{event.academicYearName}</span>
                                    </div>
                                  )}
                                  {event.semester && (
                                    <span>Semestre {event.semester}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          {/* Calendar View */}
          {viewMode === 'calendar' && (
            <div className="space-y-4">
              {/* Month Navigation */}
              <div className="flex items-center justify-between mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                >
                  Précédent
                </Button>
                <h3 className="text-lg font-semibold">
                  {format(currentMonth, 'MMMM yyyy', { locale: fr })}
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                >
                  Suivant
                </Button>
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-2">
                {/* Day headers */}
                {['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map((day) => (
                  <div key={day} className="text-center font-medium text-gray-700 py-2">
                    {day}
                  </div>
                ))}

                {/* Calendar days */}
                {daysInMonth.map((day) => {
                  const dayEvents = getEventsForDate(day);
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isToday = isSameDay(day, new Date());

                  return (
                    <div
                      key={day.toISOString()}
                      className={`min-h-[80px] p-2 border rounded-lg ${
                        !isCurrentMonth ? 'bg-gray-50 text-gray-400' : 'bg-white'
                      } ${isToday ? 'ring-2 ring-emerald-500' : ''}`}
                    >
                      <div className="text-sm font-medium mb-1">{format(day, 'd')}</div>
                      <div className="space-y-1">
                        {dayEvents.slice(0, 2).map((event) => {
                          const eventType = getEventTypeBadge(event.eventType);
                          return (
                            <div
                              key={event.eventId}
                              className="text-xs p-1 rounded truncate"
                              style={{
                                backgroundColor: eventType.variant === 'default' ? '#10b981' : '#6b7280',
                                color: 'white',
                              }}
                              title={event.eventName}
                            >
                              {event.eventName}
                            </div>
                          );
                        })}
                        {dayEvents.length > 2 && (
                          <div className="text-xs text-gray-500">+{dayEvents.length - 2} autres</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

