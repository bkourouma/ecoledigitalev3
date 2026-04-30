'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, Award, FileText, TrendingUp, AlertCircle, BarChart3 } from 'lucide-react';
import { GradesSummary } from '@ecoledigitale/contracts';

interface ChildGradesSummaryProps {
  gradesSummary: GradesSummary | null;
  isLoading?: boolean;
  error?: Error | null;
}

export function ChildGradesSummary({ gradesSummary, isLoading, error }: ChildGradesSummaryProps) {
  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Résumé des Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement du résumé des notes">
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
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Résumé des Notes
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

  // Empty state
  if (!gradesSummary || gradesSummary.gradedAssignments === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Résumé des Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <FileText className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucune note disponible</h3>
            <p className="text-gray-600">
              Aucune note n'a encore été attribuée à cet enfant.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { averageGrade, totalAssignments, gradedAssignments, bestScore, gradeDistribution } = gradesSummary;

  // Calculate percentage for each grade category
  const totalGraded = gradedAssignments;
  const excellentPercent = totalGraded > 0 ? (gradeDistribution.excellent / totalGraded) * 100 : 0;
  const goodPercent = totalGraded > 0 ? (gradeDistribution.good / totalGraded) * 100 : 0;
  const averagePercent = totalGraded > 0 ? (gradeDistribution.average / totalGraded) * 100 : 0;
  const belowAveragePercent = totalGraded > 0 ? (gradeDistribution.belowAverage / totalGraded) * 100 : 0;

  // Get grade color based on average
  const getAverageColor = (avg: number) => {
    if (avg >= 16) return 'text-green-600';
    if (avg >= 14) return 'text-blue-600';
    if (avg >= 12) return 'text-orange-600';
    return 'text-red-600';
  };

  const getAverageBgColor = (avg: number) => {
    if (avg >= 16) return 'bg-green-100';
    if (avg >= 14) return 'bg-blue-100';
    if (avg >= 12) return 'bg-orange-100';
    return 'bg-red-100';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-emerald-600" />
          Résumé des Notes
        </CardTitle>
        <CardDescription>
          Statistiques académiques globales (toutes les années)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" role="region" aria-label="Métriques clés des notes">
          {/* Average Grade */}
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-4 border border-emerald-200">
            <div className="flex items-center justify-between mb-2">
              <div className="bg-emerald-200 p-2 rounded-lg">
                <TrendingUp className="h-5 w-5 text-emerald-700" />
              </div>
            </div>
            <p className="text-sm font-medium text-gray-600 mb-1">Moyenne Générale</p>
            <p className={`text-2xl font-bold ${getAverageColor(averageGrade)}`}>
              {averageGrade.toFixed(2)}/20
            </p>
          </div>

          {/* Total Assignments */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <div className="bg-blue-200 p-2 rounded-lg">
                <FileText className="h-5 w-5 text-blue-700" />
              </div>
            </div>
            <p className="text-sm font-medium text-gray-600 mb-1">Total Devoirs</p>
            <p className="text-2xl font-bold text-blue-600">{totalAssignments}</p>
          </div>

          {/* Graded Assignments */}
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
            <div className="flex items-center justify-between mb-2">
              <div className="bg-purple-200 p-2 rounded-lg">
                <GraduationCap className="h-5 w-5 text-purple-700" />
              </div>
            </div>
            <p className="text-sm font-medium text-gray-600 mb-1">Devoirs Notés</p>
            <p className="text-2xl font-bold text-purple-600">{gradedAssignments}</p>
          </div>

          {/* Best Score */}
          <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-4 border border-amber-200">
            <div className="flex items-center justify-between mb-2">
              <div className="bg-amber-200 p-2 rounded-lg">
                <Award className="h-5 w-5 text-amber-700" />
              </div>
            </div>
            <p className="text-sm font-medium text-gray-600 mb-1">Meilleure Note</p>
            <p className="text-2xl font-bold text-amber-600">{bestScore.toFixed(2)}/20</p>
          </div>
        </div>

        {/* Grade Distribution */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-5 w-5 text-emerald-600" />
            <h3 className="text-lg font-semibold text-white">Distribution des Notes</h3>
          </div>

          <div className="space-y-3">
            {/* Excellent (>= 16) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-sm font-medium text-muted-foreground">Excellent (≥ 16)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">{gradeDistribution.excellent}</span>
                  <Badge className="bg-green-100 text-green-800">
                    {excellentPercent.toFixed(1)}%
                  </Badge>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-green-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${excellentPercent}%` }}
                ></div>
              </div>
            </div>

            {/* Good (14-15) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span className="text-sm font-medium text-muted-foreground">Bien (14-15)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">{gradeDistribution.good}</span>
                  <Badge className="bg-blue-100 text-blue-800">
                    {goodPercent.toFixed(1)}%
                  </Badge>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${goodPercent}%` }}
                ></div>
              </div>
            </div>

            {/* Average (12-13) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                  <span className="text-sm font-medium text-muted-foreground">Moyen (12-13)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">{gradeDistribution.average}</span>
                  <Badge className="bg-orange-100 text-orange-800">
                    {averagePercent.toFixed(1)}%
                  </Badge>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-orange-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${averagePercent}%` }}
                ></div>
              </div>
            </div>

            {/* Below Average (< 12) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span className="text-sm font-medium text-muted-foreground">En dessous de la moyenne (&lt; 12)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">{gradeDistribution.belowAverage}</span>
                  <Badge className="bg-red-100 text-red-800">
                    {belowAveragePercent.toFixed(1)}%
                  </Badge>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-red-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${belowAveragePercent}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

