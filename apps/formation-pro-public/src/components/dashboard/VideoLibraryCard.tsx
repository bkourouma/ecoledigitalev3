import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export function VideoLibraryCard({
  item,
}: {
  item: {
    id: string;
    titre: string;
    description: string | null;
    formateurNom: string;
    sessionCode: string | null;
    createdAt: string | null;
    formationTitle: string;
    formationSlug: string;
  };
}) {
  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Badge tone="success">Vidéo</Badge>
          <p className="text-sm text-muted-foreground">
            {item.createdAt ? `Ajoutée le ${formatDate(item.createdAt)}` : "Disponible maintenant"}
          </p>
        </div>
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            {item.formationTitle}
          </p>
          <CardTitle className="mt-2 text-2xl">{item.titre}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {item.description || "Vidéo accessible dans votre espace apprenant."}
        </p>
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p>Intervenant : {item.formateurNom}</p>
          <p>Session : {item.sessionCode || "Parcours général"}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/mes-formations/${item.formationSlug}/contenus/${item.id}`}>
              <PlayCircle className="mr-2 h-4 w-4" />
              Regarder la vidéo
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/mes-formations/${item.formationSlug}`}>Voir la formation</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
