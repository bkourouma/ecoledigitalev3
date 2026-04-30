'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Plus, Edit, Trash2, Save, X, User, Phone, Mail, Users } from 'lucide-react';
import { EmergencyContact, EmergencyContactCreate, EmergencyContactUpdate } from '@ecoledigitale/contracts';
import {
  useEmergencyContacts,
  useAddEmergencyContact,
  useUpdateEmergencyContact,
  useRemoveEmergencyContact,
} from '@/lib/hooks/use-parent-emergency';

export function EmergencyContacts() {
  const { data, isLoading, error } = useEmergencyContacts();
  const addContact = useAddEmergencyContact();
  const removeContact = useRemoveEmergencyContact();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<EmergencyContactCreate>({
    contactName: '',
    relationship: '',
    phone: '',
    email: null,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const contacts = data?.data?.contacts || [];
  // Create update hook only when editing
  const updateContact = editingId ? useUpdateEmergencyContact(editingId) : null;

  const handleAdd = () => {
    setIsAdding(true);
    setFormData({
      contactName: '',
      relationship: '',
      phone: '',
      email: null,
    });
    setFormErrors({});
  };

  const handleEdit = (contact: EmergencyContact) => {
    setEditingId(contact.id);
    setFormData({
      contactName: contact.contactName,
      relationship: contact.relationship,
      phone: contact.phone,
      email: contact.email || null,
    });
    setFormErrors({});
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({
      contactName: '',
      relationship: '',
      phone: '',
      email: null,
    });
    setFormErrors({});
  };

  const handleDelete = (contactId: string) => {
    setDeletingId(contactId);
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;

    try {
      await removeContact.mutateAsync(deletingId);
      setDeletingId(null);
    } catch (error: any) {
      console.error('Error deleting emergency contact:', error);
      setFormErrors({ submit: error.message || 'Une erreur est survenue lors de la suppression du contact' });
    }
  };

  const handleCancelDelete = () => {
    setDeletingId(null);
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.contactName || formData.contactName.trim() === '') {
      errors.contactName = 'Le nom du contact est requis';
    }

    if (!formData.relationship || formData.relationship.trim() === '') {
      errors.relationship = 'La relation est requise';
    }

    if (!formData.phone || formData.phone.trim() === '') {
      errors.phone = 'Le numéro de téléphone est requis';
    } else {
      const phoneRegex = /^[\d\s\-\+\(\)]+$/;
      if (!phoneRegex.test(formData.phone)) {
        errors.phone = 'Format de numéro de téléphone invalide';
      }
    }

    // Validate email format if provided
    if (formData.email && formData.email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        errors.email = 'Format d\'email invalide';
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
      if (editingId && updateContact) {
        // Update existing contact
        const updateData: EmergencyContactUpdate = {
          contactName: formData.contactName.trim(),
          relationship: formData.relationship.trim(),
          phone: formData.phone.trim(),
          email: formData.email && formData.email.trim() !== '' ? formData.email.trim() : null,
        };
        await updateContact.mutateAsync(updateData);
        setEditingId(null);
      } else {
        // Add new contact
        await addContact.mutateAsync({
          contactName: formData.contactName.trim(),
          relationship: formData.relationship.trim(),
          phone: formData.phone.trim(),
          email: formData.email && formData.email.trim() !== '' ? formData.email.trim() : null,
        });
        setIsAdding(false);
      }
      setFormData({
        contactName: '',
        relationship: '',
        phone: '',
        email: null,
      });
      setFormErrors({});
    } catch (error: any) {
      console.error('Error saving emergency contact:', error);
      setFormErrors({ submit: error.message || 'Une erreur est survenue lors de l\'enregistrement du contact' });
    }
  };

  const handleChange = useCallback((field: keyof EmergencyContactCreate, value: string | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }));
    }
  }, [formErrors]);

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Contacts d'urgence</CardTitle>
          <CardDescription>Gérez vos contacts d'urgence</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card role="alert" aria-live="polite">
        <CardHeader>
          <CardTitle>Contacts d'urgence</CardTitle>
          <CardDescription>Gérez vos contacts d'urgence</CardDescription>
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
            <CardTitle>Contacts d'urgence</CardTitle>
            <CardDescription>Gérez vos contacts d'urgence</CardDescription>
          </div>
          {!isAdding && editingId === null && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAdd}
              className="flex items-center gap-2"
              aria-label="Ajouter un nouveau contact d'urgence"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Ajouter
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Add/Edit Form */}
        {(isAdding || editingId !== null) && (
          <form onSubmit={handleSubmit} className="mb-6 p-4 border rounded-lg bg-gray-50">
            {formErrors.submit && (
              <div 
                className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 mb-4"
                role="alert"
                aria-live="polite"
              >
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" aria-hidden="true" />
                <p className="text-sm text-red-600">{formErrors.submit}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <Label htmlFor="contactName">Nom du contact *</Label>
                <Input
                  id="contactName"
                  value={formData.contactName}
                  onChange={(e) => handleChange('contactName', e.target.value)}
                  placeholder="Nom complet"
                  className={formErrors.contactName ? 'border-red-500' : ''}
                  aria-invalid={!!formErrors.contactName}
                  aria-describedby={formErrors.contactName ? 'contactName-error' : undefined}
                />
                {formErrors.contactName && (
                  <p id="contactName-error" className="text-sm text-red-600 mt-1" role="alert">
                    {formErrors.contactName}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="relationship">Relation *</Label>
                <Input
                  id="relationship"
                  value={formData.relationship}
                  onChange={(e) => handleChange('relationship', e.target.value)}
                  placeholder="Ex: Conjoint, Frère, Ami"
                  className={formErrors.relationship ? 'border-red-500' : ''}
                />
                {formErrors.relationship && (
                  <p className="text-sm text-red-600 mt-1">{formErrors.relationship}</p>
                )}
              </div>

              <div>
                <Label htmlFor="phone">Téléphone *</Label>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="+33 6 12 34 56 78"
                    className={formErrors.phone ? 'border-red-500' : ''}
                  />
                </div>
                {formErrors.phone && (
                  <p className="text-sm text-red-600 mt-1">{formErrors.phone}</p>
                )}
              </div>

              <div>
                <Label htmlFor="email">Email</Label>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => handleChange('email', e.target.value || null)}
                    placeholder="email@example.com"
                    className={formErrors.email ? 'border-red-500' : ''}
                  />
                </div>
                {formErrors.email && (
                  <p className="text-sm text-red-600 mt-1">{formErrors.email}</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={addContact.isPending || (updateContact?.isPending ?? false)}
              >
                <X className="h-4 w-4 mr-2" />
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={addContact.isPending || (updateContact?.isPending ?? false)}
                className="flex items-center gap-2"
              >
                {(addContact.isPending || (updateContact?.isPending ?? false)) ? (
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
        )}

        {/* Contacts List */}
        {contacts.length === 0 && !isAdding && editingId === null ? (
          <div className="text-center py-12">
            <Users className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun contact d'urgence</h3>
            <p className="text-gray-600 text-sm mb-4">Ajoutez un contact d'urgence pour commencer.</p>
            <Button
              variant="outline"
              onClick={handleAdd}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Ajouter un contact
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className={`p-4 border rounded-lg ${
                  editingId === contact.id ? 'bg-gray-50' : 'bg-white'
                }`}
              >
                {editingId === contact.id && updateContact ? (
                  // Edit form for this contact
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {formErrors.submit && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                        <p className="text-sm text-red-600">{formErrors.submit}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor={`edit-contactName-${contact.id}`}>Nom du contact *</Label>
                        <Input
                          id={`edit-contactName-${contact.id}`}
                          value={formData.contactName}
                          onChange={(e) => handleChange('contactName', e.target.value)}
                          className={formErrors.contactName ? 'border-red-500' : ''}
                        />
                        {formErrors.contactName && (
                          <p className="text-sm text-red-600 mt-1">{formErrors.contactName}</p>
                        )}
                      </div>

                      <div>
                        <Label htmlFor={`edit-relationship-${contact.id}`}>Relation *</Label>
                        <Input
                          id={`edit-relationship-${contact.id}`}
                          value={formData.relationship}
                          onChange={(e) => handleChange('relationship', e.target.value)}
                          className={formErrors.relationship ? 'border-red-500' : ''}
                        />
                        {formErrors.relationship && (
                          <p className="text-sm text-red-600 mt-1">{formErrors.relationship}</p>
                        )}
                      </div>

                      <div>
                        <Label htmlFor={`edit-phone-${contact.id}`}>Téléphone *</Label>
                        <Input
                          id={`edit-phone-${contact.id}`}
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => handleChange('phone', e.target.value)}
                          className={formErrors.phone ? 'border-red-500' : ''}
                        />
                        {formErrors.phone && (
                          <p className="text-sm text-red-600 mt-1">{formErrors.phone}</p>
                        )}
                      </div>

                      <div>
                        <Label htmlFor={`edit-email-${contact.id}`}>Email</Label>
                        <Input
                          id={`edit-email-${contact.id}`}
                          type="email"
                          value={formData.email || ''}
                          onChange={(e) => handleChange('email', e.target.value || null)}
                          className={formErrors.email ? 'border-red-500' : ''}
                        />
                        {formErrors.email && (
                          <p className="text-sm text-red-600 mt-1">{formErrors.email}</p>
                        )}
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
                  // Display contact
                  <>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <User className="h-5 w-5 text-gray-400" />
                          <h3 className="text-lg font-semibold text-gray-900">{contact.contactName}</h3>
                          <span className="text-sm text-gray-500">({contact.relationship})</span>
                        </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-600">{contact.phone}</span>
                          </div>
                          {contact.email && (
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4 text-gray-400" />
                              <span className="text-sm text-gray-600">{contact.email}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(contact)}
                          className="flex items-center gap-2"
                        >
                          <Edit className="h-4 w-4" />
                          Modifier
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(contact.id)}
                          className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          Supprimer
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        {deletingId && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <Card className="max-w-md w-full">
              <CardHeader>
                <CardTitle>Confirmer la suppression</CardTitle>
                <CardDescription>
                  Êtes-vous sûr de vouloir supprimer ce contact d'urgence ? Cette action est irréversible.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-end gap-3 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={handleCancelDelete}
                    disabled={removeContact.isPending}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Annuler
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleConfirmDelete}
                    disabled={removeContact.isPending}
                    className="flex items-center gap-2"
                  >
                    {removeContact.isPending ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Suppression...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4" />
                        Supprimer
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

