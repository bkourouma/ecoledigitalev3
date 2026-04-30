import Link from "next/link";
import { ExternalLink, FileText, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { LearningSupportData } from "@/lib/learning";

export function LearningSupportCard({
  formationSlug,
  support,
}: {
  formationSlug: string;
  support: LearningSupportData;
}) {
  const isVideo = support.kind === "video";
  const secureUrl = `/api/apprenant/supports/${support.id}?slug=${formationSlug}`;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-xl font-semibold">{support.titre}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {support.description || "Ressource débloquée dans votre espace apprenant."}
            </p>
          </div>
          <Badge tone={isVideo ? "success" : "neutral"}>
            {isVideo ? "Vidéo" : support.typeFichier || "Support"}
          </Badge>
        </div>

        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p>Intervenant : {support.formateurNom}</p>
          <p>Ajouté le : {support.createdAt ? formatDate(support.createdAt) : "Non renseigné"}</p>
          <p>Session : {support.sessionCode || "Parcours général"}</p>
          <p>Format : {support.typeFichier || support.kind}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/mes-formations/${formationSlug}/contenus/${support.id}`}>
              {isVideo ? "Lire la vidéo" : "Ouvrir le support"}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={secureUrl} target="_blank" rel="noreferrer">
              {isVideo ? (
                <PlayCircle className="mr-2 h-4 w-4" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Ouvrir la source
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={secureUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Nouvel onglet
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
