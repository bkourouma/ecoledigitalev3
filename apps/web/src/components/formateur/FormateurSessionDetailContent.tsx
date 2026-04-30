"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Badge } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Calendar,
  Users,
  MapPin,
  Video,
  FileText,
  ExternalLink,
  UserCheck,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FormateurInscritsList } from "./FormateurInscritsList";
import { SessionNotesTab } from "./SessionNotesTab";
import { MessageGroupeModal } from "./MessageGroupeModal";
import { useState } from "react";
import {
  downloadFileAsBlob,
  downloadFileWithAuth,
  openPdfWithAuth,
  openVideoWithAuth,
} from "@/lib/file-download-utils";
import { toast } from "sonner";

interface SessionDetailContentProps {
  sessionData: {
    session: {
      id: string;
      code_session: string;
      date_debut: string;
      date_fin: string;
      horaires?: string;
      mode_formation: string;
      lieu?: string;
      lien_visio?: string;
      statut: string;
      places_totales: number;
      places_reservees: number;
      places_disponibles: number;
      notes_formateur?: string;
      notes_updated_at?: string;
    };
    formation: {
      id: string;
      titre: string;
      slug?: string;
      description_courte?: string;
    };
    inscrits: Array<{
      id: string;
      inscription_id: string;
      apprenant: {
        id: string;
        nom: string;
        prenom: string;
        email: string;
        telephone?: string;
      };
      entreprise?: {
        id: string;
        nom: string;
      };
      statut_inscription: string;
      presence?: boolean;
      presence_marked_at?: string;
    }>;
    supports: Array<{
      id: string;
      titre: string;
      type_fichier: string;
      fichier_url: string;
    }>;
    notes_formateur?: string;
  };
}

const statutColors: Record<string, string> = {
  planifiee: "bg-blue-100 text-blue-800",
  ouverte: "bg-green-100 text-green-800",
  complete: "bg-purple-100 text-purple-800",
  en_cours: "bg-yellow-100 text-yellow-800",
  terminee: "bg-gray-100 text-gray-800",
  annulee: "bg-red-100 text-red-800",
};

const statutLabels: Record<string, string> = {
  planifiee: "PlanifiÃ©e",
  ouverte: "Ouverte",
  complete: "ComplÃ¨te",
  en_cours: "En cours",
  terminee: "TerminÃ©e",
  annulee: "AnnulÃ©e",
};

const modeLabels: Record<string, string> = {
  presentiel: "PrÃ©sentiel",
  distanciel: "Distanciel",
  hybride: "Hybride",
};

export function FormateurSessionDetailContent({ sessionData }: SessionDetailContentProps) {
  const { session, formation, inscrits, supports } = sessionData;
  const [messageModalOpen, setMessageModalOpen] = useState(false);

  const handleDownloadSupport = async (fileUrl: string, typeFichier: string, titre: string) => {
    try {
      if (typeFichier === "Video") {
        await openVideoWithAuth(fileUrl, { title: titre });
      } else if (typeFichier === "PDF") {
        await openPdfWithAuth(fileUrl, { title: titre });
      } else {
        await downloadFileWithAuth(fileUrl);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'ouvrir le support");
    }
  };

  const handleDirectDownload = async (fileUrl: string, titre: string) => {
    try {
      const fileExtension = fileUrl.split("?")[0].split(".").pop()?.toLowerCase() || "bin";
      const fileName = `${titre
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .trim() || "support"}.${fileExtension}`;
      await downloadFileAsBlob(fileUrl, fileName);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de télécharger le support");
    }
  };

  return (
    <div className="space-y-6">
      {/* Session Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-2xl mb-2">{formation.titre}</CardTitle>
              <p className="text-muted-foreground">{session.code_session}</p>
            </div>
            <Badge className={cn(statutColors[session.statut] || "bg-gray-100 text-gray-800")}>
              {statutLabels[session.statut] || session.statut}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Dates */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Dates</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(session.date_debut), "EEEE d MMMM yyyy", { locale: fr })} -{" "}
                  {format(new Date(session.date_fin), "EEEE d MMMM yyyy", { locale: fr })}
                </p>
                {session.horaires && (
                  <p className="text-xs text-muted-foreground mt-1">{session.horaires}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Apprenants inscrits</p>
                <p className="text-sm text-muted-foreground">
                  {inscrits.length} apprenant(s) ({session.places_reservees} / {session.places_totales} places)
                </p>
              </div>
            </div>
          </div>

          {/* Mode and Location */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Mode:</span>
              <span className="text-sm">{modeLabels[session.mode_formation] || session.mode_formation}</span>
            </div>
            {session.lieu && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{session.lieu}</span>
              </div>
            )}
            {session.lien_visio && (
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-muted-foreground" />
                <a
                  href={session.lien_visio}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Lien visioconfÃ©rence
                </a>
              </div>
            )}
          </div>

          {/* Trainer Notes */}
          {session.notes_formateur && (
            <div className="pt-4 border-t">
              <p className="text-sm font-medium mb-2">Mes notes</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {session.notes_formateur}
              </p>
              {session.notes_updated_at && (
                <p className="text-xs text-muted-foreground mt-2">
                  DerniÃ¨re mise Ã  jour: {format(new Date(session.notes_updated_at), "d MMM yyyy Ã  HH:mm", { locale: fr })}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enrolled Learners */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5" />
              Apprenants inscrits ({inscrits.length})
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMessageModalOpen(true)}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Message de groupe
              </Button>
              <Link href={`/formateur/sessions/${session.id}/inscrits`}>
                <Button variant="outline" size="sm">
                  Voir tous les apprenants
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <FormateurInscritsList inscrits={inscrits.slice(0, 10)} showAll={false} />
          {inscrits.length > 10 && (
            <div className="mt-4 text-center">
              <Link href={`/formateur/sessions/${session.id}/inscrits`}>
                <Button variant="outline">
                  Voir tous les {inscrits.length} apprenants
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Course Materials */}
      {supports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Supports de cours ({supports.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {supports.map((support) => (
                <div
                  key={support.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{support.titre}</p>
                      <p className="text-xs text-muted-foreground">{support.type_fichier}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadSupport(support.fichier_url, support.type_fichier, support.titre)
                      }
                      className="text-sm text-primary hover:underline"
                    >
                      {support.type_fichier === "Video" ? "Lire" : "Ouvrir"}
                    </button>
                    {support.type_fichier === "Video" && (
                      <button
                        type="button"
                        onClick={() => handleDirectDownload(support.fichier_url, support.titre)}
                        className="text-sm text-primary hover:underline"
                      >
                        Télécharger
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session Notes */}
      <SessionNotesTab
        sessionId={session.id}
        initialNotes={session.notes_formateur || ""}
        notesUpdatedAt={session.notes_updated_at}
      />

      {/* Group Messaging Modal */}
      <MessageGroupeModal
        open={messageModalOpen}
        onOpenChange={setMessageModalOpen}
        sessionId={session.id}
        enrolledLearners={inscrits.map((inscrit) => ({
          id: inscrit.inscription_id,
          apprenant: inscrit.apprenant,
          presence: inscrit.presence,
        }))}
      />
    </div>
  );
}

