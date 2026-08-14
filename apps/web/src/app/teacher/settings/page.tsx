"use client";

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Separator,
} from "@ecoledigitale/ui";
import { 
  Settings,
  Mail,
  Phone,
  User,
  Save,
  X,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Bell,
  Globe,
  Lock
} from "lucide-react";
import { useCurrentTeacherId } from "@/lib/hooks/use-current-teacher";
import { useTeacher, useUpdateTeacher } from "@/lib/hooks/use-teachers";
import Link from "next/link";

export default function TeacherSettingsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { data: teacherId, isLoading: isLoadingTeacherId } = useCurrentTeacherId();
  const { data: teacher, isLoading: isLoadingTeacher, error } = useTeacher(teacherId || '');
  const updateTeacher = useUpdateTeacher();
  
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    phone: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  // Redirect if not authenticated or not teacher
  React.useEffect(() => {
    if (status === 'loading' || isLoadingTeacherId) {
      return;
    }

    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

    if (!isTeacher) {
      router.push('/');
    }
  }, [session, status, isLoadingTeacherId, router]);

  // Initialize form data when teacher data is loaded
  React.useEffect(() => {
    if (teacher && !isEditing) {
      setFormData({
        email: teacher.email || '',
        phone: teacher.phone || '',
      });
    }
  }, [teacher, isEditing]);

  // Show loading state
  if (status === 'loading' || isLoadingTeacherId || isLoadingTeacher) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (error || !teacher) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Profil introuvable</h3>
                <p className="text-muted-foreground">
                  Votre profil enseignant n'a pas été trouvé. Veuillez contacter l'administrateur.
                </p>
              </div>
              <Link href="/teacher/profile">
                <Button variant="outline">Retour au profil</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    if (!teacherId) return;
    
    setIsSaving(true);
    try {
      await updateTeacher.mutateAsync({
        id: teacherId,
        data: {
          email: formData.email || undefined,
          phone: formData.phone || undefined,
        }
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating settings:', error);
      alert('Erreur lors de la sauvegarde des paramètres');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (teacher) {
      setFormData({
        email: teacher.email || '',
        phone: teacher.phone || '',
      });
    }
    setIsEditing(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-purple-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-4">
              <Link href="/teacher/profile">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Retour
                </Button>
              </Link>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                  Paramètres
                </h1>
                <p className="text-gray-600 mt-1">
                  Gérez vos préférences et informations de contact
                </p>
              </div>
            </div>
            {!isEditing ? (
              <Button onClick={() => setIsEditing(true)} className="bg-purple-600 hover:bg-purple-700">
                <Settings className="h-4 w-4 mr-2" />
                Modifier
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button 
                  onClick={handleSave} 
                  className="bg-purple-600 hover:bg-purple-700"
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Enregistrement...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Enregistrer
                    </>
                  )}
                </Button>
                <Button onClick={handleCancel} variant="outline">
                  <X className="h-4 w-4 mr-2" />
                  Annuler
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Informations de Contact
              </CardTitle>
              <CardDescription>
                Mettez à jour vos informations de contact. Ces informations seront utilisées pour vous contacter.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </Label>
                {isEditing ? (
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className="mt-1"
                    placeholder="votre.email@exemple.com"
                  />
                ) : (
                  <p className="mt-1 text-gray-900">{teacher.email || 'Non spécifié'}</p>
                )}
              </div>

              <Separator />

              <div>
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Téléphone
                </Label>
                {isEditing ? (
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    className="mt-1"
                    placeholder="+225 07 07 12 34 56"
                  />
                ) : (
                  <p className="mt-1 text-gray-900">{teacher.phone || 'Non spécifié'}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Account Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Informations du Compte
              </CardTitle>
              <CardDescription>
                Informations de base de votre compte
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Nom complet</Label>
                <p className="mt-1 text-gray-900">{teacher.firstName} {teacher.lastName}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Le nom ne peut pas être modifié depuis cette page. Contactez l'administrateur pour toute modification.
                </p>
              </div>

              {teacher.employeeNumber && (
                <>
                  <Separator />
                  <div>
                    <Label>Numéro d'employé</Label>
                    <p className="mt-1 text-gray-900">{teacher.employeeNumber}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Le numéro d'employé ne peut pas être modifié.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Preferences (Placeholder for future features) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Préférences
              </CardTitle>
              <CardDescription>
                Gérez vos préférences de notification et d'affichage
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Les préférences de notification seront disponibles prochainement
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

