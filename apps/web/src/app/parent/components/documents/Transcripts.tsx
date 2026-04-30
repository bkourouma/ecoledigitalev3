'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Filter, AlertCircle, User, Calendar, Download, Eye, RefreshCw, Award } from 'lucide-react';
import { Transcript, TranscriptFilter } from '@ecoledigitale/contracts';
import { useTranscripts } from '@/lib/hooks/use-parent-documents';

interface TranscriptsProps {
  children?: Array<{ id: string; name: string }>;
  academicYears?: Array<{ id: string; name: string }>;
  filters?: TranscriptFilter;
  onFiltersChange?: (filters: TranscriptFilter) => void;
}

export function Transcripts({
  children = [],
  academicYears = [],
  filters = {},
  onFiltersChange,
}: TranscriptsProps) {
  const [localFilters, setLocalFilters] = useState<TranscriptFilter>(filters);

  // Use the hook with current filters
  const { data, isLoading, error, refetch } = useTranscripts(
    localFilters.childId,
    localFilters.academicYearId
  );

  const transcripts = data?.data?.transcripts || [];

  // Handle filter change
  const handleFilterChange = (key: keyof TranscriptFilter, value: string | undefined) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: TranscriptFilter = {};
    setLocalFilters(resetFilters);
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

  // Get GPA badge color
  const getGPABadge = (gpa: number) => {
    if (gpa >= 16) {
      return <Badge className="bg-green-100 text-green-800 border-green-300">Excellent</Badge>;
    } else if (gpa >= 14) {
      return <Badge className="bg-blue-100 text-blue-800 border-blue-300">Très bien</Badge>;
    } else if (gpa >= 12) {
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Bien</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800 border-red-300">Insuffisant</Badge>;
    }
  };

  // Handle download
  const handleDownload = (transcript: Transcript) => {
    if (transcript.downloadable && transcript.transcriptUrl) {
      window.open(transcript.transcriptUrl, '_blank');
    }
  };

  // Handle view
  const handleView = (transcript: Transcript) => {
    if (transcript.viewable && transcript.transcriptUrl) {
      window.open(transcript.transcriptUrl, '_blank');
    }
  };

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Relevés de Notes
          </CardTitle>
          <CardDescription>
            Liste des relevés de notes de vos enfants
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
            Relevés de Notes
          </CardTitle>
          <CardDescription>
            Liste des relevés de notes de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Erreur lors du chargement
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {error instanceof Error ? error.message : 'Une erreur est survenue lors du chargement des relevés de notes.'}
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
  if (transcripts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Relevés de Notes
          </CardTitle>
          <CardDescription>
            Liste des relevés de notes de vos enfants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Filtres</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <SelectItem key={`transcripts-child-${index}`} value={child.id}>
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
            {(localFilters.childId || localFilters.academicYearId) && (
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
              Aucun relevé de notes disponible
            </h3>
            <p className="text-sm text-gray-500">
              Aucun relevé de notes n'a été trouvé pour les critères sélectionnés.
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
          Relevés de Notes
        </CardTitle>
        <CardDescription>
          Liste des relevés de notes de vos enfants
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">Filtres</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <SelectItem key={`transcripts-child-${index}`} value={child.id}>
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
          {(localFilters.childId || localFilters.academicYearId) && (
            <div className="mt-4">
              <Button onClick={handleResetFilters} variant="outline" size="sm">
                Réinitialiser les filtres
              </Button>
            </div>
          )}
        </div>

        {/* Transcripts list */}
        <div className="space-y-4">
          {transcripts.map((transcript) => (
            <Card key={transcript.transcriptId} className="border border-gray-200 hover:border-emerald-300 transition-colors">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <User className="h-4 w-4 text-gray-500" />
                      <h3 className="text-lg font-semibold text-gray-900">
                        {transcript.childName}
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span>{transcript.academicYearName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span>{formatDate(transcript.transcriptDate)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-gray-400" />
                        <span>{transcript.totalCredits} crédits</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">GPA:</span>
                      {getGPABadge(transcript.gpa)}
                      <span className="text-lg font-semibold text-gray-900">
                        {transcript.gpa.toFixed(2)}/20
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {transcript.downloadable && (
                        <Button
                          onClick={() => handleDownload(transcript)}
                          variant="outline"
                          size="sm"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Télécharger
                        </Button>
                      )}
                      {transcript.viewable && (
                        <Button
                          onClick={() => handleView(transcript)}
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

