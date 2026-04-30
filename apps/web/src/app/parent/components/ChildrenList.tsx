'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Users, GraduationCap, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { ChildListItem } from '@ecoledigitale/contracts';

interface ChildrenListProps {
  children: ChildListItem[];
  isLoading?: boolean;
  error?: Error | null;
}

export function ChildrenList({ children, isLoading, error }: ChildrenListProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Chargement de la liste des enfants">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500" aria-hidden="true"></div>
        <span className="sr-only">Chargement en cours...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
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
  if (!children || children.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-12">
            <Users className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun enfant trouvé</h3>
            <p className="text-gray-600">
              Aucun enfant n'est actuellement lié à votre compte.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Actif</Badge>;
      case 'suspended':
        return <Badge className="bg-yellow-100 text-yellow-800">Suspendu</Badge>;
      case 'dropped':
        return <Badge className="bg-red-100 text-red-800">Abandonné</Badge>;
      case 'transfer':
        return <Badge className="bg-blue-100 text-blue-800">Transféré</Badge>;
      case 'graduated':
        return <Badge className="bg-purple-100 text-purple-800">Diplômé</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Get summary indicator
  const getSummaryIndicator = (child: ChildListItem) => {
    const indicators = [];
    
    if (child.summaryIndicator.gradeAverage !== null) {
      indicators.push(
        <div key="grade" className="flex items-center gap-1 text-sm">
          <GraduationCap className="h-4 w-4 text-emerald-600" />
          <span className="font-medium text-emerald-700">{child.summaryIndicator.gradeAverage.toFixed(1)}/20</span>
        </div>
      );
    }
    
    if (child.summaryIndicator.attendanceStatus) {
      const isWarning = child.summaryIndicator.attendanceStatus === 'warning';
      indicators.push(
        <div key="attendance" className="flex items-center gap-1 text-sm">
          {isWarning ? (
            <>
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <span className="text-yellow-700">Attention</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-green-700">Bon</span>
            </>
          )}
        </div>
      );
    }

    return indicators.length > 0 ? (
      <div className="flex items-center gap-3 mt-2">
        {indicators}
      </div>
    ) : null;
  };

  return (
    <div className="space-y-4" role="list" aria-label="Liste des enfants">
      {children.map((child, index) => (
        <Card key={`child-list-${index}`} className="hover:shadow-md transition-shadow" role="listitem">
          <CardHeader>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex-1 w-full sm:w-auto">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <CardTitle className="text-xl">{child.name}</CardTitle>
                  {getStatusBadge(child.status)}
                </div>
                <CardDescription className="flex flex-wrap items-center gap-2 sm:gap-4 mt-1">
                  <span className="flex items-center gap-1">
                    <GraduationCap className="h-4 w-4" aria-hidden="true" />
                    Année {child.currentYear}
                  </span>
                  <span className="text-gray-500">#{child.studentNumber}</span>
                </CardDescription>
                {getSummaryIndicator(child)}
              </div>
              <Link href={`/parent/children/${child.id}`} className="w-full sm:w-auto">
                <Button variant="outline" size="sm" className="w-full sm:w-auto" aria-label={`Voir les détails de ${child.name}`}>
                  Voir détails
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

