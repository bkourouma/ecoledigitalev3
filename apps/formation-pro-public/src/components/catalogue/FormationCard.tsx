import Image from "next/image";
import Link from "next/link";
import { Clock3, Signal, Sparkles, UserRound } from "lucide-react";
import type { FormationCardData } from "@/types/formation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export function FormationCard({ formation }: { formation: FormationCardData }) {
  const badgeTone =
    formation.niveau.toLowerCase().includes("avance")
      ? "danger"
      : formation.niveau.toLowerCase().includes("inter")
        ? "warning"
        : "success";

  return (
    <Link href={`/catalogue/${formation.slug}`} className="group block" aria-label={`Voir ${formation.titre}`}>
      <Card className="h-full overflow-hidden transition duration-300 group-hover:-translate-y-1 group-hover:shadow-lift" role="article">
        <div className="relative aspect-video overflow-hidden">
          <Image
            src="/course-placeholder.svg"
            alt={formation.titre}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-900/45 via-transparent to-primary/30" />
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <Badge tone={badgeTone}>{formation.niveau}</Badge>
            {formation.mode ? <Badge>{formation.mode}</Badge> : null}
          </div>
        </div>
        <CardHeader>
          <CardTitle className="line-clamp-2">{formation.titre}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {formation.descriptionCourte}
          </p>
          <div className="grid gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              <span>
                {formation.dureeJours > 0
                  ? `${formation.dureeJours} jours`
                  : `${formation.dureeHeures} heures`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Signal className="h-4 w-4" />
              <span>{formation.themes.slice(0, 2).join(" • ") || "Parcours certifiant"}</span>
            </div>
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4" />
              <span>{formation.formateurNom}</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border/70 pt-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                À partir de
              </p>
              <p className="text-lg font-semibold">{formatCurrency(formation.prix)}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
              <Sparkles className="h-4 w-4" />
              Voir le détail
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
