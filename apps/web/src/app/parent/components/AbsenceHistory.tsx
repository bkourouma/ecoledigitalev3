'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, AlertCircle, XCircle, FileText, Filter, TrendingDown, BarChart3 } from 'lucide-react';
import { AbsenceRecord, AbsenceStatistics, AbsenceHistoryFilters } from '@/lib/hooks/use-parent-children';

interface AbsenceHistoryProps {
  absences: AbsenceRecord[] | null;
  statistics: AbsenceStatistics | null;
  isLoading?: boolean;
  error?: Error | null;
  onFiltersChange?: (filters: AbsenceHistoryFilters) => void;
}

export function AbsenceHistory({ 
  absences, 
  statistics, 
  isLoading, 
  error,
  onFiltersChange 
}: AbsenceHistoryProps) {
  const [filters, setFilters] = useState<AbsenceHistoryFilters>({
    startDate: '',
    endDate: '',
    absenceType: undefined,
    courseId: undefined,
  });

  // Handle filter change
  const handleFilterChange = (key: keyof AbsenceHistoryFilters, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    setFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: AbsenceHistoryFilters = {
      startDate: undefined,
      endDate: undefined,
      absenceType: undefined,
      courseId: undefined,
    };
    setFilters(resetFilters);
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  // Get absence type badge
  const getAbsenceTypeBadge = (absenceType: string) => {
    switch (absenceType) {
      case 'absent':
        return <Badge className="bg-red-100 text-red-800">Non excusé</Badge>;
      case 'excused':
        return <Badge className="bg-blue-100 text-blue-800">Excusé</Badge>;
      case 'medical_leave':
        return <Badge className="bg-purple-100 text-purple-800">Congé médical</Badge>;
      default:
        return <Badge variant="secondary">{absenceType}</Badge>;
    }
  };

  // Get absence type icon
  const getAbsenceTypeIcon = (absenceType: string) => {
    switch (absenceType) {
      case 'absent':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'excused':
        return <FileText className="h-5 w-5 text-blue-600" />;
      case 'medical_leave':
        return <FileText className="h-5 w-5 text-purple-600" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-600" />;
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-600" />
            Historique des Absences
          </CardTitle>
          <CardDescription>
            Historique complet des absences avec filtres et statistiques
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement de l'historique des absences">
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
            <BarChart3 className="h-5 w-5 text-emerald-600" />
            Historique des Absences
          </CardTitle>
          <CardDescription>
            Historique complet des absences avec filtres et statistiques
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-emerald-600" />
          Historique des Absences
        </CardTitle>
        <CardDescription>
          Historique complet des absences avec filtres et statistiques
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Statistics */}
          {statistics && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 p-4 bg-gradient-to-r from-emerald-50 to-blue-50 rounded-lg border border-emerald-200" role="region" aria-label="Statistiques des absences">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{statistics.totalAbsences}</div>
                <div className="text-sm text-gray-600 mt-1">Total Absences</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{statistics.unexcusedCount}</div>
                <div className="text-sm text-gray-600 mt-1">Non Excusées</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{statistics.excusedCount}</div>
                <div className="text-sm text-gray-600 mt-1">Excusées</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{statistics.medicalCount}</div>
                <div className="text-sm text-gray-600 mt-1">Congés Médicaux</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">{statistics.absenceRate.toFixed(1)}%</div>
                <div className="text-sm text-gray-600 mt-1">Taux d'Absence</div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="border border-gray-300 rounded-lg p-4 bg-white">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-5 w-5 text-gray-600" />
              <h3 className="text-lg font-semibold text-gray-900">Filtres</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Date Range - Start */}
              <div>
                <label htmlFor="start-date" className="block text-sm font-medium text-gray-700 mb-1">
                  Date de début
                </label>
                <Input
                  id="start-date"
                  type="date"
                  value={filters.startDate || ''}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                  className="w-full"
                  aria-label="Date de début pour filtrer les absences"
                />
              </div>

              {/* Date Range - End */}
              <div>
                <label htmlFor="end-date" className="block text-sm font-medium text-gray-700 mb-1">
                  Date de fin
                </label>
                <Input
                  id="end-date"
                  type="date"
                  value={filters.endDate || ''}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                  className="w-full"
                  aria-label="Date de fin pour filtrer les absences"
                />
              </div>

              {/* Absence Type Filter */}
              <div>
                <label htmlFor="absence-type" className="block text-sm font-medium text-gray-700 mb-1">
                  Type d'absence
                </label>
                <Select
                  value={filters.absenceType || 'all'}
                  onValueChange={(value) => handleFilterChange('absenceType', value === 'all' ? undefined : value as any)}
                >
                  <SelectTrigger id="absence-type" className="w-full" aria-label="Filtrer par type d'absence">
                    <SelectValue placeholder="Tous les types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les types</SelectItem>
                    <SelectItem value="absent">Non excusé</SelectItem>
                    <SelectItem value="excused">Excusé</SelectItem>
                    <SelectItem value="medical_leave">Congé médical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Reset Button */}
              <div className="flex items-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetFilters}
                  className="w-full"
                  aria-label="Réinitialiser les filtres"
                >
                  Réinitialiser
                </Button>
              </div>
            </div>
          </div>

          {/* Absences List */}
          {!absences || absences.length === 0 ? (
            <div className="text-center py-12 border border-gray-300 rounded-lg bg-white">
              <Calendar className="mx-auto h-16 w-16 text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {statistics && statistics.totalAbsences === 0 
                  ? 'Parfait ! Aucune absence' 
                  : 'Aucune absence trouvée'}
              </h3>
              <p className="text-gray-600">
                {statistics && statistics.totalAbsences === 0
                  ? 'Votre enfant a une assiduité parfaite !'
                  : 'Aucune absence ne correspond aux filtres sélectionnés.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {absences.map((absence) => (
                <div
                  key={absence.id}
                  className="border border-gray-300 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Date and Absence Type */}
                      <div className="flex items-center gap-3 mb-2">
                        <Calendar className="h-4 w-4 text-gray-600" />
                        <span className="text-sm font-semibold text-gray-700">
                          {formatDate(absence.date)}
                        </span>
                        {getAbsenceTypeBadge(absence.absenceType)}
                      </div>

                      {/* Course Name */}
                      <div className="flex items-center gap-2 mb-2">
                        {getAbsenceTypeIcon(absence.absenceType)}
                        <h4 className="text-lg font-semibold text-gray-900">
                          {absence.courseName}
                        </h4>
                        {absence.courseCode && (
                          <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">
                            {absence.courseCode}
                          </Badge>
                        )}
                      </div>

                      {/* Excuse Reason */}
                      {absence.excuseReason && (
                        <div className="flex items-start gap-2 text-sm text-gray-700 mt-3">
                          <FileText className="h-4 w-4 text-blue-600 mt-0.5" />
                          <span>
                            <span className="font-medium">Raison :</span> {absence.excuseReason}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

