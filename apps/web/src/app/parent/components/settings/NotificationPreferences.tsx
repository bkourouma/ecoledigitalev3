'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, Save, Bell, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { NotificationPreference, NotificationPreferencesUpdate } from '@ecoledigitale/contracts';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/lib/hooks/use-parent-settings';

const NOTIFICATION_TYPES = [
  { value: 'message', label: 'Messages', icon: MessageSquare },
  { value: 'announcement', label: 'Annonces', icon: Bell },
  { value: 'event', label: 'Événements', icon: Bell },
  { value: 'grade', label: 'Notes', icon: Bell },
  { value: 'payment', label: 'Paiements', icon: Bell },
  { value: 'other', label: 'Autres', icon: Bell },
] as const;

const DELIVERY_METHODS = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'in-app', label: 'Dans l\'application', icon: MessageSquare },
  { value: 'sms', label: 'SMS', icon: Smartphone },
] as const;

export function NotificationPreferencesComponent() {
  const { data, isLoading, error } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();

  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const fetchedPreferences = data?.data?.preferences || [];

  // Initialize preferences when data is loaded
  useEffect(() => {
    if (fetchedPreferences.length > 0) {
      setPreferences(fetchedPreferences);
      setHasChanges(false);
    }
  }, [fetchedPreferences]);

  const handleToggleEnabled = (notificationType: string) => {
    setPreferences((prev) =>
      prev.map((pref) =>
        pref.notificationType === notificationType
          ? { ...pref, enabled: !pref.enabled }
          : pref
      )
    );
    setHasChanges(true);
  };

  const handleToggleDeliveryMethod = (notificationType: string, method: string) => {
    setPreferences((prev) =>
      prev.map((pref) => {
        if (pref.notificationType === notificationType) {
          const methods = pref.deliveryMethods || [];
          const newMethods = methods.includes(method)
            ? methods.filter((m) => m !== method)
            : [...methods, method];
          return { ...pref, deliveryMethods: newMethods };
        }
        return pref;
      })
    );
    setHasChanges(true);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    for (const pref of preferences) {
      if (pref.enabled && (!pref.deliveryMethods || pref.deliveryMethods.length === 0)) {
        errors[pref.notificationType] = 'Au moins une méthode de livraison doit être sélectionnée si les notifications sont activées';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      const updateData: NotificationPreferencesUpdate = {
        preferences: preferences.map((pref) => ({
          notificationType: pref.notificationType,
          enabled: pref.enabled,
          deliveryMethods: pref.deliveryMethods || [],
        })),
      };

      await updatePreferences.mutateAsync(updateData);
      setHasChanges(false);
      setFormErrors({});
    } catch (error: any) {
      console.error('Error updating notification preferences:', error);
      setFormErrors({ submit: error.message || 'Une erreur est survenue lors de l\'enregistrement des préférences' });
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card role="region" aria-label="Chargement des préférences de notification">
        <CardHeader>
          <CardTitle>Préférences de notification</CardTitle>
          <CardDescription>Configurez vos préférences de notification</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card role="alert" aria-live="polite" aria-label="Erreur de chargement des préférences de notification">
        <CardHeader>
          <CardTitle>Préférences de notification</CardTitle>
          <CardDescription>Configurez vos préférences de notification</CardDescription>
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
              aria-label="Réessayer de charger les préférences de notification"
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
            <CardTitle>Préférences de notification</CardTitle>
            <CardDescription>Configurez vos préférences de notification</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {formErrors.submit && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <p className="text-sm text-red-600">{formErrors.submit}</p>
            </div>
          )}

          {preferences.map((pref) => {
            const typeConfig = NOTIFICATION_TYPES.find((t) => t.value === pref.notificationType);
            const Icon = typeConfig?.icon || Bell;

            return (
              <div key={pref.notificationType} className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-gray-400" />
                    <div>
                      <Label htmlFor={`enabled-${pref.notificationType}`} className="text-base font-semibold">
                        {typeConfig?.label || pref.notificationType}
                      </Label>
                      <p className="text-sm text-gray-500">
                        Recevoir des notifications pour {typeConfig?.label.toLowerCase() || pref.notificationType}
                      </p>
                    </div>
                  </div>
                  <Switch
                    id={`enabled-${pref.notificationType}`}
                    checked={pref.enabled}
                    onCheckedChange={() => handleToggleEnabled(pref.notificationType)}
                  />
                </div>

                {pref.enabled && (
                  <div className="ml-8 space-y-3 pt-2 border-t">
                    <Label className="text-sm font-medium">Méthodes de livraison</Label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {DELIVERY_METHODS.map((method) => {
                        const MethodIcon = method.icon;
                        const isChecked = (pref.deliveryMethods || []).includes(method.value);

                        return (
                          <div key={method.value} className="flex items-center space-x-2">
                            <Checkbox
                              id={`${pref.notificationType}-${method.value}`}
                              checked={isChecked}
                              onCheckedChange={() => handleToggleDeliveryMethod(pref.notificationType, method.value)}
                            />
                            <Label
                              htmlFor={`${pref.notificationType}-${method.value}`}
                              className="text-sm font-normal cursor-pointer flex items-center gap-2"
                            >
                              <MethodIcon className="h-4 w-4 text-gray-400" />
                              {method.label}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                    {formErrors[pref.notificationType] && (
                      <p className="text-sm text-red-600">{formErrors[pref.notificationType]}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Button
              type="submit"
              disabled={!hasChanges || updatePreferences.isPending}
              className="flex items-center gap-2"
            >
              {(updatePreferences.isPending) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Enregistrer les préférences
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

