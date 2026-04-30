"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOwnerAlerts } from "@/lib/hooks/use-owner-alerts";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerAlert } from "@ecoledigitale/contracts";

function severityVariant(s: OwnerAlert["severity"]): "destructive" | "default" | "secondary" {
  if (s === "high") return "destructive";
  if (s === "medium") return "default";
  return "secondary";
}

export default function OwnerAlertesPage() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useOwnerAlerts();

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/alerts/${id}/acknowledge`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { message?: string }).message || `Erreur ${res.status}`);
      }
      return body;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner-alerts", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["owner-dashboard", tenantId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement des alertes…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-700">
          {error instanceof Error ? error.message : "Chargement impossible."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Alertes pilotage</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Alertes ouvertes pour votre établissement. Chaque chargement peut créer de nouvelles
            alertes automatiques (impayés, cours sans titulaire, paies à valider) si les conditions
            sont remplies.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          Actualiser
        </Button>
      </div>

      {data.alerts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Aucune alerte en attente.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {data.alerts.map((a) => (
            <li key={a.id}>
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={severityVariant(a.severity)}>{a.severity}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">{a.domain}</span>
                    </div>
                    <CardTitle className="text-base font-medium leading-snug">{a.message}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={acknowledge.isPending}
                    onClick={() => acknowledge.mutate(a.id)}
                  >
                    {acknowledge.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Acquitter"}
                  </Button>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {acknowledge.isError ? (
        <p className="text-sm text-red-600">
          {acknowledge.error instanceof Error ? acknowledge.error.message : "Acquittement impossible."}
        </p>
      ) : null}
    </div>
  );
}
