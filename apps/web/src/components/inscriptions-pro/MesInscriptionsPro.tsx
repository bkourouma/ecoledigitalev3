"use client";

import { useEnrollmentHistory } from "@/lib/hooks/use-inscriptions-pro";
import { EnrollmentHistoryQuerySchema } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { z } from "zod";
import { InscriptionCard } from "./InscriptionCard";
import { Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface MesInscriptionsProProps {
  filters: z.infer<typeof EnrollmentHistoryQuerySchema>;
  onPageChange: (page: number) => void;
}

export function MesInscriptionsPro({ filters, onPageChange }: MesInscriptionsProProps) {
  const { data, isLoading, error } = useEnrollmentHistory(filters);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Chargement de vos inscriptions...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center">
            <AlertCircle className="w-8 h-8 text-destructive mb-4" />
            <p className="text-destructive font-semibold mb-2">Erreur</p>
            <p className="text-muted-foreground text-sm text-center">
              {error.message || "Impossible de charger vos inscriptions"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.inscriptions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center text-center">
            <p className="text-lg font-semibold mb-2">Aucune inscription trouvée</p>
            <p className="text-muted-foreground text-sm">
              Vous n'avez pas encore d'inscriptions. Parcourez nos formations pour vous inscrire.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {data.inscriptions.map((inscription) => (
          <InscriptionCard key={inscription.id} inscription={inscription} />
        ))}
      </div>

      {/* Pagination */}
      {data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Page {data.pagination.page} sur {data.pagination.totalPages} ({data.pagination.total}{" "}
            inscription{data.pagination.total > 1 ? "s" : ""})
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(data.pagination.page - 1)}
              disabled={data.pagination.page <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(data.pagination.page + 1)}
              disabled={data.pagination.page >= data.pagination.totalPages}
            >
              Suivant
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

