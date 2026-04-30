"use client";

import { SessionDetail } from "@ecoledigitale/contracts/src/sessions-pro";
import { Badge, Button } from "@ecoledigitale/ui";
import { BookOpen, Calendar as CalendarIcon, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface SessionHeaderProps {
  session: SessionDetail;
  className?: string;
  backHref?: string;
}

const statutLabels: Record<string, string> = {
  planifiee: "Planifiée",
  ouverte: "Ouverte",
  complete: "Complète",
  en_cours: "En cours",
  terminee: "Terminée",
  annulee: "Annulée",
};

const statutColors: Record<string, string> = {
  planifiee: "bg-gray-100 text-gray-700",
  ouverte: "bg-green-100 text-green-700",
  complete: "bg-red-100 text-red-700",
  en_cours: "bg-blue-100 text-blue-700",
  terminee: "bg-gray-100 text-gray-700",
  annulee: "bg-red-100 text-red-700",
};

export function SessionHeader({ session, className, backHref }: SessionHeaderProps) {
  const formationTitre = session.formation?.titre || "Formation non spécifiée";
  const formationSlug = session.formation?.slug || "";
  const defaultBackHref = "/formations-professionnelles/sessions";

  return (
    <div className={cn("mb-6", className)}>
      {/* Back Button and Breadcrumb on same line */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          asChild
          className="flex items-center gap-2"
        >
          <Link href={backHref || defaultBackHref}>
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Link>
        </Button>
        {formationSlug && (
          <nav className="text-sm text-muted-foreground">
            <Link
              href="/formations-professionnelles/catalogue"
              className="hover:text-primary font-medium text-foreground/80"
            >
              Catalogue
            </Link>
            <span className="mx-2 text-muted-foreground/60">/</span>
            <Link
              href={`/formations-professionnelles/catalogue/${formationSlug}`}
              className="hover:text-primary font-medium text-foreground/80"
            >
              {formationTitre}
            </Link>
            <span className="mx-2 text-muted-foreground/60">/</span>
            <span className="text-foreground font-medium">Session {session.code_session}</span>
          </nav>
        )}
      </div>

      {/* Title and Status */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {formationTitre}
          </h1>
          <div className="flex items-center gap-4 text-foreground/90">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-mono text-sm font-semibold text-foreground">{session.code_session}</span>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                statutColors[session.statut] || statutColors.planifiee
              )}
            >
              {statutLabels[session.statut] || session.statut}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

