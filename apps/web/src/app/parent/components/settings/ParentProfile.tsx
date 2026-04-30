'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Edit, Save, X, User, Mail, Phone, MapPin, Calendar, Image as ImageIcon } from 'lucide-react';
import { ParentProfile, ProfileUpdate } from '@ecoledigitale/contracts';
import { useParentProfile, useUpdateParentProfile } from '@/lib/hooks/use-parent-settings';

export function ParentProfileComponent() {
  const { data, isLoading, error } = useParentProfile();
  const updateProfile = useUpdateParentProfile();
  
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ProfileUpdate>({
    firstName: '',
    lastName: '',
    phone: null,
    address: null,
    dateOfBirth: null,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const profile = data?.data?.profile;

  // Initialize form data when profile is loaded
  useEffect(() => {
    if (profile && !isEditing) {
      setFormData({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        phone: profile.phone || null,
        address: profile.address || null,
        dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.split('T')[0] : null,
      });
    }
  }, [profile, isEditing]);

  const handleEdit = () => {
    setIsEditing(true);
    setFormErrors({});
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormErrors({});
    // Reset form data to original profile data
    if (profile) {
      setFormData({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        phone: profile.phone || null,
        address: profile.address || null,
        dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.split('T')[0] : null,
      });
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.firstName || formData.firstName.trim() === '') {
      errors.firstName = 'Le prénom est requis';
    }

    if (!formData.lastName || formData.lastName.trim() === '') {
      errors.lastName = 'Le nom est requis';
    }

    // Validate phone format if provided
    if (formData.phone && formData.phone.trim() !== '') {
      const phoneRegex = /^[\d\s\-\+\(\)]+$/;
      if (!phoneRegex.test(formData.phone)) {
        errors.phone = 'Format de numéro de téléphone invalide';
      }
    }

    // Validate date of birth format if provided
    if (formData.dateOfBirth && formData.dateOfBirth.trim() !== '') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(formData.dateOfBirth)) {
        errors.dateOfBirth = 'Format de date invalide. Utilisez YYYY-MM-DD';
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
      await updateProfile.mutateAsync({
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone && formData.phone.trim() !== '' ? formData.phone.trim() : null,
        address: formData.address && formData.address.trim() !== '' ? formData.address.trim() : null,
        dateOfBirth: formData.dateOfBirth && formData.dateOfBirth.trim() !== '' ? formData.dateOfBirth : null,
      });
      setIsEditing(false);
      setFormErrors({});
    } catch (error: any) {
      console.error('Error updating profile:', error);
      setFormErrors({ submit: error.message || 'Une erreur est survenue lors de la mise à jour du profil' });
    }
  };

  const handleChange = (field: keyof ProfileUpdate, value: string | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card role="region" aria-label="Chargement du profil">
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Informations de votre profil</CardDescription>
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
      <Card role="alert" aria-live="polite" aria-label="Erreur de chargement du profil">
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Informations de votre profil</CardDescription>
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
              aria-label="Réessayer de charger le profil"
            >
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Informations de votre profil</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <User className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun profil trouvé</h3>
            <p className="text-gray-600 text-sm">Impossible de charger votre profil.</p>
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
            <CardTitle>Profil</CardTitle>
            <CardDescription>Informations de votre profil</CardDescription>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">Prénom *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                  className={formErrors.firstName ? 'border-red-500' : ''}
                />
                {formErrors.firstName && (
                  <p className="text-sm text-red-600 mt-1">{formErrors.firstName}</p>
                )}
              </div>

              <div>
                <Label htmlFor="lastName">Nom *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                  className={formErrors.lastName ? 'border-red-500' : ''}
                />
                {formErrors.lastName && (
                  <p className="text-sm text-red-600 mt-1">{formErrors.lastName}</p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  value={profile.email}
                  disabled
                  className="bg-gray-50"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">L'email ne peut pas être modifié</p>
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

            <div>
              <Label htmlFor="dateOfBirth">Date de naissance</Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-400" />
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={formData.dateOfBirth || ''}
                  onChange={(e) => handleChange('dateOfBirth', e.target.value || null)}
                  className={formErrors.dateOfBirth ? 'border-red-500' : ''}
                />
              </div>
              {formErrors.dateOfBirth && (
                <p className="text-sm text-red-600 mt-1">{formErrors.dateOfBirth}</p>
              )}
            </div>

            {profile.profilePictureUrl && (
              <div>
                <Label>Photo de profil</Label>
                <div className="flex items-center gap-4 mt-2">
                  <ImageIcon className="h-4 w-4 text-gray-400" />
                  <img
                    src={profile.profilePictureUrl}
                    alt="Photo de profil"
                    className="h-20 w-20 rounded-full object-cover"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">La photo de profil ne peut pas être modifiée ici</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={updateProfile.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={updateProfile.isPending}
                className="flex items-center gap-2"
              >
                {updateProfile.isPending ? (
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
                <User className="h-5 w-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-500">Nom complet</p>
                  <p className="text-base font-semibold text-gray-900">
                    {profile.firstName} {profile.lastName}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-500">Email</p>
                  <p className="text-base font-semibold text-gray-900">{profile.email}</p>
                </div>
              </div>

              {profile.phone && (
                <div className="flex items-start gap-3">
                  <Phone className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-500">Téléphone</p>
                    <p className="text-base font-semibold text-gray-900">{profile.phone}</p>
                  </div>
                </div>
              )}

              {profile.dateOfBirth && (
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-500">Date de naissance</p>
                    <p className="text-base font-semibold text-gray-900">
                      {new Date(profile.dateOfBirth).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {profile.address && (
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-500">Adresse</p>
                  <p className="text-base font-semibold text-gray-900 whitespace-pre-line">
                    {profile.address}
                  </p>
                </div>
              </div>
            )}

            {profile.profilePictureUrl && (
              <div className="flex items-start gap-3">
                <ImageIcon className="h-5 w-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-2">Photo de profil</p>
                  <img
                    src={profile.profilePictureUrl}
                    alt="Photo de profil"
                    className="h-24 w-24 rounded-full object-cover"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

