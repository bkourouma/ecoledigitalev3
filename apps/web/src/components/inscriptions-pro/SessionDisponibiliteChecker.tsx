"use client";

import { useCheckAvailability } from "@/lib/hooks/use-inscriptions-pro";
import { Card, CardContent } from "@ecoledigitale/ui";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface SessionDisponibiliteCheckerProps {
  sessionId: string;
}

export function SessionDisponibiliteChecker({ sessionId }: SessionDisponibiliteCheckerProps) {
  const { data, isLoading, error } = useCheckAvailability(sessionId, {
    refetchInterval: 30000, // Poll every 30 seconds
  });

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Vérification de la disponibilité...</span>
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
            <span className="text-sm">Erreur lors de la vérification de disponibilité</span>
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
              <span className="text-sm font-medium text-green-700 dark:text-green-400">
                {data.message}
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-destructive" />
              <span className="text-sm font-medium text-destructive">{data.message}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

