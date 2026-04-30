"use client";

import { SessionProStatus } from "@ecoledigitale/contracts/src/sessions-pro";
import { Alert, AlertDescription, AlertTitle } from "@ecoledigitale/ui";
import { AlertCircle, CheckCircle, XCircle, Clock, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionStatusBannerProps {
  statut: SessionProStatus;
  className?: string;
}

const statusConfig: Record<
  SessionProStatus,
  {
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    variant: "default" | "destructive";
    className?: string;
  }
> = {
  planifiee: {
    title: "Session planifiée",
    description: "Les inscriptions ne sont pas encore ouvertes pour cette session.",
    icon: Clock,
    variant: "default",
    className: "bg-blue-500/10 border-blue-500/30 text-blue-400",
  },
  ouverte: {
    title: "Inscriptions ouvertes",
    description: "Vous pouvez vous inscrire à cette session.",
    icon: CheckCircle,
    variant: "default",
    className: "bg-green-500/10 border-green-500/30 text-green-400",
  },
  complete: {
    title: "Session complète",
    description: "Toutes les places ont été réservées pour cette session.",
    icon: XCircle,
    variant: "destructive",
  },
  en_cours: {
    title: "Session en cours",
    description: "Cette session est actuellement en cours.",
    icon: Clock,
    variant: "default",
    className: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  },
  terminee: {
    title: "Session terminée",
    description: "Cette session est terminée.",
    icon: CheckCircle,
    variant: "default",
    className: "bg-muted border-border text-muted-foreground",
  },
  annulee: {
    title: "Session annulée",
    description: "Cette session a été annulée.",
    icon: Ban,
    variant: "destructive",
  },
};

export function SessionStatusBanner({
  statut,
  className,
}: SessionStatusBannerProps) {
  // Don't display banner for "planifiee" status
  if (statut === "planifiee") {
    return null;
  }

  const config = statusConfig[statut];
  const Icon = config.icon;

  return (
    <Alert
      variant={config.variant}
      className={cn("mb-6", config.className, className)}
    >
      <Icon className="h-4 w-4" />
      <AlertTitle>{config.title}</AlertTitle>
      <AlertDescription>{config.description}</AlertDescription>
    </Alert>
  );
}

