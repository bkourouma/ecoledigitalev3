'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Users, UserCheck, Shield, AlertTriangle, Info, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { DataAccess } from '@ecoledigitale/contracts';
import { useDataAccess } from '@/lib/hooks/use-parent-emergency';

const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  parent: 'Parent',
  guardian: 'Tuteur',
  emergency_contact: 'Contact d\'urgence',
};

const ACCESS_LEVEL_LABELS: Record<string, string> = {
  full: 'Accès complet',
  limited: 'Accès limité',
  'view-only': 'Lecture seule',
};

const ACCESS_LEVEL_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  full: 'default',
  limited: 'secondary',
  'view-only': 'outline',
};

const DATA_TYPE_LABELS: Record<string, string> = {
  grades: 'Notes',
  attendance: 'Présence',
  payments: 'Paiements',
  homework: 'Devoirs',
  messages: 'Messages',
  academic: 'Académique',
  documents: 'Documents',
};

export function DataAccessComponent() {
  const { data, isLoading, error } = useDataAccess();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dataAccess = data?.data?.dataAccess || [];

  const toggleExpanded = useCallback((relationshipId: string) => {
    setExpandedId(prev => prev === relationshipId ? null : relationshipId);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accès aux données</CardTitle>
          <CardDescription>Consultez les informations d'accès aux données pour vos enfants</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card role="alert" aria-live="polite">
        <CardHeader>
          <CardTitle>Accès aux données</CardTitle>
          <CardDescription>Consultez les informations d'accès aux données pour vos enfants</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" aria-hidden="true" />
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Accès aux données</CardTitle>
            <CardDescription>Consultez les informations d'accès aux données pour vos enfants</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Info message about data access changes */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-blue-900 font-medium">Information</p>
            <p className="text-sm text-blue-700 mt-1">
              Les modifications de l'accès aux données nécessitent des changements dans le type de relation ou les autorisations.
              Contactez l'administration pour toute modification.
            </p>
          </div>
        </div>

        {/* Data Access List */}
        {dataAccess.length === 0 ? (
          <div className="text-center py-12">
            <Users className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucune relation</h3>
            <p className="text-gray-600 text-sm">
              Vous n'avez pas encore de relations liées à votre compte.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {dataAccess.map((item) => {
              const isExpanded = expandedId === item.relationshipId;

              return (
                <div
                  key={item.relationshipId}
                  className="p-4 border rounded-lg bg-white"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <UserCheck className="h-5 w-5 text-gray-400" />
                        <h3 className="text-lg font-semibold text-gray-900">{item.childName}</h3>
                        <Badge variant="outline">
                          {RELATIONSHIP_TYPE_LABELS[item.relationshipType] || item.relationshipType}
                        </Badge>
                        <Badge variant={ACCESS_LEVEL_VARIANTS[item.accessLevel] || 'outline'}>
                          {ACCESS_LEVEL_LABELS[item.accessLevel] || item.accessLevel}
                        </Badge>
                      </div>
                      <div className="mt-4 flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-600">
                            {item.accessibleDataTypes.length} type{item.accessibleDataTypes.length > 1 ? 's' : ''} de données accessible{item.accessibleDataTypes.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        {item.canPickup && (
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-green-600" />
                            <span className="text-sm text-green-600">Autorisé à récupérer</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleExpanded(item.relationshipId)}
                        className="flex items-center gap-2"
                        aria-label={`${isExpanded ? 'Masquer' : 'Afficher'} les détails d'accès aux données pour ${item.childName}`}
                        aria-expanded={isExpanded}
                      >
                        <Eye className="h-4 w-4" />
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-4 w-4" />
                            Masquer
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4" />
                            Détails
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-2">Types de données accessibles</h4>
                          <div className="flex flex-wrap gap-2">
                            {item.accessibleDataTypes.length > 0 ? (
                              item.accessibleDataTypes.map((dataType) => (
                                <Badge key={dataType} variant="outline">
                                  {DATA_TYPE_LABELS[dataType] || dataType}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-sm text-gray-500">Aucun type de données accessible</span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-1">Niveau d'accès</h4>
                            <p className="text-sm text-gray-600">
                              {ACCESS_LEVEL_LABELS[item.accessLevel] || item.accessLevel}
                            </p>
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-1">Type de relation</h4>
                            <p className="text-sm text-gray-600">
                              {RELATIONSHIP_TYPE_LABELS[item.relationshipType] || item.relationshipType}
                            </p>
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-1">Autorisation de récupération</h4>
                            <p className="text-sm text-gray-600">
                              {item.canPickup ? 'Oui' : 'Non'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

