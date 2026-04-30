"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Users, Plus, Search, Filter, Loader2, AlertCircle, Eye, EyeOff, Edit, Trash2, X, Mail, Phone, UserCheck, Heart } from "lucide-react";
import { useParents, useDeleteParent, useResetParentPassword, Parent } from "@/lib/hooks/use-parents";

export default function ParentsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [generatedPasswords, setGeneratedPasswords] = useState<Record<string, string>>({});
  const [resettingPasswordFor, setResettingPasswordFor] = useState<string | null>(null);

  const { data: parentsData, isLoading, error } = useParents({
    search: searchQuery || undefined,
    page,
    limit,
  });
  const deleteParentMutation = useDeleteParent();
  const resetParentPasswordMutation = useResetParentPassword();

  const userRoles: string[] = (session as any)?.roles || [];
  const isAdmin = userRoles.includes("admin") || userRoles.includes("super_admin");

  const parents = parentsData?.data?.parents || [];
  const pagination = parentsData?.data;

  // Filter parents (client-side filtering for consistency with courses page)
  const filteredParents = useMemo(() => {
    return parents.filter((parent: Parent) => {
      const matchesSearch = searchQuery === "" ||
        parent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        parent.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        `${parent.firstName} ${parent.lastName}`.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesSearch;
    });
  }, [parents, searchQuery]);

  const handleView = (parent: Parent) => {
    router.push(`/academic/parents/${parent.id}`);
  };

  const handleEdit = (parent: Parent) => {
    router.push(`/academic/parents/${parent.id}/edit`);
  };

  const togglePasswordVisibility = (parentId: string) => {
    setRevealedPasswords((prev) => ({ ...prev, [parentId]: !prev[parentId] }));
  };

  const getParentPassword = (parent: Parent): string | null => {
    const localPassword = generatedPasswords[parent.id];
    if (localPassword) return localPassword;

    const candidates = [
      parent.initialPassword,
      (parent as any).temporaryPassword,
      (parent as any).tempPassword,
      (parent as any).generatedPassword,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const value = candidate.trim();
      if (!value) continue;
      if (/^\$2[aby]\$/.test(value)) continue;
      return value;
    }

    return null;
  };

  const handlePasswordAction = async (parent: Parent) => {
    const currentPassword = getParentPassword(parent);
    if (currentPassword) {
      togglePasswordVisibility(parent.id);
      return;
    }

    if (!isAdmin) return;

    try {
      setResettingPasswordFor(parent.id);
      const result = await resetParentPasswordMutation.mutateAsync(parent.id);
      setGeneratedPasswords((prev) => ({ ...prev, [parent.id]: result.initialPassword }));
      setRevealedPasswords((prev) => ({ ...prev, [parent.id]: true }));
    } catch (error: any) {
      alert(error?.message || "Impossible de générer le mot de passe");
    } finally {
      setResettingPasswordFor(null);
    }
  };

  const handleDelete = async (parent: Parent) => {
    const confirmMessage = `Êtes-vous sûr de vouloir supprimer le parent "${parent.name}" ?\n\nCette action est irréversible.`;

    if (window.confirm(confirmMessage)) {
      try {
        await deleteParentMutation.mutateAsync(parent.id);
      } catch (error: any) {
        console.error("Error deleting parent:", error);
        const errorMessage = error?.message || "Erreur inconnue lors de la suppression";
        
        // Check if error mentions students
        const hasStudents = errorMessage.toLowerCase().includes("étudiants") || 
                           errorMessage.toLowerCase().includes("students") ||
                           errorMessage.toLowerCase().includes("enfants");
        
        if (hasStudents) {
          alert(errorMessage);
        } else {
          alert(`Erreur lors de la suppression du parent:\n\n${errorMessage}`);
        }
      }
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold">Gestion des parents</h2>
            <p className="text-muted-foreground">
              Gérez les parents et leurs relations avec les étudiants
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Erreur de chargement</h3>
                <p className="text-muted-foreground">
                  Impossible de charger les parents. Vérifiez votre connexion.
                </p>
              </div>
              <Button onClick={() => window.location.reload()}>
                Réessayer
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
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent">
            Gestion des parents
          </h1>
          <p className="text-muted-foreground mt-2">
            Gérez les parents et leurs relations avec les étudiants
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push('/academic/parents/assign')}
            className="border-gray-300 bg-white hover:bg-gray-50 hover:text-gray-900 text-gray-900 font-medium"
          >
            <Users className="h-4 w-4 mr-2" />
            Assigner des étudiants
          </Button>
          <Button
            onClick={() => router.push('/academic/parents/new')}
            className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouveau parent
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-rose-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total parents
                </p>
                <p className="text-3xl font-bold mt-1">{parents.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Avec enfants
                </p>
                <p className="text-3xl font-bold mt-1">
                  {parents.filter(p => p.childrenCount > 0).length}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Heart className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-fuchsia-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Total enfants
                </p>
                <p className="text-3xl font-bold mt-1">
                  {parents.reduce((sum, p) => sum + p.childrenCount, 0)}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <UserCheck className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-rose-400 to-pink-500 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  Moyenne enfants
                </p>
                <p className="text-3xl font-bold mt-1">
                  {parents.length > 0 
                    ? (parents.reduce((sum, p) => sum + p.childrenCount, 0) / parents.length).toFixed(1)
                    : '0'}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Users className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filter Controls */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Rechercher par nom, email..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="pl-10 pr-10 h-11 border-gray-200 focus:border-rose-500 focus:ring-rose-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Results Count */}
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredParents.length}</span>
              <span className="ml-1">
                {filteredParents.length === 1 ? 'parent trouvé' : 'parents trouvés'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-rose-100 to-pink-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-rose-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des parents...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Parents List */}
      {!isLoading && filteredParents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredParents.map((parent: Parent) => {
            const parentPassword = getParentPassword(parent);
            return (
            <div
              key={parent.id}
              className="bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group cursor-pointer"
            >
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg">{parent.name}</h3>
                </div>

                <div className="space-y-2 mb-4">
                  <p className="text-white/90 text-sm flex items-center">
                    <Mail className="w-4 h-4 mr-1" />
                    {parent.email}
                  </p>
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Nom complet:</span> {parent.firstName} {parent.lastName}
                  </p>
                  <p className="text-white/90 text-sm">
                    <span className="font-medium">Nombre d'enfants:</span> {parent.childrenCount || 0}
                  </p>
                  {parent.createdAt && (
                    <p className="text-white/90 text-sm">
                      <span className="font-medium">Créé le:</span> {new Date(parent.createdAt).toLocaleDateString('fr-FR')}
                    </p>
                  )}
                  <div className="text-white/90 text-sm">
                    <span className="font-medium">Mot de passe:</span>{" "}
                    {parentPassword
                      ? (revealedPasswords[parent.id] ? parentPassword : "********")
                      : "Non disponible"}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleView(parent);
                    }}
                    title="Voir les détails"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(parent);
                    }}
                    title="Modifier"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 px-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handlePasswordAction(parent);
                    }}
                    title={
                      parentPassword
                        ? (revealedPasswords[parent.id] ? "Masquer le mot de passe" : "Voir le mot de passe")
                        : (isAdmin ? "Générer puis afficher le mot de passe" : "Mot de passe non disponible")
                    }
                    disabled={
                      resettingPasswordFor === parent.id ||
                      (!parentPassword && !isAdmin)
                    }
                  >
                    {resettingPasswordFor === parent.id ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        Génération...
                      </>
                    ) : revealedPasswords[parent.id] ? (
                      <>
                        <EyeOff className="w-4 h-4 mr-1" />
                        Masquer MDP
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 mr-1" />
                        {parentPassword ? "Voir MDP" : (isAdmin ? "Générer MDP" : "Voir MDP")}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-red-500/20 hover:bg-red-500/40 text-white border-red-300/20 hover:border-red-300/40 transition-all duration-200 p-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(parent);
                    }}
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Decorative background element */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full transform translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500"></div>
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full transform -translate-x-12 translate-y-12 group-hover:scale-110 transition-transform duration-500"></div>
            </div>
          );
          })}
        </div>
      )}

      {/* Empty State - No parents at all */}
      {!isLoading && parents.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-rose-100 to-pink-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Users className="h-10 w-10 text-rose-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun parent trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre premier parent
                </p>
              </div>
              <Button
                onClick={() => router.push('/academic/parents/new')}
                className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un parent
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No filtered results */}
      {!isLoading && parents.length > 0 && filteredParents.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Search className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucun parent ne correspond à vos critères de recherche
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setPage(1);
                  }}
                  className="border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Effacer les filtres
                </Button>
                <Button
                  onClick={() => router.push('/academic/parents/new')}
                  className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouveau parent
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!isLoading && pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Page {pagination.page} sur {pagination.totalPages} ({pagination.total} parent{pagination.total !== 1 ? 's' : ''})
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="border-gray-300 hover:bg-gray-50"
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={page === pagination.totalPages}
              className="border-gray-300 hover:bg-gray-50"
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
