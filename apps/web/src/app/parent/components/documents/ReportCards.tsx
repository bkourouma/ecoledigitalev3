'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Filter, AlertCircle, User, Calendar, Download, Eye, RefreshCw } from 'lucide-react';
import { ReportCard, ReportCardFilter } from '@ecoledigitale/contracts';
import { useReportCards } from '@/lib/hooks/use-parent-documents';

interface ReportCardsProps {
  children?: Array<{ id: string; name: string }>;
  academicYears?: Array<{ id: string; name: string }>;
  filters?: ReportCardFilter;
  onFiltersChange?: (filters: ReportCardFilter) => void;
}

export function ReportCards({
  children = [],
  academicYears = [],
  filters = {},
  onFiltersChange,
}: ReportCardsProps) {
  const [localFilters, setLocalFilters] = useState<ReportCardFilter>(filters);

  // Use the hook with current filters
  const { data, isLoading, error, refetch } = useReportCards(
    localFilters.childId,
    localFilters.academicYearId,
    localFilters.semester
  );

  const reportCards = data?.data?.reportCards || [];

  // Handle filter change (memoized)
  const handleFilterChange = useCallback((key: keyof ReportCardFilter, value: string | number | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  }, [localFilters, onFiltersChange]);

  // Reset filters (memoized)
  const handleResetFilters = useCallback(() => {
    const resetFilters: ReportCardFilter = {};
    setLocalFilters(resetFilters);
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  }, [onFiltersChange]);

  // Format date (memoized)
  const formatDate = useCallback((dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, []);

  // Get grade badge color (memoized)
  const getGradeBadge = useCallback((grade: number) => {
    if (grade >= 16) {
      return (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200" aria-label={`Note: ${grade}/20 - Excellent`}>
          Excellent
        </Badge>
      );
    } else if (grade >= 14) {
      return (
        <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200" aria-label={`Note: ${grade}/20 - Très bien`}>
          Très bien
        </Badge>
      );
    } else if (grade >= 12) {
      return (
        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200" aria-label={`Note: ${grade}/20 - Bien`}>
          Bien
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-red-200" aria-label={`Note: ${grade}/20 - Insuffisant`}>
          Insuffisant
        </Badge>
      );
    }
  }, []);

  // Handle download (memoized)
  const handleDownload = useCallback(async (reportCard: ReportCard) => {
    if (reportCard.downloadable && reportCard.reportUrl) {
      try {
        const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
        await downloadFileWithAuth(reportCard.reportUrl, {
          onError: (error) => {
            console.error('Error downloading report card:', error);
            // You can add toast notification here if needed
          },
          onSuccess: () => {
            console.log('Report card downloaded successfully');
          },
        });
      } catch (error) {
        console.error('Error downloading report card:', error);
        // Fallback to direct open if fetch fails
        window.open(reportCard.reportUrl, '_blank', 'noopener,noreferrer');
      }
    }
  }, []);

  // Handle view (memoized)
  const handleView = useCallback(async (reportCard: ReportCard) => {
    if (reportCard.viewable && reportCard.reportUrl) {
      try {
        const { downloadFileWithAuth } = await import('@/lib/file-download-utils');
        await downloadFileWithAuth(reportCard.reportUrl, {
          onError: (error) => {
            console.error('Error viewing report card:', error);
            // You can add toast notification here if needed
          },
          onSuccess: () => {
            console.log('Report card opened successfully');
          },
        });
      } catch (error) {
        console.error('Error viewing report card:', error);
        // Fallback to direct open if fetch fails
        window.open(reportCard.reportUrl, '_blank', 'noopener,noreferrer');
      }
    }
  }, []);

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-400" />
            Bulletins Scolaires
          </CardTitle>
          <CardDescription>
            Liste des bulletins scolaires de vos enfants
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
            <FileText className="h-5 w-5 text-emerald-400" />
            Bulletins Scolaires
          </CardTitle>
          <CardDescription>
            Liste des bulletins scolaires de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="mb-4 h-12 w-12 text-destructive" />
            <h3 className="mb-2 text-lg font-semibold text-destructive">Erreur lors du chargement</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Une erreur est survenue lors du chargement des bulletins.'}
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
  if (reportCards.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-400" />
            Bulletins Scolaires
          </CardTitle>
          <CardDescription>
            Liste des bulletins scolaires de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 rounded-lg border border-border bg-muted/40 p-4">
            <div className="mb-4 flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Filtres</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Child filter */}
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
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
                      <SelectItem key={`report-cards-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Academic year filter */}
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
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

              {/* Semester filter */}
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Semestre
                </label>
                <Select
                  value={localFilters.semester?.toString() || 'all'}
                  onValueChange={(value) => handleFilterChange('semester', value === 'all' ? undefined : parseInt(value))}
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
              </div>
            </div>
            {(localFilters.childId || localFilters.academicYearId || localFilters.semester) && (
              <div className="mt-4">
                <Button onClick={handleResetFilters} variant="outline" size="sm">
                  Réinitialiser les filtres
                </Button>
              </div>
            )}
          </div>

          {/* Empty state */}
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="mb-2 text-lg font-semibold text-foreground">Aucun bulletin disponible</h3>
            <p className="text-sm text-muted-foreground">
              Aucun bulletin scolaire n'a été trouvé pour les critères sélectionnés.
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
          <FileText className="h-5 w-5 text-emerald-400" />
          Bulletins Scolaires
        </CardTitle>
        <CardDescription>
          Liste des bulletins scolaires de vos enfants
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 rounded-lg border border-border bg-muted/40 p-4">
          <div className="mb-4 flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Filtres</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Child filter */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
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
                    <SelectItem key={`report-cards-child-${index}`} value={child.id}>
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Academic year filter */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
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

            {/* Semester filter */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Semestre
              </label>
              <Select
                value={localFilters.semester?.toString() || 'all'}
                onValueChange={(value) => handleFilterChange('semester', value === 'all' ? undefined : parseInt(value))}
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
            </div>
          </div>
          {(localFilters.childId || localFilters.academicYearId || localFilters.semester) && (
            <div className="mt-4">
              <Button onClick={handleResetFilters} variant="outline" size="sm">
                Réinitialiser les filtres
              </Button>
            </div>
          )}
        </div>

        {/* Report cards list */}
        <div className="space-y-4">
          {reportCards.map((reportCard) => (
            <Card key={reportCard.reportCardId} className="border border-border transition-colors hover:border-emerald-500/40">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-lg font-semibold text-foreground">{reportCard.childName}</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground md:grid-cols-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        <span>{reportCard.academicYearName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        <span>Semestre {reportCard.semester}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        <span>{formatDate(reportCard.reportDate)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-3 md:flex-row md:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">Moyenne:</span>
                      {getGradeBadge(reportCard.overallGrade)}
                      <span className="text-lg font-semibold text-foreground">
                        {reportCard.overallGrade.toFixed(2)}/20
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {reportCard.downloadable && (
                        <Button
                          onClick={() => handleDownload(reportCard)}
                          variant="outline"
                          size="sm"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Télécharger
                        </Button>
                      )}
                      {reportCard.viewable && (
                        <Button
                          onClick={() => handleView(reportCard)}
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

