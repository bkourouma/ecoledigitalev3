'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Edit, Save, X, Mail, Phone, MapPin } from 'lucide-react';
import { ContactInformation, ContactUpdate } from '@ecoledigitale/contracts';
import { useContactInformation, useUpdateContactInformation } from '@/lib/hooks/use-parent-settings';

export function ContactInformationComponent() {
  const { data, isLoading, error } = useContactInformation();
  const updateContact = useUpdateContactInformation();
  
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ContactUpdate>({
    phone: null,
    email: '',
    address: null,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const contact = data?.data?.contact;

  // Initialize form data when contact is loaded
  useEffect(() => {
    if (contact && !isEditing) {
      setFormData({
        phone: contact.phone || null,
        email: contact.email || '',
        address: contact.address || null,
      });
    }
  }, [contact, isEditing]);

  const handleEdit = () => {
    setIsEditing(true);
    setFormErrors({});
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormErrors({});
    // Reset form data to original contact data
    if (contact) {
      setFormData({
        phone: contact.phone || null,
        email: contact.email || '',
        address: contact.address || null,
      });
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.email || formData.email.trim() === '') {
      errors.email = 'L\'email est requis';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        errors.email = 'Format d\'email invalide';
      }
    }

    // Validate phone format if provided
    if (formData.phone && formData.phone.trim() !== '') {
      const phoneRegex = /^[\d\s\-\+\(\)]+$/;
      if (!phoneRegex.test(formData.phone)) {
        errors.phone = 'Format de numéro de téléphone invalide';
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
      await updateContact.mutateAsync({
        phone: formData.phone && formData.phone.trim() !== '' ? formData.phone.trim() : null,
        email: formData.email.trim(),
        address: formData.address && formData.address.trim() !== '' ? formData.address.trim() : null,
      });
      setIsEditing(false);
      setFormErrors({});
    } catch (error: any) {
      console.error('Error updating contact information:', error);
      setFormErrors({ submit: error.message || 'Une erreur est survenue lors de la mise à jour des informations de contact' });
    }
  };

  const handleChange = (field: keyof ContactUpdate, value: string | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card role="region" aria-label="Chargement des informations de contact">
        <CardHeader>
          <CardTitle>Informations de contact</CardTitle>
          <CardDescription>Vos coordonnées de contact</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card role="alert" aria-live="polite" aria-label="Erreur de chargement des informations de contact">
        <CardHeader>
          <CardTitle>Informations de contact</CardTitle>
          <CardDescription>Vos coordonnées de contact</CardDescription>
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
              aria-label="Réessayer de charger les informations de contact"
            >
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Informations de contact</CardTitle>
          <CardDescription>Vos coordonnées de contact</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Mail className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucune information de contact trouvée</h3>
            <p className="text-gray-600 text-sm">Impossible de charger vos informations de contact.</p>
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
            <CardTitle>Informations de contact</CardTitle>
            <CardDescription>Vos coordonnées de contact</CardDescription>
          </div>
          {!isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleEdit}
              className="flex items-center gap-2"
            >
              <Edit className="h-4 w-4" />
              Modifier
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            {formErrors.submit && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <p className="text-sm text-red-600">{formErrors.submit}</p>
              </div>
            )}

            <div>
              <Label htmlFor="email">Email *</Label>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="votre.email@example.com"
                  className={formErrors.email ? 'border-red-500' : ''}
                />
              </div>
              {formErrors.email && (
                <p className="text-sm text-red-600 mt-1">{formErrors.email}</p>
              )}
            </div>

            <div>
              <Label htmlFor="phone">Téléphone</Label>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-gray-400" />
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone || ''}
                  onChange={(e) => handleChange('phone', e.target.value || null)}
                  placeholder="+33 6 12 34 56 78"
                  className={formErrors.phone ? 'border-red-500' : ''}
                />
              </div>
              {formErrors.phone && (
                <p className="text-sm text-red-600 mt-1">{formErrors.phone}</p>
              )}
            </div>

            <div>
              <Label htmlFor="address">Adresse</Label>
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-gray-400 mt-2.5" />
                <Textarea
                  id="address"
                  value={formData.address || ''}
                  onChange={(e) => handleChange('address', e.target.value || null)}
                  placeholder="Votre adresse complète"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={updateContact.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={updateContact.isPending}
                className="flex items-center gap-2"
              >
                {updateContact.isPending ? (
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
          </form>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-500">Email</p>
                  <p className="text-base font-semibold text-gray-900">{contact.email}</p>
                </div>
              </div>

              {contact.phone && (
                <div className="flex items-start gap-3">
                  <Phone className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-500">Téléphone</p>
                    <p className="text-base font-semibold text-gray-900">{contact.phone}</p>
                  </div>
                </div>
              )}
            </div>

            {contact.address && (
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-500">Adresse</p>
                  <p className="text-base font-semibold text-gray-900 whitespace-pre-line">
                    {contact.address}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

