"use client";

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
} from "@ecoledigitale/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar,
  Edit,
  Save,
  X,
  Camera,
  GraduationCap,
  CreditCard,
  Loader2,
  AlertCircle
} from "lucide-react";
import { useCurrentStudent } from "@/lib/hooks/use-student-data";
import { createApiHeaders } from "@/lib/api-utils";
import { isStudentProfileMissingError } from "@/lib/student-profile-errors";

export default function StudentProfilePage() {
  const { data: session, status } = useSession();
  const { data: student, isLoading: isLoadingStudent, error: studentError } = useCurrentStudent();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    dateOfBirth: '',
    studentNumber: '',
    program: '',
    academicYear: '',
    enrollmentDate: ''
  });

  // Mettre à jour formData quand les données de l'étudiant sont chargées
  useEffect(() => {
    if (student) {
      setFormData({
        firstName: student.firstName || (session?.user as any)?.firstName || '',
        lastName: student.lastName || (session?.user as any)?.lastName || '',
        email: student.email || session?.user?.email || '',
        phone: student.phone || '',
        address: student.address || '',
        dateOfBirth: student.dateOfBirth ? new Date(student.dateOfBirth).toISOString().split('T')[0] : '',
        studentNumber: student.studentNumber || '',
        program: student.program || '',
        academicYear: student.academicYear || '',
        enrollmentDate: student.enrollmentDate ? new Date(student.enrollmentDate).toISOString().split('T')[0] : ''
      });
    }
  }, [student, session]);

  // Rediriger si non authentifié ou non étudiant
  if (status === 'loading' || isLoadingStudent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-gray-600">Chargement de votre profil...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  const roles = (session as any)?.roles ?? [];
  const isStudent = Array.isArray(roles) && roles.some((r: string) => ['student', 'Étudiant'].includes(r));

  if (!isStudent) {
    redirect('/');
  }

  if (studentError && isStudentProfileMissingError(studentError)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md">
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                <AlertCircle className="h-8 w-8 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Profil etudiant introuvable</h3>
                <p className="text-muted-foreground">
                  Ce compte n&apos;est pas encore rattache a une fiche etudiant. Veuillez contacter l&apos;administrateur.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (studentError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Erreur lors du chargement de votre profil</p>
          <p className="text-gray-600 text-sm">{studentError.message}</p>
        </div>
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
    if (!student?.id) return;

    try {
      const headers = createApiHeaders(session);
      
      const response = await fetch(`/api/v1/students/${student.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          address: formData.address,
          dateOfBirth: formData.dateOfBirth || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la sauvegarde');
      }

      // Recharger les données de l'étudiant
      window.location.reload();
      setIsEditing(false);
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      alert('Erreur lors de la sauvegarde. Veuillez réessayer.');
    }
  };

  const handleCancel = () => {
    // Réinitialiser les données du formulaire avec les valeurs originales
    if (student) {
      setFormData({
        firstName: student.firstName || (session?.user as any)?.firstName || '',
        lastName: student.lastName || (session?.user as any)?.lastName || '',
        email: student.email || session?.user?.email || '',
        phone: student.phone || '',
        address: student.address || '',
        dateOfBirth: student.dateOfBirth ? new Date(student.dateOfBirth).toISOString().split('T')[0] : '',
        studentNumber: student.studentNumber || '',
        program: student.program || '',
        academicYear: student.academicYear || '',
        enrollmentDate: student.enrollmentDate ? new Date(student.enrollmentDate).toISOString().split('T')[0] : ''
      });
    }
    setIsEditing(false);
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'Non spécifié';
    try {
      return new Date(dateString).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-emerald-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                Mon Profil
              </h1>
              <p className="text-gray-600 mt-2">
                Gérez vos informations personnelles et académiques
              </p>
            </div>
            <div className="flex items-center space-x-4">
              {!isEditing ? (
                <Button onClick={() => setIsEditing(true)} className="bg-emerald-600 hover:bg-emerald-700">
                  <Edit className="h-4 w-4 mr-2" />
                  Modifier
                </Button>
              ) : (
                <div className="flex space-x-2">
                  <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700">
                    <Save className="h-4 w-4 mr-2" />
                    Sauvegarder
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
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile Picture & Basic Info */}
          <div className="lg:col-span-1">
            <Card>
              <CardContent className="p-6 text-center">
                <div className="relative inline-block mb-4">
                  <Avatar className="w-32 h-32">
                    <AvatarImage src="" alt={`${formData.firstName} ${formData.lastName}`} />
                    <AvatarFallback className="text-2xl bg-emerald-100 text-emerald-600">
                      {getInitials(formData.firstName, formData.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  {isEditing && (
                    <Button
                      size="sm"
                      className="absolute bottom-0 right-0 rounded-full w-8 h-8 p-0"
                      variant="outline"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <h2 className="text-xl font-bold text-white mb-1">
                  {formData.firstName || (session?.user as any)?.firstName || 'Étudiant'} {formData.lastName || (session?.user as any)?.lastName || ''}
                </h2>
                <p className="text-gray-600 mb-2">{formData.program || 'Non spécifié'}</p>
                <p className="text-sm text-gray-500">N° Étudiant: {formData.studentNumber || 'Non assigné'}</p>
              </CardContent>
            </Card>

            {/* Academic Info */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <GraduationCap className="h-5 w-5" />
                  Informations Académiques
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm font-medium text-gray-600">Programme</Label>
                  <p className="text-gray-900">{formData.program || 'Non spécifié'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-600">Année Académique</Label>
                  <p className="text-gray-900">{formData.academicYear || 'Non spécifié'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-600">Date d'Inscription</Label>
                  <p className="text-gray-900">{formData.enrollmentDate ? formatDate(formData.enrollmentDate) : 'Non spécifié'}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Personal Information */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <User className="h-5 w-5" />
                  Informations Personnelles
                </CardTitle>
                <CardDescription>
                  Vos informations personnelles et de contact
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="firstName">Prénom</Label>
                    {isEditing ? (
                      <Input
                        id="firstName"
                        value={formData.firstName}
                        onChange={(e) => handleInputChange('firstName', e.target.value)}
                        className="mt-1"
                      />
                    ) : (
                      <p className="mt-1 text-gray-900">{formData.firstName || (session?.user as any)?.firstName || 'Non spécifié'}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="lastName">Nom</Label>
                    {isEditing ? (
                      <Input
                        id="lastName"
                        value={formData.lastName}
                        onChange={(e) => handleInputChange('lastName', e.target.value)}
                        className="mt-1"
                      />
                    ) : (
                      <p className="mt-1 text-gray-900">{formData.lastName || (session?.user as any)?.lastName || 'Non spécifié'}</p>
                    )}
                  </div>
                </div>

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
                    />
                  ) : (
                    <p className="mt-1 text-gray-900">{formData.email || session?.user?.email || 'Non spécifié'}</p>
                  )}
                </div>

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
                    />
                  ) : (
                    <p className="mt-1 text-gray-900">{formData.phone || 'Non spécifié'}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="address" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Adresse
                  </Label>
                  {isEditing ? (
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => handleInputChange('address', e.target.value)}
                      className="mt-1"
                    />
                  ) : (
                    <p className="mt-1 text-gray-900">{formData.address || 'Non spécifié'}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="dateOfBirth" className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Date de Naissance
                  </Label>
                  {isEditing ? (
                    <Input
                      id="dateOfBirth"
                      type="date"
                      value={formData.dateOfBirth}
                      onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                      className="mt-1"
                    />
                  ) : (
                    <p className="mt-1 text-gray-900">{formData.dateOfBirth ? formatDate(formData.dateOfBirth) : 'Non spécifié'}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="studentNumber" className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Numéro Étudiant
                  </Label>
                  <p className="mt-1 text-gray-900">{formData.studentNumber || 'Non assigné'}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Le numéro étudiant ne peut pas être modifié
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
