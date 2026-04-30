'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Award, TrendingUp, TrendingDown, BarChart3, Filter, AlertCircle } from 'lucide-react';
import { OverallGradeStatistics } from '@ecoledigitale/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

interface OverallAveragesProps {
  statistics: OverallGradeStatistics | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  onChildChange?: (childId: string | undefined) => void;
  onDateRangeChange?: (startDate: string | undefined, endDate: string | undefined) => void;
}

export function OverallAverages({
  statistics,
  isLoading,
  error,
  children,
  selectedChildId,
  onChildChange,
  onDateRangeChange,
}: OverallAveragesProps) {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Handle child filter change
  const handleChildChange = (value: string) => {
    if (onChildChange) {
      onChildChange(value === 'all' ? undefined : value);
    }
  };

  // Handle date range change
  const handleDateRangeChange = () => {
    if (onDateRangeChange) {
      onDateRangeChange(
        startDate ? new Date(startDate).toISOString() : undefined,
        endDate ? new Date(endDate).toISOString() : undefined
      );
    }
  };

  // Get grade badge color
  const getGradeBadge = (average: number) => {
    const percentage = (average / 20) * 100;
    if (percentage >= 90) {
      return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">Excellent</Badge>;
    } else if (percentage >= 80) {
      return <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200">Très bien</Badge>;
    } else if (percentage >= 70) {
      return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200">Bien</Badge>;
    } else if (percentage >= 60) {
      return <Badge variant="outline" className="border-orange-500/40 bg-orange-500/15 text-orange-200">Assez bien</Badge>;
    } else {
      return <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-red-200">Insuffisant</Badge>;
    }
  };

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card aria-label="Chargement des moyennes générales">
        <CardHeader>
          <CardTitle>Moyennes générales</CardTitle>
          <CardDescription>Chargement des statistiques...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Filter skeletons */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            </div>
            {/* Statistics skeletons */}
            <Card className="border-l-4 border-l-sky-500/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-6 w-24" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-12 w-32" />
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-32" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-10 w-24" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-border p-3">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state with retry option
  if (error) {
    return (
      <Card role="alert" aria-live="polite">
        <CardHeader>
          <CardTitle>Moyennes générales</CardTitle>
          <CardDescription>Erreur lors du chargement des statistiques</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" aria-hidden="true" />
            <p className="mb-2 text-lg font-semibold text-destructive">Erreur lors du chargement des statistiques</p>
            <p className="mb-4 text-sm text-muted-foreground">{error.message || 'Une erreur est survenue lors du chargement des statistiques.'}</p>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              aria-label="Réessayer de charger les statistiques"
            >
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!statistics || statistics.totalGraded === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Moyennes générales</CardTitle>
          <CardDescription>Aucune statistique disponible</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center text-muted-foreground">
            <Award className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p>Aucune note n'est disponible pour calculer les statistiques.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Moyennes générales</CardTitle>
        <CardDescription>Statistiques globales des notes</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Filtres</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Child Filter */}
            {children && children.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="child-filter">Enfant</Label>
                <Select
                  value={selectedChildId || 'all'}
                  onValueChange={handleChildChange}
                >
                  <SelectTrigger id="child-filter">
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.map((child, index) => (
                      <SelectItem key={`overall-averages-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Start Date Filter */}
            <div className="space-y-2">
              <Label htmlFor="start-date">Date de début</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value && endDate) {
                    onDateRangeChange?.(
                      new Date(e.target.value).toISOString(),
                      new Date(endDate).toISOString()
                    );
                  }
                }}
              />
            </div>

            {/* End Date Filter */}
            <div className="space-y-2">
              <Label htmlFor="end-date">Date de fin</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  if (startDate && e.target.value) {
                    onDateRangeChange?.(
                      new Date(startDate).toISOString(),
                      new Date(e.target.value).toISOString()
                    );
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Statistics Display */}
        <div className="space-y-6">
          {/* Overall Average Card */}
          <Card className="border-l-4 border-l-sky-500/70">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-sky-400" />
                  <CardTitle className="text-xl">Moyenne générale</CardTitle>
                </div>
                {getGradeBadge(statistics.overallAverage)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-foreground">{statistics.overallAverage.toFixed(2)}</span>
                <span className="text-2xl text-muted-foreground">/ 20</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Basé sur {statistics.totalGraded} {statistics.totalGraded === 1 ? 'note' : 'notes'}
              </p>
            </CardContent>
          </Card>

          {/* Best and Worst Scores */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-emerald-500/70">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                  <CardTitle className="text-lg">Meilleure note</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-emerald-400">{statistics.bestScore.toFixed(2)}</span>
                  <span className="text-xl text-muted-foreground">/ 20</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-red-500/70">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-red-400" />
                  <CardTitle className="text-lg">Note la plus basse</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-red-400">{statistics.worstScore.toFixed(2)}</span>
                  <span className="text-xl text-muted-foreground">/ 20</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Grade Distribution */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Répartition des notes</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Excellent (>= 16) */}
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">Excellent</Badge>
                    <span className="text-sm text-muted-foreground">≥ 16</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-emerald-400">{statistics.gradeDistribution.excellent}</span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      ({statistics.totalGraded > 0 ? Math.round((statistics.gradeDistribution.excellent / statistics.totalGraded) * 100) : 0}%)
                    </span>
                  </div>
                </div>

                {/* Good (14-15) */}
                <div className="flex items-center justify-between rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200">Très bien</Badge>
                    <span className="text-sm text-muted-foreground">14-15</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-sky-400">{statistics.gradeDistribution.good}</span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      ({statistics.totalGraded > 0 ? Math.round((statistics.gradeDistribution.good / statistics.totalGraded) * 100) : 0}%)
                    </span>
                  </div>
                </div>

                {/* Average (12-13) */}
                <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-200">Bien</Badge>
                    <span className="text-sm text-muted-foreground">12-13</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-amber-400">{statistics.gradeDistribution.average}</span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      ({statistics.totalGraded > 0 ? Math.round((statistics.gradeDistribution.average / statistics.totalGraded) * 100) : 0}%)
                    </span>
                  </div>
                </div>

                {/* Below Average (< 12) */}
                <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-red-200">Insuffisant</Badge>
                    <span className="text-sm text-muted-foreground">&lt; 12</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-red-400">{statistics.gradeDistribution.belowAverage}</span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      ({statistics.totalGraded > 0 ? Math.round((statistics.gradeDistribution.belowAverage / statistics.totalGraded) * 100) : 0}%)
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}

