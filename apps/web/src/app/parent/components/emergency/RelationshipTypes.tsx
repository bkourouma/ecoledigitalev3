'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Users, UserCheck, Shield, AlertTriangle, Info, Edit, Save, X, CheckCircle } from 'lucide-react';
import { RelationshipType, RelationshipTypeUpdate } from '@ecoledigitale/contracts';
import {
  useRelationshipTypes,
  useUpdateRelationshipType,
} from '@/lib/hooks/use-parent-emergency';

const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  parent: 'Parent',
  guardian: 'Tuteur',
  emergency_contact: 'Contact d\'urgence',
};

const RELATIONSHIP_TYPE_OPTIONS = [
  { value: 'parent', label: 'Parent' },
  { value: 'guardian', label: 'Tuteur' },
  { value: 'emergency_contact', label: 'Contact d\'urgence' },
];

export function RelationshipTypesComponent() {
  const { data, isLoading, error } = useRelationshipTypes();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('');
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const relationships = data?.data?.relationships || [];
  // Create update hook only when editing
  const updateHook = editingId ? useUpdateRelationshipType(editingId) : null;

  const handleEdit = (relationship: RelationshipType) => {
    setEditingId(relationship.id);
    setSelectedType(relationship.relationshipType);
    setUpdateMessage(null);
  };

  const handleCancel = () => {
    setEditingId(null);
    setSelectedType('');
    setUpdateMessage(null);
  };

  const handleSave = async () => {
    if (!editingId || !updateHook || !selectedType) return;

    try {
      const result = await updateHook.mutateAsync({
        relationshipType: selectedType as 'parent' | 'guardian' | 'emergency_contact',
      });
      
      if (result.data?.message) {
        setUpdateMessage(result.data.message);
      }
      
      // Clear editing state after a short delay to show the message
      setTimeout(() => {
        setEditingId(null);
        setSelectedType('');
        setUpdateMessage(null);
      }, 2000);
    } catch (error: any) {
      console.error('Error updating relationship type:', error);
      setUpdateMessage(error.message || 'Une erreur est survenue lors de la mise à jour');
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Types de relation</CardTitle>
          <CardDescription>Gérez les types de relation pour vos enfants</CardDescription>
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
          <CardTitle>Types de relation</CardTitle>
          <CardDescription>Gérez les types de relation pour vos enfants</CardDescription>
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
            <CardTitle>Types de relation</CardTitle>
            <CardDescription>Gérez les types de relation pour vos enfants</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Info message about administrative approval */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-blue-900 font-medium">Information</p>
            <p className="text-sm text-blue-700 mt-1">
              Les modifications des types de relation peuvent nécessiter l'approbation de l'administration.
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
            {relationships.map((relationship) => {
              const isEditing = editingId === relationship.id;
              const isUpdating = isEditing && updateHook?.isPending;

              return (
                <div
                  key={relationship.id}
                  className="p-4 border rounded-lg bg-white"
                >
                  {isEditing ? (
                    // Edit mode
                    <div className="space-y-4">
                      {updateMessage && (
                        <div className={`p-4 rounded-lg flex items-start gap-3 ${
                          updateHook?.isError 
                            ? 'bg-red-50 border border-red-200' 
                            : 'bg-green-50 border border-green-200'
                        }`}>
                          {updateHook?.isError ? (
                            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                          ) : (
                            <Info className="h-5 w-5 text-green-600 mt-0.5" />
                          )}
                          <div className="flex-1">
                            <p className={`text-sm font-medium ${
                              updateHook?.isError ? 'text-red-900' : 'text-green-900'
                            }`}>
                              {updateHook?.isError ? 'Erreur' : 'Information'}
                            </p>
                            <p className={`text-sm mt-1 ${
                              updateHook?.isError ? 'text-red-700' : 'text-green-700'
                            }`}>
                              {updateMessage}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-3 mb-2">
                        <UserCheck className="h-5 w-5 text-gray-400" />
                        <h3 className="text-lg font-semibold text-gray-900">{relationship.childName}</h3>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-gray-700 mb-2 block">
                            Type de relation
                          </label>
                          <Select
                            value={selectedType}
                            onValueChange={setSelectedType}
                            disabled={isUpdating}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Sélectionner un type de relation" />
                            </SelectTrigger>
                            <SelectContent>
                              {RELATIONSHIP_TYPE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-4 border-t">
                          <Button
                            variant="outline"
                            onClick={handleCancel}
                            disabled={isUpdating}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Annuler
                          </Button>
                          <Button
                            onClick={handleSave}
                            disabled={isUpdating || !selectedType || selectedType === relationship.relationshipType}
                            className="flex items-center gap-2"
                          >
                            {isUpdating ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Enregistrement...
                              </>
                            ) : (
                              <>
                                <Save className="h-4 w-4" />
                                Enregistrer
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Display mode
                    <>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <UserCheck className="h-5 w-5 text-gray-400" />
                            <h3 className="text-lg font-semibold text-gray-900">{relationship.childName}</h3>
                            <Badge variant="outline">
                              {RELATIONSHIP_TYPE_LABELS[relationship.relationshipType] || relationship.relationshipType}
                            </Badge>
                          </div>
                          <div className="mt-4 space-y-2">
                            {relationship.isPrimaryContact && (
                              <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-blue-600" />
                                <span className="text-sm text-gray-600">Contact principal</span>
                              </div>
                            )}
                            {relationship.emergencyContact && (
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-orange-600" />
                                <span className="text-sm text-gray-600">Contact d'urgence</span>
                              </div>
                            )}
                            {relationship.canPickup && (
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-green-600" />
                                <span className="text-sm text-gray-600">Autorisé à récupérer</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(relationship)}
                            className="flex items-center gap-2"
                            aria-label={`Modifier le type de relation pour ${relationship.childName}`}
                          >
                            <Edit className="h-4 w-4" />
                            Modifier
                          </Button>
                        </div>
                      </div>
                    </>
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

