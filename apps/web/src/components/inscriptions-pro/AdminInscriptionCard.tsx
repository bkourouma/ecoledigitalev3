"use client";

import { Card, CardContent, CardHeader, CardTitle, Badge } from "@ecoledigitale/ui";
import { User, Calendar, DollarSign, Building2, Mail, Phone, FileText } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { formatAmountFCFA } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface AdminInscriptionCardProps {
  inscription: {
    id: string;
    numero_inscription: string;
    session: {
      id: string;
      code_session: string;
      date_debut: string;
      date_fin: string;
      formation: {
        id: string;
        titre: string;
        slug: string;
      };
    };
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
    type_inscription: 'individuelle' | 'entreprise';
    statut: string;
    montant_ttc: number;
    paiement_statut: string | null;
    date_inscription: string;
  };
  className?: string;
}

const statutConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  en_attente: { label: "En attente", variant: "outline" },
  confirmee: { label: "Confirmée", variant: "default" },
  annulee: { label: "Annulée", variant: "destructive" },
  terminee: { label: "Terminée", variant: "secondary" },
};

const paiementStatutConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  en_attente: { label: "En attente", variant: "outline" },
  valide: { label: "Payé", variant: "default" },
  echec: { label: "Échec", variant: "destructive" },
};

export function AdminInscriptionCard({ inscription, className }: AdminInscriptionCardProps) {
  const statutInfo = statutConfig[inscription.statut] || {
    label: inscription.statut,
    variant: "outline" as const,
  };
  const paiementInfo = inscription.paiement_statut
    ? paiementStatutConfig[inscription.paiement_statut] || {
        label: inscription.paiement_statut,
        variant: "outline" as const,
      }
    : null;

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "d MMM yyyy", { locale: fr });
    } catch {
      return dateString;
    }
  };

  const formatDateTime = (dateString: string) => {
    try {
      return format(new Date(dateString), "d MMM yyyy HH:mm", { locale: fr });
    } catch {
      return dateString;
    }
  };

  return (
    <Card className={cn("h-full flex flex-col hover:shadow-lg transition-all duration-200", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="text-base line-clamp-2">
              {inscription.apprenant.prenom} {inscription.apprenant.nom}
            </CardTitle>
            <div className="text-xs font-mono text-muted-foreground">
              {inscription.numero_inscription}
            </div>
          </div>
          <Badge variant={statutInfo.variant} className="shrink-0 text-xs">
            {statutInfo.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 flex-1 flex flex-col">
        {/* Formation et Session */}
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground truncate">
                {inscription.session.formation.titre}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {inscription.session.code_session} - {formatDate(inscription.session.date_debut)}
            </span>
          </div>
        </div>

        {/* Contact */}
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{inscription.apprenant.email}</span>
          </div>
          {inscription.apprenant.telephone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" />
              <span>{inscription.apprenant.telephone}</span>
            </div>
          )}
        </div>

        {/* Entreprise */}
        {inscription.entreprise && (
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{inscription.entreprise.nom}</span>
          </div>
        )}

        {/* Type et Paiement */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Type</div>
            <Badge variant="outline" className="text-xs">
              {inscription.type_inscription === "individuelle" ? "Individuelle" : "Entreprise"}
            </Badge>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Paiement</div>
            {paiementInfo ? (
              <Badge variant={paiementInfo.variant} className="text-xs">
                {paiementInfo.label}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        </div>

        {/* Montant et Date */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Montant</div>
            <div className="font-semibold text-foreground text-sm">
              {formatAmountFCFA(inscription.montant_ttc)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Date</div>
            <div className="text-sm text-foreground">
              {formatDateTime(inscription.date_inscription)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

