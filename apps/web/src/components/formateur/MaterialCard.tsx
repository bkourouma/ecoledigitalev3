"use client";

import { Card, CardContent } from "@ecoledigitale/ui";
import { Badge } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { FileText, Download, Edit, Trash2, ExternalLink, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/utils";
import { downloadFileWithAuth, openPdfWithAuth, openVideoWithAuth } from "@/lib/file-download-utils";
import { toast } from "sonner";

interface MaterialCardProps {
  support: {
    id: string;
    titre: string;
    description?: string;
    type_fichier: string;
    taille_fichier: number;
    fichier_url: string;
    formation?: {
      id: string;
      titre: string;
    };
    sessions: Array<{
      id: string;
      code_session: string;
    }>;
    visible_apprenants: boolean;
    nb_telechargements: number;
    created_at: string;
  };
  onDelete?: (id: string) => void;
  onViewStats?: (id: string) => void;
  isDeleting?: boolean;
}

const typeColors: Record<string, string> = {
  PDF: "bg-red-100 text-red-800",
  PPT: "bg-orange-100 text-orange-800",
  PPTX: "bg-orange-100 text-orange-800",
  DOC: "bg-blue-100 text-blue-800",
  DOCX: "bg-blue-100 text-blue-800",
  ZIP: "bg-purple-100 text-purple-800",
  Video: "bg-pink-100 text-pink-800",
  Autre: "bg-gray-100 text-gray-800",
};

export function MaterialCard({
  support,
  onDelete,
  onViewStats,
  isDeleting = false,
}: MaterialCardProps) {
  const handleOpenSupport = async () => {
    try {
      if (support.type_fichier === "Video") {
        await openVideoWithAuth(support.fichier_url, { title: support.titre });
      } else if (support.type_fichier === "PDF") {
        await openPdfWithAuth(support.fichier_url, { title: support.titre });
      } else {
        await downloadFileWithAuth(support.fichier_url);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'ouvrir le support");
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">{support.titre}</h3>
                {support.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {support.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge className={cn(typeColors[support.type_fichier] || "bg-gray-100 text-gray-800")}>
                  {support.type_fichier}
                </Badge>
                {!support.visible_apprenants && <Badge variant="outline">Masque</Badge>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>{formatFileSize(support.taille_fichier)}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Download className="h-4 w-4" />
                <span>{support.nb_telechargements} telechargement(s)</span>
              </div>
              {support.formation && (
                <div className="text-muted-foreground">
                  <span className="font-medium">Formation:</span> {support.formation.titre}
                </div>
              )}
              {support.sessions.length > 0 && (
                <div className="text-muted-foreground">
                  <span className="font-medium">Sessions:</span> {support.sessions.length} session(s)
                </div>
              )}
              <div className="text-muted-foreground">
                <span className="font-medium">Cree le:</span>{" "}
                {format(new Date(support.created_at), "d MMM yyyy", { locale: fr })}
              </div>
            </div>
          </div>

          <div className="ml-4 flex flex-col gap-2">
            <Button variant="outline" size="sm" onClick={handleOpenSupport}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Ouvrir
            </Button>
            <Link href={`/formateur/supports/${support.id}/edit`}>
              <Button variant="outline" size="sm">
                <Edit className="h-4 w-4 mr-2" />
                Modifier
              </Button>
            </Link>
            {onViewStats && (
              <Button variant="outline" size="sm" onClick={() => onViewStats(support.id)}>
                <BarChart3 className="h-4 w-4 mr-2" />
                Statistiques
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(support.id)}
                disabled={isDeleting}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Supprimer
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

