import { Award, CalendarRange, Clock3, GraduationCap, MapPin } from "lucide-react";
import type { FormationDetailData } from "@/types/formation";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";

export function HeroFormation({ formation }: { formation: FormationDetailData }) {
  const nextSession = formation.sessions[0];

  return (
    <section className="overflow-hidden rounded-[2rem] border border-border/70 bg-white/80 p-6 shadow-soft sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{formation.niveau}</Badge>
            {formation.themes.slice(0, 3).map((theme) => (
              <Badge key={theme}>{theme}</Badge>
            ))}
          </div>
          <div className="space-y-4">
            <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              {formation.titre}
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {formation.descriptionComplete}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<Clock3 className="h-4 w-4" />} label="Durée">
              {formation.dureeJours > 0
                ? `${formation.dureeJours} jours`
                : `${formation.dureeHeures} heures`}
            </Feature>
            <Feature icon={<GraduationCap className="h-4 w-4" />} label="Formateur principal">
              {formation.formateurs[0]?.nomComplet || formation.formateurNom}
            </Feature>
            <Feature icon={<Award className="h-4 w-4" />} label="Certification">
              {formation.certification || "Attestation de fin de parcours"}
            </Feature>
            <Feature icon={<CalendarRange className="h-4 w-4" />} label="Prochaine session">
              {nextSession ? new Date(nextSession.dateDebut).toLocaleDateString("fr-FR") : "À la demande"}
            </Feature>
          </div>
        </div>
        <div className="rounded-[1.75rem] bg-slate-950 p-6 text-white shadow-lift">
          <p className="text-sm uppercase tracking-[0.3em] text-white/60">Tarif</p>
          <p className="mt-3 font-display text-4xl font-semibold">
            {formatCurrency(formation.prix)}
          </p>
          <div className="mt-6 space-y-3 rounded-[1.4rem] bg-white/10 p-4 text-sm">
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-white/70" />
              <div>
                <p className="font-medium">Format</p>
                <p className="text-white/70">
                  {nextSession?.mode || formation.mode}
                  {nextSession?.lieu ? ` • ${nextSession.lieu}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CalendarRange className="mt-0.5 h-4 w-4 text-white/70" />
              <div>
                <p className="font-medium">Places restantes</p>
                <p className="text-white/70">
                  {nextSession ? `${nextSession.placesRestantes} places sur cette session` : "Sur demande"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Feature({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.4rem] border border-border/70 bg-background/60 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-sm font-medium text-foreground">{children}</p>
    </div>
  );
}
