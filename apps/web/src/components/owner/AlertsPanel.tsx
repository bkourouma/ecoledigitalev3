"use client";

import Link from "next/link";
import type { OwnerDashboardResponse } from "@ecoledigitale/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Alert = OwnerDashboardResponse["alerts"][number];

function severityVariant(s: Alert["severity"]): "destructive" | "default" | "secondary" {
  if (s === "high") return "destructive";
  if (s === "medium") return "default";
  return "secondary";
}

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) {
    return (
      <p className="text-sm text-muted-foreground">Aucune alerte en attente.</p>
    );
  }
  return (
    <ul className="space-y-3">
      {alerts.map((a) => (
        <li
          key={a.id}
          className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
        >
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={severityVariant(a.severity)}>{a.severity}</Badge>
              <span className="text-xs text-muted-foreground">{a.domain}</span>
            </div>
            <p className="text-sm">{a.message}</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/owner/alertes">Acquitter</Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
