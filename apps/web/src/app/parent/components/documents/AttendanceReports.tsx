'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Filter, AlertCircle, User, Calendar, Download, Eye, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { AttendanceReport, AttendanceReportFilter } from '@ecoledigitale/contracts';
import { useAttendanceReports } from '@/lib/hooks/use-parent-documents';

interface AttendanceReportsProps {
  children?: Array<{ id: string; name: string }>;
  academicYears?: Array<{ id: string; name: string }>;
  filters?: AttendanceReportFilter;
  onFiltersChange?: (filters: AttendanceReportFilter) => void;
}

export function AttendanceReports({
  children = [],
  academicYears = [],
  filters = {},
  onFiltersChange,
}: AttendanceReportsProps) {
  const [localFilters, setLocalFilters] = useState<AttendanceReportFilter>(filters);
  const [startDate, setStartDate] = useState<string>(filters.startDate || '');
  const [endDate, setEndDate] = useState<string>(filters.endDate || '');

  // Synchronize localFilters with filters prop when it changes
  useEffect(() => {
    setLocalFilters(filters);
    setStartDate(filters.startDate || '');
    setEndDate(filters.endDate || '');
  }, [filters]);

  // Update localFilters when startDate or endDate changes
  useEffect(() => {
    setLocalFilters((prevFilters) => {
      const newFilters = {
        ...prevFilters,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      if (onFiltersChange) {
        onFiltersChange(newFilters);
      }
      return newFilters;
    });
  }, [startDate, endDate, onFiltersChange]);

  // Use the hook with current filters
  const { data, isLoading, error, refetch } = useAttendanceReports(
    localFilters.childId,
    localFilters.academicYearId,
    localFilters.startDate,
    localFilters.endDate
  );

  const attendanceReports = data?.data?.attendanceReports || [];

  // Handle filter change
  const handleFilterChange = (key: keyof AttendanceReportFilter, value: string | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Handle date range change (kept for backward compatibility, but now handled by useEffect)
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

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: AttendanceReportFilter = {};
    setLocalFilters(resetFilters);
    setStartDate('');
    setEndDate('');
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Get attendance rate badge color
  const getAttendanceRateBadge = (rate: number) => {
    if (rate >= 95) {
      return <Badge className="bg-green-100 text-green-800 border-green-300">Excellent</Badge>;
    } else if (rate >= 85) {
      return <Badge className="bg-blue-100 text-blue-800 border-blue-300">Très bon</Badge>;
    } else if (rate >= 75) {
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Bon</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800 border-red-300">À améliorer</Badge>;
    }
  };

  // Handle download
  const handleDownload = async (report: AttendanceReport) => {
    if (report.downloadable && report.reportUrl) {
      try {
        const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
        await downloadFileWithAuth(report.reportUrl, {
          onError: (error) => {
            console.error('Error downloading attendance report:', error);
          },
          onSuccess: () => {
            console.log('Attendance report downloaded successfully');
          },
        });
      } catch (error) {
        console.error('Error downloading attendance report:', error);
        // Fallback to direct open if fetch fails
        window.open(report.reportUrl, '_blank');
      }
    }
  };

  // Handle view
  const handleView = async (report: AttendanceReport) => {
    if (report.viewable && report.reportUrl) {
      try {
        const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
        await downloadFileWithAuth(report.reportUrl, {
          onError: (error) => {
            console.error('Error viewing attendance report:', error);
          },
          onSuccess: () => {
            console.log('Attendance report opened successfully');
          },
        });
      } catch (error) {
        console.error('Error viewing attendance report:', error);
        // Fallback to direct open if fetch fails
        window.open(report.reportUrl, '_blank');
      }
    }
  };

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Rapports de Présence
          </CardTitle>
          <CardDescription>
            Liste des rapports de présence de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
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
            <FileText className="h-5 w-5 text-emerald-600" />
            Rapports de Présence
          </CardTitle>
          <CardDescription>
            Liste des rapports de présence de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Erreur lors du chargement
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {error instanceof Error ? error.message : 'Une erreur est survenue lors du chargement des rapports de présence.'}
            </p>
            <Button onClick={() => refetch()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (attendanceReports.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Rapports de Présence
          </CardTitle>
          <CardDescription>
            Liste des rapports de présence de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Filtres</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Child filter */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Enfant
                </label>
                <Select
                  value={localFilters.childId || 'all'}
                  onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.filter(child => child.id).map((child, index) => (
                      <SelectItem key={`attendance-reports-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Academic year filter */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Année Académique
                </label>
                <Select
                  value={localFilters.academicYearId || 'all'}
                  onValueChange={(value) => handleFilterChange('academicYearId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Toutes les années" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les années</SelectItem>
                    {academicYears.filter(year => year.id).map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date range filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <Label htmlFor="startDate">Date de début</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  onBlur={handleDateRangeChange}
                />
              </div>
              <div>
                <Label htmlFor="endDate">Date de fin</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  onBlur={handleDateRangeChange}
                />
              </div>
            </div>

            {(localFilters.childId || localFilters.academicYearId || localFilters.startDate || localFilters.endDate) && (
              <div className="mt-4">
                <Button onClick={handleResetFilters} variant="outline" size="sm">
                  Réinitialiser les filtres
                </Button>
              </div>
            )}
          </div>

          {/* Empty state */}
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Aucun rapport de présence disponible
            </h3>
            <p className="text-sm text-gray-500">
              Aucun rapport de présence n'a été trouvé pour les critères sélectionnés.
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
          <FileText className="h-5 w-5 text-emerald-600" />
          Rapports de Présence
        </CardTitle>
        <CardDescription>
          Liste des rapports de présence de vos enfants
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">Filtres</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Child filter */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Enfant
              </label>
              <Select
                value={localFilters.childId || 'all'}
                onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les enfants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les enfants</SelectItem>
                  {children.map((child, index) => (
                    <SelectItem key={`attendance-reports-child-${index}`} value={child.id}>
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Academic year filter */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Année Académique
              </label>
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
            </div>
          </div>

          {/* Date range filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <Label htmlFor="startDate">Date de début</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onBlur={handleDateRangeChange}
              />
            </div>
            <div>
              <Label htmlFor="endDate">Date de fin</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onBlur={handleDateRangeChange}
              />
            </div>
          </div>

          {(localFilters.childId || localFilters.academicYearId || localFilters.startDate || localFilters.endDate) && (
            <div className="mt-4">
              <Button onClick={handleResetFilters} variant="outline" size="sm">
                Réinitialiser les filtres
              </Button>
            </div>
          )}
        </div>

        {/* Attendance reports list */}
        <div className="space-y-4">
          {attendanceReports.map((report) => (
            <Card key={report.reportId} className="border border-gray-200 hover:border-emerald-300 transition-colors">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <User className="h-4 w-4 text-gray-500" />
                      <h3 className="text-lg font-semibold text-gray-900">
                        {report.childName}
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm text-gray-600 mb-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span>{report.academicYearName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-gray-400" />
                        <span>{report.reportPeriod || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span>{formatDate(report.reportDate)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="text-gray-700">Présents: <strong>{report.presentDays}</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-gray-700">Absents: <strong>{report.absentDays}</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700">Total: <strong>{report.totalDays}</strong> jours</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">Taux:</span>
                      {getAttendanceRateBadge(report.attendanceRate)}
                      <span className="text-lg font-semibold text-gray-900">
                        {report.attendanceRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {report.downloadable && (
                        <Button
                          onClick={() => handleDownload(report)}
                          variant="outline"
                          size="sm"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Télécharger
                        </Button>
                      )}
                      {report.viewable && (
                        <Button
                          onClick={() => handleView(report)}
                          variant="default"
                          size="sm"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Voir
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

