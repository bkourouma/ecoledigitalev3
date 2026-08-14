"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { OwnerDashboardResponse } from "@ecoledigitale/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAcknowledgeOwnerAlert } from "@/lib/hooks/use-owner-alerts";

type Alert = OwnerDashboardResponse["alerts"][number];

function severityVariant(s: Alert["severity"]): "destructive" | "default" | "secondary" {
  if (s === "high") return "destructive";
  if (s === "medium") return "default";
  return "secondary";
}

/** Sévérité affichée en français : `high`/`medium`/`low` n'est pas une langue d'écran. */
const SEVERITY_LABEL: Record<string, string> = {
  high: "Critique",
  medium: "À traiter",
  low: "À surveiller",
};

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const acknowledge = useAcknowledgeOwnerAlert();

  if (!alerts.length) {
    return <p className="text-sm text-muted-foreground">Aucune alerte en attente.</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {alerts.map((a) => {
          // Seule la ligne acquittée passe en attente, pas toute la liste.
          const isBusy = acknowledge.isPending && acknowledge.variables === a.id;
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={severityVariant(a.severity)}>
                    {SEVERITY_LABEL[a.severity] ?? a.severity}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{a.domain}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.createdAt).toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <p className="text-sm">{a.message}</p>
                {/* Sans lien vers l'écran d'action, une alerte reste un constat. */}
                {a.href && (
                  <Link
                    href={a.href}
                    className="inline-block text-xs font-medium underline underline-offset-2"
                  >
                    Aller traiter
                  </Link>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate(a.id)}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Acquitter"}
              </Button>
            </li>
          );
        })}
      </ul>

      {acknowledge.isError && (
        <p className="text-sm text-red-600">
          {acknowledge.error instanceof Error
            ? acknowledge.error.message
            : "Acquittement impossible."}
        </p>
      )}

      <Link
        href="/owner/alertes"
        className="inline-block text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Voir toutes les alertes
      </Link>
    </div>
  );
}
