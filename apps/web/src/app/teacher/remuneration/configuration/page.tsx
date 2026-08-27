"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { AlertCircle, CalendarRange, Loader2, Settings } from "lucide-react";
import { useMaConfigurationPaie, type MaConfigPaie } from "@/lib/hooks/use-professional-remuneration";

/**
 * Ma configuration de rémunération — espace enseignant.
 *
 * Pendant en LECTURE SEULE de l'écran « Configuration » de l'administration :
 * c'est elle qui décide comment quelqu'un est payé, l'intéressé le consulte.
 * L'endpoint `/my/configuration` dérive l'identité du jeton, cette page ne peut
 * donc afficher la rémunération de personne d'autre.
 *
 * Toutes les configurations sont listées, pas seulement celle en vigueur : la
 * précédente explique un bulletin ancien, et c'est justement la question qu'on
 * se pose en relisant son historique.
 */

const TYPE_LABELS: Record<string, string> = {
  salary: "Salaire fixe",
  hourly: "Taux horaire",
  mixed: "Mixte",
};

/* Mêmes teintes que côté administration : c'est la même notion, elle doit se
   reconnaître d'un écran à l'autre. */
const TYPE_STYLES: Record<string, string> = {
  salary: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  hourly: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  mixed: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
};

const fmtMontant = (v: number): string =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v))} FCFA`;

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "—";
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
};

/** Une configuration court encore si elle n'a pas de fin, ou une fin à venir. */
const estActive = (c: MaConfigPaie, aujourdhui: string): boolean =>
  (!c.effective_from || c.effective_from.slice(0, 10) <= aujourdhui) &&
  (!c.effective_to || c.effective_to.slice(0, 10) >= aujourdhui);

export default function MaConfigurationRemunerationPage() {
  const query = useMaConfigurationPaie();
  const configs = useMemo(() => query.data?.items ?? [], [query.data]);
  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-[1100px] mx-auto p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
          <Settings className="h-7 w-7 text-indigo-500 shrink-0" />
          Ma configuration de rémunération
        </h1>
        <p className="text-muted-foreground mt-2">
          Comment votre rémunération est calculée. Ces paramètres sont fixés par
          l&apos;administration : cet écran les donne à lire, il ne les modifie pas.
        </p>
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : query.isError ? (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-400">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              {(query.error as Error)?.message ?? "Impossible de charger votre configuration."}
            </p>
          </CardContent>
        </Card>
      ) : configs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <Settings className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Aucune configuration</h3>
              <p className="text-muted-foreground mt-1 max-w-md">
                Aucune configuration de rémunération ne vous est encore rattachée. Tant
                qu&apos;elle n&apos;existe pas, aucun bulletin ne peut être établi à votre nom —
                rapprochez-vous de l&apos;administration.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((c) => (
            <LigneConfig key={c.id} config={c} active={estActive(c, aujourdhui)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LigneConfig({ config, active }: { config: MaConfigPaie; active: boolean }) {
  // Un salaire fixe ignore les heures : le calculateur ne lit ni le seuil ni le
  // multiplicateur pour ce type. Les afficher laisserait croire qu'ils pèsent
  // sur le montant.
  const heuresComptent = config.config_type !== "salary";

  // Seules les données réellement portées par la configuration sont affichées :
  // un « — » se lit comme une donnée manquante, alors qu'un forfait n'a par
  // nature ni taux horaire ni seuil.
  const donnees: { label: string; valeur: string; hint?: string; fort?: boolean }[] = [];
  if (config.monthly_salary != null) {
    donnees.push({
      label: "Salaire mensuel",
      valeur: fmtMontant(config.monthly_salary),
      hint: config.annual_salary != null ? `${fmtMontant(config.annual_salary)} / an` : undefined,
      fort: true,
    });
  }
  if (config.default_hourly_rate != null) {
    donnees.push({
      label: "Taux horaire",
      valeur: `${fmtMontant(config.default_hourly_rate)}/h`,
      fort: true,
    });
  }
  if (heuresComptent && config.overtime_threshold != null) {
    donnees.push({ label: "Seuil heures sup.", valeur: `${config.overtime_threshold} h` });
  }
  if (heuresComptent && config.overtime_multiplier != null) {
    donnees.push({ label: "Majoration", valeur: `×${config.overtime_multiplier}` });
  }

  return (
    <Card className={active ? "border-indigo-500/40" : undefined}>
      <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="lg:w-56 shrink-0 min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarRange className="h-4 w-4 text-indigo-500 shrink-0" />
            {active ? "En vigueur" : "Hors période"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {fmtDate(config.effective_from)}
            {config.effective_to ? ` → ${fmtDate(config.effective_to)}` : " → sans fin"}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 min-w-0">
          {donnees.length === 0 ? (
            <span className="text-sm text-muted-foreground col-span-full">
              Aucun montant paramétré sur cette configuration.
            </span>
          ) : (
            donnees.map((d) => (
              <Donnee key={d.label} label={d.label} valeur={d.valeur} hint={d.hint} fort={d.fort} />
            ))
          )}
        </div>

        <div className="shrink-0">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
              TYPE_STYLES[config.config_type] ?? "bg-muted text-muted-foreground border-border"
            }`}
          >
            {TYPE_LABELS[config.config_type] ?? config.config_type}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Donnee({
  label,
  valeur,
  hint,
  fort,
}: {
  label: string;
  valeur: string;
  hint?: string;
  fort?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 break-words ${fort ? "font-semibold" : ""}`}>{valeur}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}
