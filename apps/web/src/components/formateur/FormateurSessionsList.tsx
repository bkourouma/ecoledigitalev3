"use client";

import { Card, CardContent } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { Badge } from "@ecoledigitale/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { BookOpen, Users, Calendar, MapPin, Video, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Session {
  id: string;
  code_session: string;
  formation: {
    id: string;
    titre: string;
    slug?: string;
  };
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
  nb_inscrits: number;
}

interface FormateurSessionsListProps {
  sessions: Session[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
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
  planifiee: "Planifiée",
  ouverte: "Ouverte",
  complete: "Complète",
  en_cours: "En cours",
  terminee: "Terminée",
  annulee: "Annulée",
};

const modeLabels: Record<string, string> = {
  presentiel: "Présentiel",
  distanciel: "Distanciel",
  hybride: "Hybride",
};

export function FormateurSessionsList({
  sessions,
  pagination,
  onPageChange,
  onPageSizeChange,
}: FormateurSessionsListProps) {
  if (sessions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Aucune session trouvée</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sessions Cards */}
      <div className="grid gap-4">
        {sessions.map((session) => (
          <Card key={session.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">{session.formation.titre}</h3>
                      <p className="text-sm text-muted-foreground">{session.code_session}</p>
                    </div>
                    <Badge className={cn(statutColors[session.statut] || "bg-gray-100 text-gray-800")}>
                      {statutLabels[session.statut] || session.statut}
                    </Badge>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>
                        {format(new Date(session.date_debut), "d MMM yyyy", { locale: fr })} -{" "}
                        {format(new Date(session.date_fin), "d MMM yyyy", { locale: fr })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>{session.nb_inscrits} apprenant(s) inscrit(s)</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-medium">Mode:</span>
                      <span>{modeLabels[session.mode_formation] || session.mode_formation}</span>
                    </div>
                    {session.lieu && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span>{session.lieu}</span>
                      </div>
                    )}
                    {session.lien_visio && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Video className="h-4 w-4" />
                        <a
                          href={session.lien_visio}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          Lien visioconférence
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="w-full md:w-auto flex flex-row md:flex-col gap-2">
                  <Link href={`/formateur/sessions/${session.id}/details`} className="flex-1 md:flex-none">
                    <Button variant="outline" size="sm" className="w-full md:w-auto">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Détails
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Page {pagination.page} sur {pagination.totalPages} ({pagination.total} session(s))
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Suivant
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

