import Link from "next/link";
import { ArrowLeft, ExternalLink, FileText, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LearningSupportData } from "@/lib/learning";

export function SupportReader({
  formationSlug,
  formationTitle,
  support,
}: {
  formationSlug: string;
  formationTitle: string;
  support: LearningSupportData;
}) {
  const secureUrl = `/api/apprenant/supports/${support.id}?slug=${formationSlug}`;
  const isVimeo = support.videoProvider === "vimeo" && support.videoId;
  const isNativeVideo =
    support.kind === "video" &&
    !isVimeo &&
    (support.fichierUrl.endsWith(".mp4") ||
      support.fichierUrl.endsWith(".webm") ||
      support.fichierUrl.endsWith(".m3u8"));
  const isPdf = support.kind === "pdf";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <Link href={`/mes-formations/${formationSlug}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour aux contenus
          </Link>
        </Button>
        <Badge tone={support.kind === "video" ? "success" : "neutral"}>
          {support.kind === "video" ? "Lecture vidéo" : support.typeFichier || "Lecture"}
        </Badge>
      </div>

      <div className="space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          {formationTitle}
        </p>
        <h1 className="font-display text-4xl font-semibold">{support.titre}</h1>
        <p className="max-w-3xl text-muted-foreground">
          {support.description || "Support accessible après confirmation de votre achat."}
        </p>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          {isVimeo ? (
            <div className="overflow-hidden rounded-[1.5rem] border border-border bg-black">
              <iframe
                title={support.titre}
                src={`https://player.vimeo.com/video/${support.videoId}`}
                className="aspect-video w-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : null}

          {isNativeVideo ? (
            <video
              controls
              preload="metadata"
              className="aspect-video w-full rounded-[1.5rem] border border-border bg-black"
              src={secureUrl}
            />
          ) : null}

          {isPdf ? (
            <iframe
              title={support.titre}
              src={secureUrl}
              className="min-h-[70vh] w-full rounded-[1.5rem] border border-border bg-white"
            />
          ) : null}

          {!isVimeo && !isNativeVideo && !isPdf ? (
            <div className="rounded-[1.5rem] border border-dashed border-border bg-muted p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-foreground shadow-soft">
                {support.kind === "video" ? (
                  <PlayCircle className="h-6 w-6" />
                ) : (
                  <FileText className="h-6 w-6" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Ce support est ouvert dans un nouvel onglet pour respecter son format d'origine.
              </p>
              <Button asChild className="mt-4">
                <Link href={secureUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Ouvrir le support
                </Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
