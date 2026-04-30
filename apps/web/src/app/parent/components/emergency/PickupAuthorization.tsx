'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Users, UserCheck, Shield, AlertTriangle, Info, CheckCircle, XCircle, Edit } from 'lucide-react';
import { PickupAuthorization, PickupAuthorizationUpdate } from '@ecoledigitale/contracts';
import {
  usePickupAuthorization,
  useUpdatePickupAuthorization,
} from '@/lib/hooks/use-parent-emergency';

const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  parent: 'Parent',
  guardian: 'Tuteur',
  emergency_contact: 'Contact d\'urgence',
};

export function PickupAuthorizationComponent() {
  const { data, isLoading, error } = usePickupAuthorization();

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmingDisableId, setConfirmingDisableId] = useState<string | null>(null);
  const [newCanPickupValue, setNewCanPickupValue] = useState<boolean | null>(null);

  const relationships = data?.data?.relationships || [];
  // Create update hook only when updating
  const updateHook = updatingId ? useUpdatePickupAuthorization(updatingId) : null;

  const handleToggle = useCallback((relationship: PickupAuthorization) => {
    if (!relationship.canPickup) {
      // Enabling pickup authorization - no confirmation needed
      setNewCanPickupValue(true);
      setUpdatingId(relationship.id);
    } else {
      // Disabling pickup authorization - requires confirmation
      setConfirmingDisableId(relationship.id);
    }
  }, []);

  const handleConfirmDisable = async (relationshipId: string) => {
    setNewCanPickupValue(false);
    setUpdatingId(relationshipId);
    setConfirmingDisableId(null);
  };

  const handleCancelDisable = () => {
    setConfirmingDisableId(null);
  };

  // Handle update when updateHook is ready
  React.useEffect(() => {
    if (updatingId && updateHook && newCanPickupValue !== null && !updateHook.isPending && !updateHook.isSuccess && !updateHook.isError) {
      updateHook.mutate({ canPickup: newCanPickupValue });
    }
  }, [updatingId, updateHook, newCanPickupValue]);

  // Reset updating state when update completes
  React.useEffect(() => {
    if (updateHook && (updateHook.isSuccess || updateHook.isError)) {
      if (updateHook.isSuccess) {
        setUpdatingId(null);
        setNewCanPickupValue(null);
      }
    }
  }, [updateHook?.isSuccess, updateHook?.isError]);

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Autorisation de récupération</CardTitle>
          <CardDescription>Gérez les autorisations de récupération pour vos enfants</CardDescription>
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
          <CardTitle>Autorisation de récupération</CardTitle>
          <CardDescription>Gérez les autorisations de récupération pour vos enfants</CardDescription>
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
            <CardTitle>Autorisation de récupération</CardTitle>
            <CardDescription>Gérez les autorisations de récupération pour vos enfants</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
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
            {relationships.map((relationship) => {
              const isUpdating = updatingId === relationship.id && updateHook?.isPending;
              const isConfirming = confirmingDisableId === relationship.id;

              return (
                <div
                  key={relationship.id}
                  className="p-4 border rounded-lg bg-white"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <UserCheck className="h-5 w-5 text-gray-400" />
                        <h3 className="text-lg font-semibold text-gray-900">{relationship.childName}</h3>
                        <Badge variant="outline">
                          {RELATIONSHIP_TYPE_LABELS[relationship.relationshipType] || relationship.relationshipType}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-4">
                        {relationship.canPickup ? (
                          <>
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm text-green-600 font-medium">Autorisé à récupérer</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-600">Non autorisé à récupérer</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isConfirming && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggle(relationship)}
                          disabled={isUpdating}
                          className="flex items-center gap-2"
                          aria-label={`${relationship.canPickup ? 'Désactiver' : 'Activer'} l'autorisation de récupération pour ${relationship.childName}`}
                        >
                          {isUpdating ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                              Mise à jour...
                            </>
                          ) : relationship.canPickup ? (
                            <>
                              <XCircle className="h-4 w-4" />
                              Désactiver
                            </>
                          ) : (
                            <>
                              <CheckCircle className="h-4 w-4" />
                              Activer
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Confirmation Dialog for Disabling */}
                  {isConfirming && (
                    <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm text-yellow-900 font-medium mb-1">
                            Confirmer la désactivation
                          </p>
                          <p className="text-sm text-yellow-700 mb-3">
                            Êtes-vous sûr de vouloir désactiver l'autorisation de récupération pour {relationship.childName} ?
                            Cette action peut affecter la capacité de récupération de l'enfant.
                          </p>
                          <div className="flex items-center gap-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCancelDisable}
                              disabled={isUpdating}
                            >
                              Annuler
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleConfirmDisable(relationship.id)}
                              disabled={isUpdating}
                            >
                              Confirmer
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error Display */}
                  {updatingId === relationship.id && updateHook?.isError && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm text-red-900 font-medium">Erreur</p>
                        <p className="text-sm text-red-700 mt-1">
                          {updateHook.error?.message || 'Une erreur est survenue lors de la mise à jour'}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setUpdatingId(null);
                            setNewCanPickupValue(null);
                          }}
                          className="mt-2"
                        >
                          Fermer
                        </Button>
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


