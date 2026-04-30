"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  Mail,
  Phone,
  User,
  Award,
  Loader2,
  AlertCircle,
  FileText,
  Linkedin,
  DollarSign,
  Calendar,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useFormateurDetail } from "@/lib/hooks/use-sessions-pro";
import { formatAmountFCFA } from "@/lib/utils";

export default function FormateurDetailPage() {
  const router = useRouter();
  const params = useParams();
  const formateurId = params.id as string;
  
  const { data: response, isLoading, error, refetch } = useFormateurDetail(formateurId);
  const formateur = response?.data;

  // Determine if it's a 404 error
  const isNotFound = (error as any)?.status === 404 || (error as any)?.code === "NOT_FOUND";

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !formateur) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="text-center space-y-4">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto" />
          <h1 className="text-xl sm:text-2xl font-bold text-red-600">
            {isNotFound ? "Formateur non trouvé" : "Erreur de chargement"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {isNotFound 
              ? "Le formateur demandé n'existe pas ou a été supprimé."
              : error?.message || "Une erreur s'est produite lors du chargement du formateur."}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {!isNotFound && (
              <Button 
                onClick={() => refetch()} 
                variant="outline"
                className="w-full sm:w-auto"
              >
                <Loader2 className="w-4 h-4 mr-2" />
                Réessayer
              </Button>
            )}
            <Button 
              onClick={() => router.push('/formations-professionnelles/admin/formateurs')} 
              className="w-full sm:w-auto"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Retour à la liste
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) {
      return "Date non disponible";
    }
    
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      return "Date invalide";
    }
    
    return date.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };


  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6 sm:mb-8">
        <Button
          variant="outline"
          onClick={() => router.push('/formations-professionnelles/admin/formateurs')}
          className="flex items-center gap-2 w-full sm:w-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Retour</span>
        </Button>
        <div className="flex-1 w-full min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold break-words">
              {formateur.prenom} {formateur.nom}
            </h1>
            <Badge 
              variant={formateur.actif ? "default" : "secondary"}
              className="whitespace-nowrap"
            >
              {formateur.actif ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Actif
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3 mr-1" />
                  Inactif
                </>
              )}
            </Badge>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground break-words">
            Formateur professionnel
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button 
            className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 w-full sm:w-auto" 
            onClick={() => {
              router.push(`/formations-professionnelles/admin/formateurs/${formateurId}/modifier`);
            }}
          >
            <Edit className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Modifier</span>
            <span className="sm:hidden">Modifier</span>
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Spécialités</p>
              <p className="text-base sm:text-lg font-semibold mt-1 truncate">
                {formateur.specialites?.length || 0}
              </p>
            </div>
            <Award className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>
        {formateur.tarif_journalier && (
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-3 sm:p-4 rounded-xl text-white shadow">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-white/80 text-xs">Tarif journalier</p>
                <p className="text-base sm:text-lg font-semibold mt-1 truncate">
                  {formateur.tarif_journalier ? formatAmountFCFA(formateur.tarif_journalier) : "Non spécifié"}
                </p>
              </div>
              <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
            </div>
          </div>
        )}
        <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Statut</p>
              <p className="text-base sm:text-lg font-semibold mt-1 truncate">
                {formateur.actif ? "Actif" : "Inactif"}
              </p>
            </div>
            <User className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>
        {formateur.created_at && (
          <div className="bg-gradient-to-br from-orange-500 to-red-600 p-3 sm:p-4 rounded-xl text-white shadow">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-white/80 text-xs">Membre depuis</p>
                <p className="text-sm sm:text-base font-semibold mt-1 truncate">
                  {new Date(formateur.created_at).getFullYear()}
                </p>
              </div>
              <Calendar className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Formateur Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <User className="w-5 h-5" />
                Informations personnelles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Nom complet</p>
                    <p className="text-sm sm:text-base font-medium">
                      {formateur.civilite && `${formateur.civilite} `}
                      {formateur.prenom} {formateur.nom}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm sm:text-base break-words">{formateur.email}</p>
                  </div>
                </div>
                {formateur.telephone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Téléphone</p>
                      <p className="text-sm sm:text-base">{formateur.telephone}</p>
                    </div>
                  </div>
                )}
                {formateur.linkedin_url && (
                  <div className="flex items-center gap-2">
                    <Linkedin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">LinkedIn</p>
                      <a
                        href={formateur.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm sm:text-base text-primary hover:underline break-words"
                      >
                        Voir le profil
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bio */}
          {formateur.bio && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <FileText className="w-5 h-5" />
                  Biographie
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap break-words">
                  {formateur.bio}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Spécialités */}
          {formateur.specialites && formateur.specialites.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Award className="w-5 h-5" />
                  Spécialités
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {formateur.specialites.map((spec, index) => (
                    <Badge key={index} variant="outline" className="text-sm">
                      {spec}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4 sm:space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                className="w-full justify-start bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-sm sm:text-base"
                onClick={() => {
                  router.push(`/formations-professionnelles/admin/formateurs/${formateurId}/modifier`);
                }}
              >
                <Edit className="w-4 h-4 mr-2" />
                Modifier
              </Button>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Informations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Statut</span>
                <Badge variant={formateur.actif ? "default" : "secondary"}>
                  {formateur.actif ? "Actif" : "Inactif"}
                </Badge>
              </div>
              {formateur.tarif_journalier && (
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-muted-foreground">Tarif journalier</span>
                  <span className="text-sm sm:text-base font-medium">
                    {formateur.tarif_journalier ? formatAmountFCFA(formateur.tarif_journalier) : "Non spécifié"}
                  </span>
                </div>
              )}
              {formateur.specialites && formateur.specialites.length > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-muted-foreground">Spécialités</span>
                  <span className="text-sm sm:text-base font-medium">
                    {formateur.specialites.length}
                  </span>
                </div>
              )}
              {formateur.created_at && (
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-muted-foreground">Créé le</span>
                  <span className="text-sm sm:text-base font-medium">
                    {formatDate(formateur.created_at)}
                  </span>
                </div>
              )}
              {formateur.updated_at && (
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-muted-foreground">Modifié le</span>
                  <span className="text-sm sm:text-base font-medium">
                    {formatDate(formateur.updated_at)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

