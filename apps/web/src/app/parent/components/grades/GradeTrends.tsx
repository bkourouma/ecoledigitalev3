'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, Filter, AlertCircle } from 'lucide-react';
import { GradeTrendData } from '@ecoledigitale/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

interface GradeTrendsProps {
  trends: GradeTrendData[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  courses?: Array<{ id: string; name: string }>;
  selectedChildId?: string;
  selectedCourseId?: string;
  selectedPeriod?: 'week' | 'month' | 'semester';
  onChildChange?: (childId: string | undefined) => void;
  onCourseChange?: (courseId: string | undefined) => void;
  onPeriodChange?: (period: 'week' | 'month' | 'semester') => void;
  onDateRangeChange?: (startDate: string | undefined, endDate: string | undefined) => void;
}

export function GradeTrends({
  trends,
  isLoading,
  error,
  children,
  courses,
  selectedChildId,
  selectedCourseId,
  selectedPeriod = 'month',
  onChildChange,
  onCourseChange,
  onPeriodChange,
  onDateRangeChange,
}: GradeTrendsProps) {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Handle child filter change
  const handleChildChange = (value: string) => {
    if (onChildChange) {
      onChildChange(value === 'all' ? undefined : value);
    }
  };

  // Handle course filter change
  const handleCourseChange = (value: string) => {
    if (onCourseChange) {
      onCourseChange(value === 'all' ? undefined : value);
    }
  };

  // Handle period change
  const handlePeriodChange = (value: string) => {
    if (onPeriodChange) {
      onPeriodChange(value as 'week' | 'month' | 'semester');
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

  // Prepare chart data
  const chartData = trends?.map((trend) => ({
    period: trend.periodLabel,
    average: trend.averageGrade,
    count: trend.gradeCount,
  })) || [];

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Card aria-label="Chargement de l'évolution des notes">
        <CardHeader>
          <CardTitle>Évolution des notes</CardTitle>
          <CardDescription>Chargement des tendances...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Filter skeletons */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            </div>
            {/* Chart skeleton */}
            <div className="mt-6">
              <Skeleton className="h-[400px] w-full rounded-lg" />
            </div>
            {/* Summary stats skeletons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-lg border border-border p-4">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-8 w-24" />
                </div>
              ))}
            </div>
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
          <CardTitle>Évolution des notes</CardTitle>
          <CardDescription>Erreur lors du chargement des tendances</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" aria-hidden="true" />
            <p className="mb-2 text-lg font-semibold text-destructive">Erreur lors du chargement des tendances</p>
            <p className="mb-4 text-sm text-muted-foreground">{error.message || 'Une erreur est survenue lors du chargement des tendances.'}</p>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              aria-label="Réessayer de charger les tendances"
            >
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!trends || trends.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Évolution des notes</CardTitle>
          <CardDescription>Aucune donnée disponible</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center text-muted-foreground">
            <TrendingUp className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p>Il n'y a pas assez de données pour afficher les tendances.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Évolution des notes</CardTitle>
        <CardDescription>Visualisation de la progression des notes dans le temps</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Filtres</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                      <SelectItem key={`grade-trends-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Course Filter */}
            {courses && courses.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="course-filter">Cours</Label>
                <Select
                  value={selectedCourseId || 'all'}
                  onValueChange={handleCourseChange}
                >
                  <SelectTrigger id="course-filter">
                    <SelectValue placeholder="Tous les cours" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les cours</SelectItem>
                    {courses.map((course, index) => (
                      <SelectItem key={`grade-trends-course-${index}`} value={course.id}>
                        {course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Period Filter */}
            <div className="space-y-2">
              <Label htmlFor="period-filter">Période</Label>
              <Select
                value={selectedPeriod || 'month'}
                onValueChange={handlePeriodChange}
              >
                <SelectTrigger id="period-filter">
                  <SelectValue placeholder="Mois" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Semaine</SelectItem>
                  <SelectItem value="month">Mois</SelectItem>
                  <SelectItem value="semester">Semestre</SelectItem>
                </SelectContent>
              </Select>
            </div>

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

        {/* Chart */}
        <div className="mt-6 rounded-lg border border-border bg-muted/20 p-2">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
              <XAxis
                dataKey="period"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground) / 0.9)' }}
                stroke="hsl(var(--border))"
              />
              <YAxis
                domain={[0, 20]}
                label={{ value: 'Note (sur 20)', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))' }}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground) / 0.9)' }}
                stroke="hsl(var(--border))"
              />
              <Tooltip
                formatter={(value: number) => [`${value.toFixed(2)} / 20`, 'Moyenne']}
                labelFormatter={(label) => `Période: ${label}`}
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  color: 'hsl(var(--popover-foreground))',
                }}
              />
              <Legend wrapperStyle={{ color: 'hsl(var(--foreground))' }} />
              <Line
                type="monotone"
                dataKey="average"
                stroke="rgb(52 211 153)"
                strokeWidth={2}
                name="Moyenne"
                dot={{ r: 4, fill: 'rgb(52 211 153)' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Stats */}
        {trends.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-border bg-sky-500/10 p-4">
              <div className="mb-1 text-sm text-muted-foreground">Périodes analysées</div>
              <div className="text-2xl font-bold text-sky-400">{trends.length}</div>
            </div>
            <div className="rounded-lg border border-border bg-emerald-500/10 p-4">
              <div className="mb-1 text-sm text-muted-foreground">Moyenne actuelle</div>
              <div className="text-2xl font-bold text-emerald-400">
                {trends[trends.length - 1]?.averageGrade.toFixed(2) || '0.00'} / 20
              </div>
            </div>
            <div className="rounded-lg border border-border bg-violet-500/10 p-4">
              <div className="mb-1 text-sm text-muted-foreground">Total de notes</div>
              <div className="text-2xl font-bold text-violet-400">
                {trends.reduce((sum, trend) => sum + trend.gradeCount, 0)}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

