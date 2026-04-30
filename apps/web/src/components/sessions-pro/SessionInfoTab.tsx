"use client";

import { SessionDetail } from "@ecoledigitale/contracts/src/sessions-pro";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { SessionInfos } from "./SessionInfos";
import { SessionFormateurs } from "./SessionFormateurs";
import { Tag, TrendingUp, DollarSign, Download } from "lucide-react";
import { useRouter } from "next/navigation";

interface SessionInfoTabProps {
  session: SessionDetail;
  onStatusChange?: () => void;
}

export function SessionInfoTab({ session, onStatusChange }: SessionInfoTabProps) {
  const router = useRouter();

  const handleEdit = () => {
    router.push(`/formations-professionnelles/admin/sessions/${session.id}/modifier`);
  };

  const handleStatusChange = () => {
    if (onStatusChange) {
      onStatusChange();
    }
  };

  const handleExportDocuments = () => {
    // TODO: Implement document export
    console.log("Export documents for session:", session.id);
  };

  // Calculate capacity progress
  const capacityProgress = session.places_totales > 0
    ? (session.places_reservees / session.places_totales) * 100
    : 0;

  // Calculate revenue (estimated from reserved places * price)
  const estimatedRevenue = session.places_reservees * (session.prix_ttc || 0);

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions rapides</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Button
              variant="outline"
              onClick={handleStatusChange}
              className="w-full"
            >
              <Tag className="w-4 h-4 mr-2" />
              Changer statut
            </Button>
            <Button
              variant="outline"
              onClick={handleEdit}
              className="w-full"
            >
              Modifier la session
            </Button>
            <Button
              variant="outline"
              onClick={handleExportDocuments}
              className="w-full"
            >
              <Download className="w-4 h-4 mr-2" />
              Documents
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Progression capacité</p>
                <p className="text-2xl font-bold">
                  {session.places_reservees} / {session.places_totales}
                </p>
                <div className="mt-2">
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(capacityProgress, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
              <TrendingUp className="w-8 h-8 text-primary opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Revenus prévisionnels</p>
                <p className="text-2xl font-bold">
                  {estimatedRevenue.toLocaleString("fr-FR")} FCFA
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {session.places_reservees} place{session.places_reservees > 1 ? "s" : ""} × {session.prix_ttc?.toLocaleString("fr-FR")} FCFA
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-primary opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Places disponibles</p>
                <p className="text-2xl font-bold">
                  {session.places_disponibles}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {session.places_disponibles > 0 ? "Inscriptions ouvertes" : "Session complète"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Session Details */}
      <SessionInfos session={session} />

      {/* Trainers */}
      <SessionFormateurs session={session} />
    </div>
  );
}

