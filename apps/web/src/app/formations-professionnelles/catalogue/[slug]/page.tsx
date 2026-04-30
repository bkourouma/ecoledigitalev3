"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  Clock,
  DollarSign,
  Award,
  Calendar,
  MapPin,
  Loader2,
  AlertCircle,
  BookOpen,
  Target,
  Users,
  FileText,
  Plus,
  Eye,
  Trash2,
  Video,
  Building2,
  Download,
} from "lucide-react";
import { useFormationDetail, useDeleteFormationSession, downloadFormationPDF } from "@/lib/hooks/use-formations-pro";
import { SimilarFormations } from "@/components/formations-pro/SimilarFormations";
import { formatAmountFCFA } from "@/lib/utils";
import toast from "react-hot-toast";
import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { CatalogueSupportDetail } from "@ecoledigitale/contracts";
import { usesSessionBasedProfessionalCatalogue } from "@/lib/pro-tenants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ecoledigitale/ui";

function resolveSupportOpenUrl(fichierUrl: string): string {
  if (!fichierUrl) return "";
  if (fichierUrl.startsWith("http://") || fichierUrl.startsWith("https://")) {
    return fichierUrl;
  }
  if (typeof window !== "undefined" && fichierUrl.startsWith("/")) {
    return `${window.location.origin}${fichierUrl}`;
  }
  return fichierUrl;
}

function vimeoIframeSrc(s: CatalogueSupportDetail): string | null {
  if (s.video_id && /^\d+$/.test(String(s.video_id).trim())) {
    return `https://player.vimeo.com/video/${String(s.video_id).trim()}`;
  }
  const u = s.fichier_url || "";
  const m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  if (u.includes("player.vimeo.com")) return u;
  return null;
}

type SupportPreviewKind = "vimeo" | "video" | "pdf" | "image" | "iframe";

function getSupportPreviewKind(s: CatalogueSupportDetail): SupportPreviewKind {
  if (s.video_provider === "vimeo" || /vimeo\.com/i.test(s.fichier_url || "")) {
    return "vimeo";
  }
  const url = (s.fichier_url || "").toLowerCase();
  const extVideo = /\.(webm|mp4|mov|m4v|ogg)(\?|#|$)/i.test(s.fichier_url || "");
  if (s.video_provider === "local" || extVideo) return "video";
  const typ = (s.type_fichier || "").toLowerCase();
  if (typ.includes("vidéo") || typ.includes("video")) return "video";
  if (typ.includes("pdf") || url.endsWith(".pdf")) return "pdf";
  if (typ.includes("image") || /\.(png|jpe?g|gif|webp|svg|bmp)(\?|#|$)/i.test(s.fichier_url || "")) {
    return "image";
  }
  return "iframe";
}

/** Force les URLs `/api/v1/files/...` en same-origin (proxy Next). */
function normalizeFilesUrlForWebApp(url: string): string {
  if (!url) return url;
  const filesPathMatch = url.match(/\/api\/v1\/files\/.+$/i);
  if (!filesPathMatch) return url;
  const filesPath = filesPathMatch[0];
  // Force same-origin proxy to avoid CORS issues when backend URL is absolute (localhost:4000, etc.)
  if (typeof window !== "undefined") {
    return `${window.location.origin}${filesPath}`;
  }
  return filesPath;
}

function CatalogueSupportReader({ support }: { support: CatalogueSupportDetail }) {
  const openUrl = useMemo(() => resolveSupportOpenUrl(support.fichier_url), [support.fichier_url]);
  const sourceUrl = useMemo(() => normalizeFilesUrlForWebApp(openUrl), [openUrl]);
  const kind = useMemo(() => getSupportPreviewKind(support), [support]);
  const vimeoSrc = useMemo(() => vimeoIframeSrc(support), [support]);
  const previewSrc = sourceUrl;

  if (!support.fichier_url) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune URL de fichier n&apos;est associée à ce support.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 overflow-hidden">
        {kind === "vimeo" &&
          (vimeoSrc ? (
            <iframe
              src={vimeoSrc}
              title={support.titre}
              className="aspect-video w-full min-h-[200px]"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              Intégration Vimeo indisponible pour cette URL.
            </div>
          ))}
        {kind === "video" &&
          (previewSrc ? (
            <video
              controls
              preload="metadata"
              className="w-full max-h-[min(75vh,640px)] bg-black"
            >
              <source src={previewSrc} />
              Votre navigateur ne supporte pas la lecture vidéo intégrée.
            </video>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Préparation de la vidéo…</div>
          ))}
        {kind === "pdf" &&
          (previewSrc ? (
            <iframe
              title={support.titre}
              className="w-full min-h-[min(75vh,640px)] border-0"
              src={previewSrc}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Préparation du PDF…</div>
          ))}
        {kind === "image" &&
          (previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL dynamique (fichier catalogue / API)
            <img
              src={previewSrc}
              alt={support.titre}
              className="mx-auto max-h-[min(70vh,560px)] w-full object-contain bg-background p-2"
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Préparation de l&apos;image…</div>
          ))}
        {kind === "iframe" &&
          (previewSrc ? (
            <iframe
              title={support.titre}
              className="w-full min-h-[480px] border-0"
              src={previewSrc}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Préparation du document…</div>
          ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Aperçu intégré selon le type (PDF, Vimeo, image ou document).
      </p>
    </div>
  );
}

export default function FormationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId;
  const sessionBasedCatalogue = usesSessionBasedProfessionalCatalogue(tenantId);
  // Decode the slug from URL to handle any encoding
  const slug = decodeURIComponent(params.slug as string);
  
  const { data: response, isLoading, error, refetch } = useFormationDetail(slug);
  const formation = response?.data;
  const deleteSessionMutation = useDeleteFormationSession();
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [showSessionDetails, setShowSessionDetails] = useState(false);
  const [isDownloadingPDF, setIsDownloadingPDF] = useState(false);

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

  if (error || !formation) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="text-center space-y-4">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto" />
          <h1 className="text-xl sm:text-2xl font-bold text-red-600">
            {isNotFound ? "Formation non trouvée" : "Erreur de chargement"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {isNotFound 
              ? "La formation demandée n'existe pas ou a été supprimée."
              : error?.message || "Une erreur s'est produite lors du chargement de la formation."}
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
              onClick={() => router.push('/formations-professionnelles/catalogue')} 
              className="w-full sm:w-auto"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Retour au catalogue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const formatDuration = () => {
    if (formation.duree_jours && formation.duree_heures) {
      return `${formation.duree_jours} jours / ${formation.duree_heures}h`;
    } else if (formation.duree_jours) {
      return `${formation.duree_jours} jours`;
    } else if (formation.duree_heures) {
      return `${formation.duree_heures} heures`;
    }
    return "Non spécifié";
  };

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

  const niveauConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    Débutant: { label: "Débutant", variant: "outline" },
    Intermédiaire: { label: "Intermédiaire", variant: "secondary" },
    Avancé: { label: "Avancé", variant: "default" },
  };

  const niveauInfo = formation.niveau ? niveauConfig[formation.niveau] : null;

  const handleDeleteSession = async (sessionId: string) => {
    if (!formation?.id) return;
    
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette session ?")) {
      return;
    }

    try {
      await deleteSessionMutation.mutateAsync({
        formationId: formation.id,
        sessionId,
      });
      toast.success("Session supprimée avec succès");
    } catch (error: any) {
      toast.error(error.message || "Erreur lors de la suppression de la session");
    }
  };

  const handleViewSession = (session: any) => {
    setSelectedSession(session);
    setShowSessionDetails(true);
  };

  const handleEditSession = (session: any) => {
    const targetSlug = formation?.slug || slug;
    router.push(`/formations-professionnelles/catalogue/${targetSlug}/sessions/${session.id}/edit`);
  };

  const getModeLabel = (mode: string | null | undefined) => {
    if (!mode) return "Non spécifié";
    const modeMap: Record<string, string> = {
      'presential': 'Présentiel',
      'presentiel': 'Présentiel',
      'remote': 'Distanciel',
      'distanciel': 'Distanciel',
      'hybrid': 'Hybride',
      'hybride': 'Hybride',
      'elearning': 'E-learning',
    };
    return modeMap[mode.toLowerCase()] || mode;
  };

  const handleDownloadPDF = async () => {
    if (!formation?.id || !formation?.slug) {
      toast.error("Impossible de télécharger le PDF : informations de formation manquantes");
      return;
    }

    setIsDownloadingPDF(true);
    try {
      await downloadFormationPDF(formation.id, formation.slug);
      toast.success("PDF téléchargé avec succès");
    } catch (error: any) {
      console.error("Error downloading PDF:", error);
      toast.error(error.message || "Erreur lors du téléchargement du PDF");
    } finally {
      setIsDownloadingPDF(false);
    }
  };

  return (
    <div className="container mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8 max-w-7xl w-full min-w-0">
      {/* Header */}
      <div className="space-y-3 sm:space-y-0 mb-4 sm:mb-6 md:mb-8 min-w-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="outline"
            onClick={() => router.push('/formations-professionnelles/catalogue')}
            className="flex items-center gap-2 flex-shrink-0"
            size="sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Retour</span>
          </Button>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
              <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold break-words min-w-0">{formation.titre}</h1>
              {niveauInfo && (
                <Badge variant={niveauInfo.variant} className="whitespace-nowrap flex-shrink-0 text-xs">
                  {niveauInfo.label}
                </Badge>
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground break-words mt-1">
              Formation professionnelle
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 w-full">
          <Link href={`/formations-professionnelles/public/${formation.slug || slug}`} className="flex-1 sm:flex-initial min-w-[120px] sm:min-w-auto">
            <Button variant="outline" className="w-full" size="sm">
              <Eye className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Page publique</span>
              <span className="sm:hidden">Public</span>
            </Button>
          </Link>
          <Button 
            variant="outline"
            className="flex-1 sm:flex-initial min-w-[120px] sm:min-w-auto" 
            onClick={handleDownloadPDF}
            disabled={isDownloadingPDF}
            size="sm"
          >
            {isDownloadingPDF ? (
              <>
                <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" />
                <span className="hidden sm:inline">Génération...</span>
                <span className="sm:hidden">Génération...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Télécharger PDF</span>
                <span className="sm:hidden">PDF</span>
              </>
            )}
          </Button>
          {sessionBasedCatalogue && (
            <Button 
              variant="outline"
              className="flex-1 sm:flex-initial min-w-[120px] sm:min-w-auto" 
              onClick={() => {
                const targetSlug = formation?.slug || slug;
                router.push(`/formations-professionnelles/catalogue/${targetSlug}/sessions/new`);
              }}
              size="sm"
            >
              <Calendar className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Planifier une session</span>
              <span className="sm:hidden">Planifier</span>
            </Button>
          )}
          <Button 
            className="flex-1 sm:flex-initial min-w-[120px] sm:min-w-auto bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700" 
            onClick={() => {
              const targetSlug = formation?.slug || slug;
              router.push(`/formations-professionnelles/catalogue/${targetSlug}/edit`);
            }}
            size="sm"
          >
            <Edit className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Modifier</span>
            <span className="sm:hidden">Modifier</span>
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-4 sm:mb-6 md:mb-8 w-full min-w-0">
        <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-2 sm:p-3 md:p-4 rounded-lg sm:rounded-xl text-white shadow min-w-0">
          <div className="flex items-center justify-between min-w-0">
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="text-white/80 text-[10px] sm:text-xs">Durée</p>
              <p className="text-xs sm:text-sm md:text-base lg:text-lg font-semibold mt-1 truncate">{formatDuration()}</p>
            </div>
            <Clock className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 opacity-90 flex-shrink-0 ml-1 sm:ml-2" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-2 sm:p-3 md:p-4 rounded-lg sm:rounded-xl text-white shadow min-w-0">
          <div className="flex items-center justify-between min-w-0">
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="text-white/80 text-[10px] sm:text-xs">Prix</p>
              <p className="text-xs sm:text-sm md:text-base lg:text-lg font-semibold mt-1 truncate">{formatAmountFCFA(formation.prix_ttc)}</p>
            </div>
            <DollarSign className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 opacity-90 flex-shrink-0 ml-1 sm:ml-2" />
          </div>
        </div>
        {formation.type_certification && (
          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-2 sm:p-3 md:p-4 rounded-lg sm:rounded-xl text-white shadow min-w-0">
            <div className="flex items-center justify-between min-w-0">
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-white/80 text-[10px] sm:text-xs">Certification</p>
                <p className="text-xs sm:text-sm md:text-base lg:text-lg font-semibold mt-1 truncate">{formation.type_certification}</p>
              </div>
              <Award className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 opacity-90 flex-shrink-0 ml-1 sm:ml-2" />
            </div>
          </div>
        )}
        {sessionBasedCatalogue ? (
          <div className="bg-gradient-to-br from-orange-500 to-red-600 p-2 sm:p-3 md:p-4 rounded-lg sm:rounded-xl text-white shadow min-w-0">
            <div className="flex items-center justify-between min-w-0">
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-white/80 text-[10px] sm:text-xs">Sessions</p>
                <p className="text-lg sm:text-xl md:text-2xl font-bold mt-1">{formation.sessions?.length || 0}</p>
              </div>
              <Calendar className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 opacity-90 flex-shrink-0 ml-1 sm:ml-2" />
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-orange-500 to-red-600 p-2 sm:p-3 md:p-4 rounded-lg sm:rounded-xl text-white shadow min-w-0">
            <div className="flex items-center justify-between min-w-0">
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-white/80 text-[10px] sm:text-xs">Support pédagogique</p>
                <p className="text-xs sm:text-sm md:text-base font-semibold mt-1 line-clamp-2">
                  {formation.catalogue_support?.titre ?? "À définir"}
                </p>
              </div>
              <Eye className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 opacity-90 flex-shrink-0 ml-1 sm:ml-2" />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6 min-w-0">
          {/* Formation Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <BookOpen className="w-5 h-5" />
                Informations de la formation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {formation.description_courte && (
                <div>
                  <h3 className="font-medium mb-2 text-sm sm:text-base">Description</h3>
                  <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap break-words">{formation.description_courte}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm sm:text-base break-words min-w-0">{formatDuration()}</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <DollarSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm sm:text-base break-words min-w-0">{formatAmountFCFA(formation.prix_ttc)}</span>
                </div>
                {formation.type_certification && (
                  <div className="flex items-center gap-2 min-w-0">
                    <Award className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base break-words min-w-0">{formation.type_certification}</span>
                  </div>
                )}
                {formation.nom_certification && (
                  <div className="flex items-center gap-2 min-w-0">
                    <Award className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base break-words min-w-0">{formation.nom_certification}</span>
                  </div>
                )}
                {formation.carriere && (
                  <div className="flex items-center gap-2 min-w-0 sm:col-span-2">
                    <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base break-words min-w-0">{formation.carriere}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {!sessionBasedCatalogue && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Eye className="w-5 h-5" aria-hidden="true" />
                  Support pédagogique
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {formation.catalogue_support ? (
                  <>
                    <div>
                      <h3 className="font-semibold text-sm sm:text-base">{formation.catalogue_support.titre}</h3>
                      {formation.catalogue_support.description && (
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap break-words">
                          {formation.catalogue_support.description}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {formation.catalogue_support.type_fichier}
                      </Badge>
                    </div>
                    <CatalogueSupportReader support={formation.catalogue_support} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Aucun support n&apos;est encore associé à cette formation. Ajoutez-en un depuis la page{" "}
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/formations-professionnelles/catalogue/${encodeURIComponent(formation.slug || slug)}/edit`)
                      }
                      className="text-primary underline font-medium"
                    >
                      modifier la formation
                    </button>
                    .
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Objectifs */}
          {formation.objectifs && formation.objectifs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Target className="w-5 h-5" />
                  Objectifs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {formation.objectifs.map((objectif, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm sm:text-base text-muted-foreground">
                      <span className="text-primary mt-1">•</span>
                      <span className="break-words">{objectif}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Prerequis */}
          {formation.prerequis && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <FileText className="w-5 h-5" />
                  Prérequis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap break-words">{formation.prerequis}</p>
              </CardContent>
            </Card>
          )}

          {/* Public cible */}
          {formation.public_cible && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Users className="w-5 h-5" />
                  Public cible
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap break-words">{formation.public_cible}</p>
              </CardContent>
            </Card>
          )}

          {/* Thèmes */}
          {formation.themes && formation.themes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Thèmes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {formation.themes.map((theme, index) => (
                    <Badge key={index} variant="outline">
                      {theme}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Programme détaillé */}
          {formation.programme_detaille && formation.programme_detaille.modules && formation.programme_detaille.modules.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Programme détaillé</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {formation.programme_detaille.modules.map((module, index) => (
                  <div key={index} className="border rounded-lg p-4">
                    <h4 className="font-medium mb-2 text-sm sm:text-base">{module.titre}</h4>
                    {module.duree && (
                      <p className="text-sm text-muted-foreground mb-2">Durée: {module.duree}</p>
                    )}
                    {module.contenu && module.contenu.length > 0 && (
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        {module.contenu.map((item, itemIndex) => (
                          <li key={itemIndex} className="break-words">{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Sessions (ASPCI uniquement) — catalogue par formation pour les autres tenants */}
          {sessionBasedCatalogue ? (
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                  <CardTitle className="text-base sm:text-lg md:text-xl flex items-center gap-2 flex-wrap">
                    <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>Sessions planifiées</span>
                    {formation.sessions && formation.sessions.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {formation.sessions.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const targetSlug = formation?.slug || slug;
                      router.push(`/formations-professionnelles/catalogue/${targetSlug}/sessions/new`);
                    }}
                    className="w-full sm:w-auto"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    <span className="hidden sm:inline">Nouvelle session</span>
                    <span className="sm:hidden">Nouvelle session</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {formation.sessions && formation.sessions.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {formation.sessions.map((session: any) => (
                      <div
                        key={session.id}
                        className="border rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow bg-white min-w-0"
                      >
                        <div className="flex flex-col sm:flex-row items-start sm:items-start justify-between gap-2 sm:gap-3 mb-3 min-w-0">
                          <div className="flex-1 min-w-0 w-full sm:w-auto">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h4 className="font-semibold text-sm sm:text-base text-gray-900 break-words min-w-0">
                                {session.code_session || `Session ${session.id.substring(0, 8)}`}
                              </h4>
                              <Badge variant="outline" className="text-xs text-gray-700 border-gray-300 whitespace-nowrap flex-shrink-0">
                                {getModeLabel(session.mode_formation)}
                              </Badge>
                            </div>
                            {session.horaires && (
                              <p className="text-xs sm:text-sm text-gray-800 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-gray-600 flex-shrink-0" />
                                <span className="truncate">{session.horaires}</span>
                              </p>
                            )}
                          </div>
                          <div className="text-left sm:text-right w-full sm:w-auto flex-shrink-0">
                            <p className="font-bold text-base sm:text-lg text-primary">
                              {formatAmountFCFA(session.prix_ttc)}
                            </p>
                            {session.places_disponibles !== undefined && (
                              <p className="text-xs text-gray-600">
                                {session.places_disponibles} places
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2 mb-3 sm:mb-4 min-w-0">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm">
                            {session.date_debut && (
                              <div className="flex items-start sm:items-center gap-2 text-gray-900 min-w-0">
                                <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600 flex-shrink-0 mt-0.5 sm:mt-0" />
                                <span className="truncate break-words">Début: {formatDate(session.date_debut)}</span>
                              </div>
                            )}
                            {session.date_fin && (
                              <div className="flex items-start sm:items-center gap-2 text-gray-900 min-w-0">
                                <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600 flex-shrink-0 mt-0.5 sm:mt-0" />
                                <span className="truncate break-words">Fin: {formatDate(session.date_fin)}</span>
                              </div>
                            )}
                          </div>
                          {session.lieu && (
                            <div className="flex items-start gap-2 text-xs sm:text-sm text-gray-900 min-w-0">
                              <Building2 className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600 flex-shrink-0 mt-0.5" />
                              <span className="truncate break-words">{session.lieu}</span>
                            </div>
                          )}
                          {session.lien_visio && (
                            <div className="flex items-start gap-2 text-xs sm:text-sm text-gray-900 min-w-0">
                              <Video className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600 flex-shrink-0 mt-0.5" />
                              <a
                                href={session.lien_visio}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-700 hover:underline truncate break-all"
                              >
                                Lien visioconférence
                              </a>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap sm:flex-nowrap gap-2 pt-3 border-t">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 min-w-[80px] sm:min-w-0"
                            onClick={() => handleViewSession(session)}
                            title="Voir les détails"
                          >
                            <Eye className="w-4 h-4 sm:mr-1" />
                            <span className="hidden sm:inline">Voir</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 min-w-[80px] sm:min-w-0"
                            onClick={() => handleEditSession(session)}
                            title="Modifier"
                          >
                            <Edit className="w-4 h-4 sm:mr-1" />
                            <span className="hidden sm:inline">Modifier</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 min-w-[80px] sm:min-w-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteSession(session.id)}
                            disabled={deleteSessionMutation.isPending}
                            title="Supprimer"
                          >
                            {deleteSessionMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <Trash2 className="w-4 h-4 sm:mr-1" />
                                <span className="hidden sm:inline">Supprimer</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Aucune session planifiée pour le moment</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => {
                        const targetSlug = formation?.slug || slug;
                        router.push(`/formations-professionnelles/catalogue/${targetSlug}/sessions/new`);
                      }}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Planifier une session
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base sm:text-lg md:text-xl flex items-center gap-2">
                  <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
                  Inscription & accès
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Cette formation est vendue sur le catalogue au tarif indiqué ci-dessus. Les inscriptions se font
                  sur la formation (sans session planifiée). Après achat, les participants accèdent au contenu pédagogique
                  sur la page publique.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() =>
                      router.push(`/formations-professionnelles/public/${encodeURIComponent(formation.slug || slug)}`)
                    }
                  >
                    Page publique
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() =>
                      router.push(
                        `/formations-professionnelles/inscription/catalogue/${encodeURIComponent(formation.slug || slug)}`
                      )
                    }
                  >
                    Parcours inscription
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Similar Formations */}
          {formation?.id && (
            <SimilarFormations formationId={formation.id} />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4 sm:space-y-6 min-w-0">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm sm:text-base md:text-lg">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                className="w-full justify-start bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-xs sm:text-sm md:text-base"
                onClick={() => {
                  const targetSlug = formation?.slug || slug;
                  router.push(`/formations-professionnelles/catalogue/${targetSlug}/edit`);
                }}
                size="sm"
              >
                <Edit className="w-4 h-4 mr-2" />
                Modifier
              </Button>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm sm:text-base md:text-lg">Statistiques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex justify-between items-center gap-2 min-w-0">
                <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">Durée</span>
                <span className="text-xs sm:text-sm md:text-base font-medium text-right break-words min-w-0">{formatDuration()}</span>
              </div>
              <div className="flex justify-between items-center gap-2 min-w-0">
                <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">Prix</span>
                <span className="text-xs sm:text-sm md:text-base font-medium text-right break-words min-w-0">{formatAmountFCFA(formation.prix_ttc)}</span>
              </div>
              {formation.type_certification && (
                <div className="flex justify-between items-center gap-2 min-w-0">
                  <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">Certification</span>
                  <span className="text-xs sm:text-sm md:text-base font-medium break-words text-right min-w-0">{formation.type_certification}</span>
                </div>
              )}
              <div className="flex justify-between items-center gap-2 min-w-0">
                <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">Sessions</span>
                <span className="text-xs sm:text-sm md:text-base font-medium">{formation.sessions?.length || 0}</span>
              </div>
              {formation.themes && formation.themes.length > 0 && (
                <div className="flex justify-between items-center gap-2 min-w-0">
                  <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">Thèmes</span>
                  <span className="text-xs sm:text-sm md:text-base font-medium">{formation.themes.length}</span>
                </div>
              )}
              {formation.carriere && (
                <div className="flex justify-between items-center gap-2 min-w-0">
                  <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">Carrière</span>
                  <span className="text-xs sm:text-sm md:text-base font-medium break-words text-right min-w-0">{formation.carriere}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Session Details Dialog */}
      <Dialog open={showSessionDetails} onOpenChange={setShowSessionDetails}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
              Détails de la session
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {selectedSession?.code_session || "Informations complètes de la session"}
            </DialogDescription>
          </DialogHeader>
          {selectedSession && (
            <div className="space-y-4 mt-4 min-w-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Code session</p>
                  <p className="text-sm sm:text-base font-semibold break-words">
                    {selectedSession.code_session || "Non spécifié"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Mode de formation</p>
                  <p className="text-sm sm:text-base break-words">{getModeLabel(selectedSession.mode_formation)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Date de début</p>
                  <p className="text-sm sm:text-base flex items-center gap-2 break-words">
                    <Calendar className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                    {formatDate(selectedSession.date_debut)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Date de fin</p>
                  <p className="text-sm sm:text-base flex items-center gap-2 break-words">
                    <Calendar className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                    {formatDate(selectedSession.date_fin)}
                  </p>
                </div>
              </div>

              {selectedSession.horaires && (
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Horaires</p>
                  <p className="text-sm sm:text-base flex items-center gap-2 break-words">
                    <Clock className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                    {selectedSession.horaires}
                  </p>
                </div>
              )}

              {selectedSession.lieu && (
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Lieu</p>
                  <p className="text-sm sm:text-base flex items-center gap-2 break-words">
                    <Building2 className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                    {selectedSession.lieu}
                  </p>
                </div>
              )}

              {selectedSession.lien_visio && (
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Lien de visioconférence</p>
                  <a
                    href={selectedSession.lien_visio}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-2 break-all text-sm sm:text-base"
                  >
                    <Video className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                    {selectedSession.lien_visio}
                  </a>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Places disponibles</p>
                  <p className="text-sm sm:text-base font-semibold break-words">
                    {selectedSession.places_disponibles !== undefined
                      ? selectedSession.places_disponibles
                      : "Non spécifié"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Prix HT</p>
                  <p className="text-sm sm:text-base break-words">
                    {selectedSession.prix_ht
                      ? formatAmountFCFA(selectedSession.prix_ht)
                      : "Non spécifié"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Prix TTC</p>
                  <p className="text-sm sm:text-base font-semibold text-primary break-words">
                    {formatAmountFCFA(selectedSession.prix_ttc)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  className="flex-1 w-full sm:w-auto"
                  onClick={() => {
                    setShowSessionDetails(false);
                    handleEditSession(selectedSession);
                  }}
                  size="sm"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Modifier
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 w-full sm:w-auto text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => {
                    setShowSessionDetails(false);
                    handleDeleteSession(selectedSession.id);
                  }}
                  size="sm"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Supprimer
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
