"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@ecoledigitale/ui";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { createApiHeaders } from "@/lib/api-utils";

interface FormationDisponibiliteCheckerProps {
  formationProId: string;
}

export function FormationDisponibiliteChecker({ formationProId }: FormationDisponibiliteCheckerProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["inscriptions-pro", "availability", "formation", formationProId],
    queryFn: async () => {
      const response = await fetch("/api/v1/inscriptions-pro/verifier-disponibilite", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ formation_pro_id: formationProId }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Échec de la vérification");
      }

      const json = await response.json();
      return json.data as {
        disponible: boolean;
        places_restantes: number;
        message: string;
        formation?: { titre: string; prix_ttc: number };
      };
    },
    enabled: !!formationProId,
    refetchInterval: 30000,
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Vérification...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mb-6 border-destructive">
        <CardContent className="p-4">
          <div className="flex items-center space-x-2 text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Erreur lors de la vérification</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card className={`mb-6 ${data.disponible ? "border-green-500" : "border-destructive"}`}>
      <CardContent className="p-4">
        <div className="flex items-center space-x-2">
          {data.disponible ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">{data.message}</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-destructive" />
              <span className="text-sm font-medium text-destructive">{data.message}</span>
            </>
          )}
        </div>
        {data.formation && (
          <p className="text-xs text-muted-foreground mt-2">
            {data.formation.titre} — {data.formation.prix_ttc.toFixed(0)} F TTC (indicatif)
          </p>
        )}
      </CardContent>
    </Card>
  );
}
