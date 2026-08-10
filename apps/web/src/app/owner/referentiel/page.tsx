"use client";

import { useMemo, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
  Layers,
  BookOpen,
  Library,
  GitMerge,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOwnerReferentiel } from "@/lib/hooks/use-owner-referentiel";
import { useOwnerStatsFilters } from "@/lib/hooks/use-owner-stats-filters";
import { StatCard } from "@/components/owner/charts/StatCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { FiliereFilter } from "@/components/owner/charts/FiliereFilter";
import { VIZ_SEQUENTIAL } from "@/components/owner/charts/palette";
import { cn } from "@/lib/utils";
import type {
  OwnerReferentielIssue,
  OwnerUeCategorie,
} from "@ecoledigitale/contracts";

const ALL = "__all__";

const CATEGORIE_LABELS: Record<OwnerUeCategorie, string> = {
  fondamentale: "Fondamentale",
  specialite: "Spécialité",
  culture_generale: "Culture générale",
};

type IssueKind = OwnerReferentielIssue["kind"];

/**
 * Ordre d'affichage = ordre de gravité. Chaque entrée dit ce qui casse
 * concrètement : un panneau d'anomalies sans conséquence énoncée ne se traite pas.
 */
const ISSUE_META: Record<
  IssueKind,
  { title: string; consequence: string; severity: "critical" | "warning" | "info" }
> = {
  ecue_credits_null: {
    title: "ECUE sans crédits",
    consequence:
      "La moyenne d'UE pondère par les crédits des ECUE : une ECUE sans crédit est silencieusement ignorée dans le calcul.",
    severity: "critical",
  },
  ue_without_ecue: {
    title: "UE sans aucune ECUE",
    consequence: "Aucune moyenne ne peut être calculée pour cette UE.",
    severity: "critical",
  },
  ecue_without_teacher: {
    title: "ECUE obligatoire sans enseignant",
    consequence:
      "La session est ouverte aux inscriptions alors que l'ECUE n'a personne pour l'assurer.",
    severity: "critical",
  },
  ue_nb_uv_mismatch: {
    title: "Nombre d'UV incohérent avec les crédits",
    consequence:
      "Le nombre d'UV affiché ne correspond pas à la somme des crédits des ECUE, qui est la valeur réellement utilisée en pondération. L'écran affiche donc autre chose que ce qui est calculé.",
    severity: "warning",
  },
  ecue_orphan: {
    title: "ECUE rattachée à aucune UE",
    consequence: "Elle n'apparaît dans aucun parcours pédagogique.",
    severity: "warning",
  },
  semestre_without_session: {
    title: "Semestre sans session",
    consequence: "Aucun bulletin ne pourra être généré pour ce semestre.",
    severity: "warning",
  },
  ue_price_zero: {
    title: "UE active à prix nul",
    consequence: "L'inscription ne génèrera aucun chiffre d'affaires.",
    severity: "warning",
  },
  course_orphan: {
    title: "Matière académique orpheline",
    consequence:
      "Sans filière ou sans type de bilan, elle est invisible dans l'API des matières et n'apparaît nulle part dans l'interface.",
    severity: "warning",
  },
  ue_nb_uv_zero: {
    title: "UE avec un nombre d'UV à zéro",
    consequence:
      "Valeur jamais renseignée : le formulaire de création force zéro par défaut.",
    severity: "info",
  },
};

const ISSUE_ORDER: IssueKind[] = [
  "ecue_credits_null",
  "ue_without_ecue",
  "ecue_without_teacher",
  "ue_nb_uv_mismatch",
  "ecue_orphan",
  "semestre_without_session",
  "ue_price_zero",
  "course_orphan",
  "ue_nb_uv_zero",
];

const SEVERITY_STYLES = {
  critical: "border-red-300/70 bg-red-50/50 dark:bg-red-950/20",
  warning: "border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/20",
  info: "border-border bg-muted/30",
} as const;

export default function OwnerReferentielPage() {
  const [cycleId, setCycleId] = useState<string>(ALL);
  const [filiereIds, setFiliereIds] = useState<string[]>([]);
  const [categorie, setCategorie] = useState<string>(ALL);

  const { data: filters } = useOwnerStatsFilters();

  const params = useMemo(
    () => ({
      cycleId: cycleId === ALL ? undefined : cycleId,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      categorie: categorie === ALL ? undefined : (categorie as OwnerUeCategorie),
    }),
    [cycleId, filiereIds, categorie]
  );

  const { data, isLoading, error } = useOwnerReferentiel(params);

  // Les cycles ne sont pas exposés tels quels par le référentiel de filtres :
  // on les dérive des filières, qui portent leur libellé de cycle.
  const cycleOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of filters?.filieres ?? []) {
      if (f.cycleName && !seen.has(f.cycleName)) seen.set(f.cycleName, f.cycleName);
    }
    return [...seen.keys()].sort();
  }, [filters]);

  const grouped = useMemo(() => {
    if (!data) return [];
    return ISSUE_ORDER.map((kind) => ({
      kind,
      meta: ISSUE_META[kind],
      rows: data.issues.filter((i) => i.kind === kind),
    })).filter((g) => g.rows.length > 0);
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Analyse du référentiel…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-700">
          {error instanceof Error ? error.message : "Impossible de charger les données."}
        </CardContent>
      </Card>
    );
  }

  const totalIssues = data.issues.length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Santé du référentiel</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Vue transversale cycle → filière → UE → ECUE. Les totaux portent sur
          l&apos;ensemble du catalogue, contrairement aux compteurs des pages Cycles,
          Filières et Matières, qui ne comptent que la page affichée.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Cycle</Label>
            <Select value={cycleId} onValueChange={setCycleId} disabled={cycleOptions.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Tous" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous</SelectItem>
                {cycleOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Filières</Label>
            <FiliereFilter
              filieres={filters?.filieres ?? []}
              value={filiereIds}
              onChange={setFiliereIds}
            />
          </div>
          <div className="space-y-2">
            <Label>Catégorie d&apos;UE</Label>
            <Select value={categorie} onValueChange={setCategorie}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes</SelectItem>
                {Object.entries(CATEGORIE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Cycles actifs" value={String(data.kpis.activeCycles)} icon={Layers} />
        <StatCard
          label="Filières actives"
          value={String(data.kpis.activeFilieres)}
          icon={BookOpen}
        />
        <StatCard label="UE actives" value={String(data.kpis.activeUe)} icon={Library} />
        <StatCard label="ECUE actives" value={String(data.kpis.activeEcue)} icon={Library} />
        <StatCard
          label="Crédits par semestre"
          value={
            data.kpis.avgCreditsPerSemestre === null
              ? "—"
              : data.kpis.avgCreditsPerSemestre.toFixed(1)
          }
          hint="Moyenne des Σ crédits ECUE"
          icon={GitMerge}
        />
      </div>

      {/* Le panneau d'incohérences est la vraie valeur de cet écran. */}
      <Card
        className={cn(
          totalIssues === 0
            ? "border-emerald-300/70 bg-emerald-50/50 dark:bg-emerald-950/20"
            : undefined
        )}
      >
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {totalIssues === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
            )}
            Incohérences détectées
            {totalIssues > 0 ? (
              <span className="text-sm font-normal text-muted-foreground">
                — {totalIssues} au total
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {totalIssues === 0 ? (
            <p className="text-sm">
              Aucune incohérence structurelle sur ce périmètre. Les crédits, les
              rattachements UE / ECUE et les affectations d&apos;enseignants sont cohérents.
            </p>
          ) : (
            grouped.map((g) => (
              <div
                key={g.kind}
                className={cn("rounded-lg border p-4", SEVERITY_STYLES[g.meta.severity])}
              >
                <div className="flex items-start gap-2">
                  {g.meta.severity === "info" ? (
                    <Info className="h-4 w-4 mt-0.5 shrink-0 opacity-70" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 opacity-70" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {g.meta.title}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {g.rows.length}
                        {g.rows.length === 50 ? "+" : ""}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {g.meta.consequence}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {g.rows.slice(0, 8).map((r) => (
                        <li key={`${r.kind}-${r.id}-${r.detail ?? ""}`} className="flex flex-wrap gap-x-2">
                          <span className="font-medium">{r.label}</span>
                          {r.filiereName ? (
                            <span className="text-muted-foreground">· {r.filiereName}</span>
                          ) : null}
                          {r.detail ? (
                            <span className="text-muted-foreground">· {r.detail}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {g.rows.length > 8 ? (
                      <p className="text-xs text-muted-foreground mt-2">
                        … et {g.rows.length - 8} autre{g.rows.length - 8 > 1 ? "s" : ""}.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filières</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            « UV déclarés » est la valeur saisie sur l&apos;UE ; « Crédits » est la somme
            des crédits des ECUE, seule valeur utilisée en pondération. Un écart entre
            les deux colonnes est remonté ci-dessus.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filière</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Domaine</TableHead>
                <TableHead className="text-right">Semestres</TableHead>
                <TableHead className="text-right">UE</TableHead>
                <TableHead className="text-right">ECUE</TableHead>
                <TableHead className="text-right">UV déclarés</TableHead>
                <TableHead className="text-right">Crédits</TableHead>
                <TableHead className="text-right">Étudiants</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.filieres.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground text-sm">
                    Aucune filière sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                data.filieres.map((f) => {
                  const mismatch = f.sumNbUv > 0 && f.sumNbUv !== f.sumCredits;
                  return (
                    <TableRow key={f.filiereId}>
                      <TableCell className="font-medium">{f.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.cycleName ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.domaine ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.semestreCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{f.ueCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.ecueCount}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          mismatch && "text-amber-700 dark:text-amber-400 font-medium"
                        )}
                      >
                        {f.sumNbUv}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{f.sumCredits}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.studentCount}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BarChartCard
        title="Mutualisation des ECUE"
        subtitle="Nombre d'UE réutilisant chaque ECUE. Seules les ECUE partagées par au moins deux UE sont listées."
        data={data.ecueMutualisation.map((e) => ({
          ecue: `${e.code} — ${e.libelle}`,
          ue: e.ueCount,
        }))}
        categoryKey="ecue"
        orientation="horizontal"
        height={Math.max(220, data.ecueMutualisation.length * 26 + 60)}
        series={[{ key: "ue", label: "UE", color: VIZ_SEQUENTIAL[2] }]}
      />
    </div>
  );
}
