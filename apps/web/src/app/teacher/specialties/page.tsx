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
  Badge,
} from "@ecoledigitale/ui";
import { 
  Award,
  Plus,
  X,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Save
} from "lucide-react";
import { useCurrentTeacherId } from "@/lib/hooks/use-current-teacher";
import { useTeacher, useUpdateTeacher } from "@/lib/hooks/use-teachers";
import Link from "next/link";

export default function TeacherSpecialtiesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { data: teacherId, isLoading: isLoadingTeacherId } = useCurrentTeacherId();
  const { data: teacher, isLoading: isLoadingTeacher, error } = useTeacher(teacherId || '');
  const updateTeacher = useUpdateTeacher();
  
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [newSpecialty, setNewSpecialty] = useState('');
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

  // Initialize specialties when teacher data is loaded
  React.useEffect(() => {
    if (teacher) {
      setSpecialties(teacher.specialties || []);
    }
  }, [teacher]);

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

  const handleAddSpecialty = () => {
    if (newSpecialty.trim() && !specialties.includes(newSpecialty.trim())) {
      setSpecialties([...specialties, newSpecialty.trim()]);
      setNewSpecialty('');
    }
  };

  const handleRemoveSpecialty = (index: number) => {
    setSpecialties(specialties.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!teacherId) return;
    
    setIsSaving(true);
    try {
      await updateTeacher.mutateAsync({
        id: teacherId,
        data: {
          specialties: specialties,
        }
      });
      // Show success message or redirect
      router.push('/teacher/profile');
    } catch (error) {
      console.error('Error updating specialties:', error);
      alert('Erreur lors de la sauvegarde des spécialités');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-purple-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
            <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
              <Link href="/teacher/profile">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Retour
                </Button>
              </Link>
              <div>
                <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent leading-tight text-2xl md:text-3xl">
                  Mes Spécialités
                </h1>
                <p className="whitespace-nowrap text-gray-600 text-muted-foreground text-sm md:text-base">
                  Gérez vos spécialités et domaines d'expertise
                </p>
              </div>
            </div>
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
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5" />
              Spécialités
            </CardTitle>
            <CardDescription>
              Ajoutez vos domaines d'expertise et spécialités académiques. Ces informations seront visibles sur votre profil.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Add Specialty Input */}
            <div className="space-y-2">
              <Label htmlFor="newSpecialty">Ajouter une spécialité</Label>
              <div className="flex gap-2">
                <Input
                  id="newSpecialty"
                  value={newSpecialty}
                  onChange={(e) => setNewSpecialty(e.target.value)}
                  placeholder="Ex: Mathématiques, Informatique, Physique, Chimie..."
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSpecialty();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddSpecialty}
                  disabled={!newSpecialty.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Appuyez sur Entrée ou cliquez sur le bouton + pour ajouter
              </p>
            </div>

            {/* Specialties List */}
            <div className="space-y-2">
              <Label>Vos spécialités ({specialties.length})</Label>
              {specialties.length > 0 ? (
                <div className="flex flex-wrap gap-2 p-4 border rounded-lg bg-gray-50">
                  {specialties.map((specialty, index) => (
                    <Badge 
                      key={index} 
                      variant="secondary" 
                      className="flex items-center gap-2 px-3 py-1.5 text-sm"
                    >
                      {specialty}
                      <button
                        type="button"
                        onClick={() => handleRemoveSpecialty(index)}
                        className="ml-1 hover:text-red-600 transition-colors"
                        aria-label={`Supprimer ${specialty}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="p-8 border rounded-lg bg-gray-50 text-center">
                  <Award className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    Aucune spécialité ajoutée. Commencez par ajouter vos domaines d'expertise ci-dessus.
                  </p>
                </div>
              )}
            </div>

            {/* Info Box */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <strong>Astuce :</strong> Vos spécialités aident les administrateurs à vous assigner les cours appropriés. 
                Ajoutez tous les domaines dans lesquels vous êtes compétent.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

