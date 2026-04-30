"use client";

import { Card, CardContent } from "@ecoledigitale/ui";
import { Badge } from "@ecoledigitale/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { User, Building2, Mail, Phone, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarkAttendance } from "@/lib/hooks/use-formateur-attendance";

interface Inscrit {
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
}

interface FormateurInscritsListProps {
  inscrits: Inscrit[];
  showAll?: boolean;
  sessionId?: string;
  sessionStatus?: string;
  canMarkAttendance?: boolean;
}

const statutColors: Record<string, string> = {
  confirmee: "bg-green-100 text-green-800",
  en_attente: "bg-yellow-100 text-yellow-800",
  annulee: "bg-red-100 text-red-800",
  terminee: "bg-gray-100 text-gray-800",
};

const statutLabels: Record<string, string> = {
  confirmee: "Confirmée",
  en_attente: "En attente",
  annulee: "Annulée",
  terminee: "Terminée",
};

export function FormateurInscritsList({
  inscrits,
  showAll = true,
  sessionId,
  sessionStatus,
  canMarkAttendance = false,
}: FormateurInscritsListProps) {
  const markAttendance = useMarkAttendance();

  // Determine if attendance can be marked
  const canMark = canMarkAttendance && sessionId && (sessionStatus === "en_cours" || sessionStatus === "terminee");

  const handleAttendanceChange = (inscriptionId: string, present: boolean) => {
    if (!sessionId) return;
    markAttendance.mutate({
      sessionId,
      inscriptionId,
      present,
    });
  };

  if (inscrits.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Aucun apprenant inscrit</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {inscrits.map((inscrit) => {
        const isMarking = markAttendance.isPending && markAttendance.variables?.inscriptionId === inscrit.inscription_id;
        const currentPresence = inscrit.presence;

        return (
          <div
            key={inscrit.id}
            className="flex items-start justify-between p-4 rounded-lg border hover:bg-accent transition-colors"
          >
            <div className="flex-1 space-y-2">
              {/* Apprenant Info */}
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-2">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium">
                    {inscrit.apprenant.prenom} {inscrit.apprenant.nom}
                  </p>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                    <div className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      <span>{inscrit.apprenant.email}</span>
                    </div>
                    {inscrit.apprenant.telephone && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        <span>{inscrit.apprenant.telephone}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Entreprise */}
              {inscrit.entreprise && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground ml-11">
                  <Building2 className="h-3 w-3" />
                  <span>{inscrit.entreprise.nom}</span>
                </div>
              )}

              {/* Status and Presence */}
              <div className="flex items-center gap-2 ml-11">
                <Badge
                  className={cn(
                    statutColors[inscrit.statut_inscription] || "bg-gray-100 text-gray-800"
                  )}
                >
                  {statutLabels[inscrit.statut_inscription] || inscrit.statut_inscription}
                </Badge>
                {currentPresence !== undefined && (
                  <div className="flex items-center gap-1 text-sm">
                    {currentPresence ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span className="text-green-600">Présent</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-red-600" />
                        <span className="text-red-600">Absent</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Attendance Checkbox */}
            {canMark && (
              <div className="ml-4 flex items-center gap-2">
                {isMarking ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`presence-${inscrit.id}`}
                      checked={currentPresence === true}
                      onCheckedChange={(checked) => {
                        if (checked === true) {
                          handleAttendanceChange(inscrit.inscription_id, true);
                        } else if (checked === false) {
                          handleAttendanceChange(inscrit.inscription_id, false);
                        }
                      }}
                      disabled={isMarking}
                    />
                    <label
                      htmlFor={`presence-${inscrit.id}`}
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      Présent
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

