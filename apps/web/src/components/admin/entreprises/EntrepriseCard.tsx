/**
 * EntrepriseCard Component
 * 
 * Card component displaying enterprise info, statistics, and action buttons
 */

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { Building2, Users, DollarSign, Edit, Eye } from "lucide-react";
import { EntrepriseWithStats } from "@ecoledigitale/contracts/src/entreprises";
import { useRouter } from "next/navigation";
// Format currency helper
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XOF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

interface EntrepriseCardProps {
  enterprise: EntrepriseWithStats;
  onEdit: (enterprise: EntrepriseWithStats) => void;
}

export function EntrepriseCard({ enterprise, onEdit }: EntrepriseCardProps) {
  const router = useRouter();

  const handleViewDetails = () => {
    router.push(`/formations-professionnelles/admin/entreprises/${enterprise.id}/details`);
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-primary mt-1" />
            <div>
              <CardTitle className="text-lg">{enterprise.raison_sociale}</CardTitle>
              {enterprise.siret && (
                <p className="text-sm text-muted-foreground mt-1">SIRET: {enterprise.siret}</p>
              )}
            </div>
          </div>
          {!enterprise.actif && (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">
              Inactif
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contact Info */}
        <div className="text-sm">
          <p className="text-muted-foreground">
            {enterprise.contact_prenom} {enterprise.contact_nom}
          </p>
          <p className="text-muted-foreground">{enterprise.contact_email}</p>
          {enterprise.contact_telephone && (
            <p className="text-muted-foreground">{enterprise.contact_telephone}</p>
          )}
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Inscriptions</p>
              <p className="text-sm font-semibold">{enterprise.nb_inscriptions}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">CA Total</p>
              <p className="text-sm font-semibold">{formatCurrency(enterprise.ca_total)}</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleViewDetails}
          >
            <Eye className="h-4 w-4 mr-2" />
            Détails
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(enterprise)}
          >
            <Edit className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

