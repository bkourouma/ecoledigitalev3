'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Save, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { PasswordChange } from '@ecoledigitale/contracts';
import { useChangePassword } from '@/lib/hooks/use-parent-settings';

export function ChangePasswordComponent() {
  const changePassword = useChangePassword();

  const [formData, setFormData] = useState<PasswordChange>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (field: keyof PasswordChange, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }));
    }
    if (formErrors.submit) {
      setFormErrors(prev => ({ ...prev, submit: '' }));
    }
    if (success) {
      setSuccess(false);
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.currentPassword || formData.currentPassword.trim() === '') {
      errors.currentPassword = 'Le mot de passe actuel est requis';
    }

    if (!formData.newPassword || formData.newPassword.trim() === '') {
      errors.newPassword = 'Le nouveau mot de passe est requis';
    } else {
      if (formData.newPassword.length < 8) {
        errors.newPassword = 'Le mot de passe doit contenir au moins 8 caractères';
      } else {
        const hasLetter = /[a-zA-Z]/.test(formData.newPassword);
        const hasNumber = /[0-9]/.test(formData.newPassword);
        if (!hasLetter || !hasNumber) {
          errors.newPassword = 'Le mot de passe doit contenir au moins une lettre et un chiffre';
        }
      }
    }

    if (!formData.confirmPassword || formData.confirmPassword.trim() === '') {
      errors.confirmPassword = 'La confirmation du mot de passe est requise';
    } else if (formData.newPassword !== formData.confirmPassword) {
      errors.confirmPassword = 'Les mots de passe ne correspondent pas';
    }

    if (formData.currentPassword === formData.newPassword && formData.newPassword !== '') {
      errors.newPassword = 'Le nouveau mot de passe doit être différent du mot de passe actuel';
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
      await changePassword.mutateAsync({
        currentPassword: formData.currentPassword,
        newPassword: formData.newPassword,
        confirmPassword: formData.confirmPassword,
      });

      // Reset form on success
      setFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setFormErrors({});
      setSuccess(true);

      // Clear success message after 5 seconds
      setTimeout(() => {
        setSuccess(false);
      }, 5000);
    } catch (error: any) {
      console.error('Error changing password:', error);
      setFormErrors({ submit: error.message || 'Une erreur est survenue lors du changement de mot de passe' });
    }
  };

  return (
    <Card role="region" aria-label="Changement de mot de passe">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Changer le mot de passe</CardTitle>
            <CardDescription>Mettez à jour votre mot de passe de compte</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
              <p className="text-sm text-green-600">Mot de passe changé avec succès !</p>
            </div>
          )}

          {formErrors.submit && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <p className="text-sm text-red-600">{formErrors.submit}</p>
            </div>
          )}

          <div>
            <Label htmlFor="currentPassword">Mot de passe actuel *</Label>
            <div className="relative">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={formData.currentPassword}
                  onChange={(e) => handleChange('currentPassword', e.target.value)}
                  placeholder="Entrez votre mot de passe actuel"
                  className={`pl-10 pr-10 ${formErrors.currentPassword ? 'border-red-500' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {formErrors.currentPassword && (
              <p className="text-sm text-red-600 mt-1">{formErrors.currentPassword}</p>
            )}
          </div>

          <div>
            <Label htmlFor="newPassword">Nouveau mot de passe *</Label>
            <div className="relative">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <Input
                  id="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={formData.newPassword}
                  onChange={(e) => handleChange('newPassword', e.target.value)}
                  placeholder="Entrez votre nouveau mot de passe"
                  className={`pl-10 pr-10 ${formErrors.newPassword ? 'border-red-500' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {formErrors.newPassword && (
              <p className="text-sm text-red-600 mt-1">{formErrors.newPassword}</p>
            )}
            <p className="text-sm text-gray-500 mt-1">
              Le mot de passe doit contenir au moins 8 caractères, une lettre et un chiffre.
            </p>
          </div>

          <div>
            <Label htmlFor="confirmPassword">Confirmer le nouveau mot de passe *</Label>
            <div className="relative">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={(e) => handleChange('confirmPassword', e.target.value)}
                  placeholder="Confirmez votre nouveau mot de passe"
                  className={`pl-10 pr-10 ${formErrors.confirmPassword ? 'border-red-500' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {formErrors.confirmPassword && (
              <p className="text-sm text-red-600 mt-1">{formErrors.confirmPassword}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Button
              type="submit"
              disabled={changePassword.isPending}
              className="flex items-center gap-2"
            >
              {(changePassword.isPending) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Changement en cours...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Changer le mot de passe
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

