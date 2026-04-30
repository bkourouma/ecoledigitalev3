'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Users, UserCheck, Shield, AlertTriangle, Info } from 'lucide-react';
import { ParentChildRelationship } from '@ecoledigitale/contracts';
import { useRelationships } from '@/lib/hooks/use-parent-settings';

const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  parent: 'Parent',
  guardian: 'Tuteur',
  emergency_contact: 'Contact d\'urgence',
};

export function RelationshipManagementComponent() {
  const { data, isLoading, error } = useRelationships();

  const relationships = data?.data?.relationships || [];

  // Loading state
  if (isLoading) {
    return (
      <Card role="region" aria-label="Chargement de la gestion des relations">
        <CardHeader>
          <CardTitle>Gestion des relations</CardTitle>
          <CardDescription>Vos relations avec les enfants</CardDescription>
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
      <Card role="alert" aria-live="polite" aria-label="Erreur de chargement de la gestion des relations">
        <CardHeader>
          <CardTitle>Gestion des relations</CardTitle>
          <CardDescription>Vos relations avec les enfants</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" aria-hidden="true" />
            <p className="text-red-600 font-medium">Erreur lors du chargement</p>
            <p className="text-gray-600 text-sm mt-2">{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="mt-4"
              aria-label="Réessayer de charger la gestion des relations"
            >
              Réessayer
            </Button>
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
            <CardTitle>Gestion des relations</CardTitle>
            <CardDescription>Vos relations avec les enfants</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Info message about view-only */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-blue-900 font-medium">Information</p>
            <p className="text-sm text-blue-700 mt-1">
              Les modifications des relations nécessitent l'approbation de l'administration. 
              Contactez l'école pour toute modification.
            </p>
          </div>
        </div>

        {/* Relationships List */}
        {relationships.length === 0 ? (
          <div className="text-center py-12">
            <Users className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucune relation</h3>
            <p className="text-gray-600 text-sm">
              Vous n'avez pas encore de relations liées à votre compte.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {relationships.map((relationship: ParentChildRelationship) => (
              <div
                key={relationship.id}
                className="p-4 border rounded-lg bg-white hover:shadow-md transition-shadow"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <Users className="h-5 w-5 text-gray-400" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {relationship.childName}
                    </h3>
                    <Badge variant="outline" className="ml-2">
                      {RELATIONSHIP_TYPE_LABELS[relationship.relationshipType] || relationship.relationshipType}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    {/* Primary Contact */}
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-gray-400" />
                      <span className="text-sm text-gray-600">
                        Contact principal:{' '}
                        <span className="font-medium">
                          {relationship.isPrimaryContact ? 'Oui' : 'Non'}
                        </span>
                      </span>
                    </div>

                    {/* Emergency Contact */}
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-gray-400" />
                      <span className="text-sm text-gray-600">
                        Contact d'urgence:{' '}
                        <span className="font-medium">
                          {relationship.emergencyContact ? 'Oui' : 'Non'}
                        </span>
                      </span>
                    </div>

                    {/* Pickup Authorization */}
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-gray-400" />
                      <span className="text-sm text-gray-600">
                        Autorisation de récupération:{' '}
                        <span className="font-medium">
                          {relationship.canPickup ? 'Oui' : 'Non'}
                        </span>
                      </span>
                    </div>

                    {/* Created Date */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">
                        Créé le:{' '}
                        <span className="font-medium">
                          {new Date(relationship.createdAt).toLocaleDateString('fr-FR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Notes */}
                  {relationship.notes && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Notes:</span> {relationship.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

