"use client";

import React from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
} from "@ecoledigitale/ui";
import { ArrowLeft, Edit, Mail, Phone, Calendar, User, Users, Heart, Loader2, AlertCircle, GraduationCap } from "lucide-react";
import { useParent, useParentChildren } from "@/lib/hooks/use-parents";

export default function ParentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const parentId = params.id as string;
  const { data: parent, isLoading, error } = useParent(parentId);
  const { data: childrenData, isLoading: isLoadingChildren } = useParentChildren(parentId);
  
  // Deduplicate children by id to prevent duplicate key errors
  const children = React.useMemo(() => {
    const childrenList = childrenData?.children || [];
    const seenIds = new Set<string>();
    const uniqueChildren: typeof childrenList = [];
    
    console.log('[ParentDetailPage] Raw children data:', childrenList);
    
    childrenList.forEach((child: any, index: number) => {
      if (!seenIds.has(child.id)) {
        seenIds.add(child.id);
        uniqueChildren.push(child);
      } else {
        console.warn(`[ParentDetailPage] Duplicate child ID found at index ${index}:`, child.id, child);
      }
    });
    
    console.log('[ParentDetailPage] Deduplicated children:', uniqueChildren.length, 'from', childrenList.length);
    
    return uniqueChildren;
  }, [childrenData?.children]);

  if (isLoading) {
    return (
      <div className="space-y-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-rose-100 to-pink-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-rose-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations du parent...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !parent) {
    return (
      <div className="space-y-8 max-w-7xl mx-auto">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Parent introuvable</h3>
                <p className="text-muted-foreground">
                  Le parent demandé n'existe pas ou vous n'avez pas les permissions pour le consulter.
                </p>
              </div>
              <Button onClick={() => router.push("/academic/parents")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.back()}
            className="border-gray-300 hover:bg-gray-50 hover:text-gray-900 text-gray-700"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              {parent.name}
            </h1>
            <p className="text-muted-foreground mt-2">
              Profil parent
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push(`/academic/parents/${parentId}/edit`)}
          className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-gradient-to-br from-rose-500 to-pink-600 p-4 sm:p-6 rounded-xl text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-xs sm:text-sm font-medium">
                Enfants
              </p>
              <p className="text-2xl sm:text-3xl font-bold mt-1">{parent.childrenCount || 0}</p>
            </div>
            <div className="bg-white/20 p-2 sm:p-3 rounded-lg">
              <Heart className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-4 sm:p-6 rounded-xl text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-xs sm:text-sm font-medium">
                Statut
              </p>
              <p className="text-2xl sm:text-3xl font-bold mt-1">Actif</p>
            </div>
            <div className="bg-white/20 p-2 sm:p-3 rounded-lg">
              <User className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-fuchsia-500 to-pink-600 p-4 sm:p-6 rounded-xl text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-xs sm:text-sm font-medium">
                Membre depuis
              </p>
              <p className="text-lg sm:text-xl font-bold mt-1">
                {parent.createdAt ? new Date(parent.createdAt).getFullYear() : '—'}
              </p>
            </div>
            <div className="bg-white/20 p-2 sm:p-3 rounded-lg">
              <Calendar className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-rose-400 to-pink-500 p-4 sm:p-6 rounded-xl text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-xs sm:text-sm font-medium">
                Contact
              </p>
              <p className="text-lg sm:text-xl font-bold mt-1">Disponible</p>
            </div>
            <div className="bg-white/20 p-2 sm:p-3 rounded-lg">
              <Mail className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Informations générales */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl sm:text-2xl flex items-center gap-2">
                <User className="h-5 w-5 sm:h-6 sm:w-6 text-rose-600" />
                Informations générales
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-400 mb-1">Nom complet</p>
                  <p className="text-base sm:text-lg font-semibold text-white">
                    {parent.firstName} {parent.lastName}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-400 mb-1">Email</p>
                  <p className="text-base sm:text-lg text-white flex items-center gap-2">
                    <Mail className="h-4 w-4 text-rose-400" />
                    {parent.email}
                  </p>
                </div>
                {parent.createdAt && (
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-1">Date de création</p>
                    <p className="text-base sm:text-lg text-white flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-rose-400" />
                      {new Date(parent.createdAt).toLocaleDateString('fr-FR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-400 mb-1">Nombre d'enfants</p>
                  <p className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                    <Users className="h-4 w-4 text-rose-400" />
                    {children.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Enfants */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl sm:text-2xl flex items-center gap-2">
                <Users className="h-5 w-5 sm:h-6 sm:w-6 text-rose-600" />
                Enfants ({children.length})
              </CardTitle>
              <CardDescription>
                Liste des étudiants associés à ce parent
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingChildren ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-rose-600" />
                </div>
              ) : children.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-500">Aucun enfant associé à ce parent</p>
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/academic/parents/assign?parentId=${parentId}`)}
                    className="mt-4 border-gray-300 bg-white hover:bg-gray-50 hover:text-gray-900 text-gray-900 font-medium"
                  >
                    <Users className="h-4 w-4 mr-2" />
                    Assigner des étudiants
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {children.map((child, index) => {
                    // Use index as the primary key to ensure absolute uniqueness
                    // This prevents duplicate key errors even if child.id or relationshipId are duplicated
                    // Include child.id in the key for debugging but index ensures uniqueness
                    const uniqueKey = `parent-${parentId}-child-${index}-id-${child.id}`;
                    console.log(`[ParentDetailPage] Rendering child ${index}:`, { id: child.id, uniqueKey });
                    return (
                    <div
                      key={uniqueKey}
                      className="flex items-center justify-between p-4 bg-gradient-to-r from-rose-50 to-pink-50 rounded-lg border border-rose-200 hover:shadow-md transition-all duration-200 cursor-pointer"
                      onClick={() => router.push(`/academic/students/${child.id}`)}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div className="bg-gradient-to-br from-rose-500 to-pink-600 p-2 rounded-lg">
                          <GraduationCap className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{child.name}</p>
                          <div className="flex items-center gap-4 mt-1">
                            <p className="text-sm text-gray-600">
                              <span className="font-medium">Matricule:</span> {child.studentNumber}
                            </p>
                            <p className="text-sm text-gray-600">
                              <span className="font-medium">Année:</span> {child.currentYear}
                            </p>
                            <Badge
                              variant={
                                child.status === 'active' ? 'default' :
                                child.status === 'graduated' ? 'secondary' :
                                child.status === 'suspended' ? 'destructive' : 'outline'
                              }
                              className="text-xs"
                            >
                              {child.status === 'active' ? 'Actif' :
                               child.status === 'graduated' ? 'Diplômé' :
                               child.status === 'suspended' ? 'Suspendu' :
                               child.status === 'dropped' ? 'Abandonné' :
                               child.status === 'transfer' ? 'Transféré' : child.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Actions rapides */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={() => router.push(`/academic/parents/${parentId}/edit`)}
                className="w-full bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white"
              >
                <Edit className="h-4 w-4 mr-2" />
                Modifier le parent
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push(`/academic/parents/assign?parentId=${parentId}`)}
                className="w-full border-gray-300 bg-white hover:bg-gray-50 hover:text-gray-900 text-gray-900 font-medium"
              >
                <Users className="h-4 w-4 mr-2" />
                Assigner des étudiants
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/academic/parents')}
                className="w-full border-gray-300 hover:bg-gray-50 hover:text-gray-900 text-gray-700"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Retour à la liste
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

