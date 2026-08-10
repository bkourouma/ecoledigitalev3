"use client";

import { useMemo, useState } from "react";
import { Loader2, Award, GaugeCircle, GraduationCap, RefreshCcw, FileCheck2 } from "lucide-react";
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
import { useOwnerPedagogie, buildQueryString } from "@/lib/hooks/use-owner-pedagogie";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { useOwnerStatsFilters } from "@/lib/hooks/use-owner-stats-filters";
import { StatCard } from "@/components/owner/charts/StatCard";
import { ChartCard } from "@/components/owner/charts/ChartCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import { FiliereFilter } from "@/components/owner/charts/FiliereFilter";
import {
  VIZ_STATUS,
  VIZ_SEQUENTIAL,
  formatPct,
  seriesColorFor,
  VIZ_MAX_SERIES,
} from "@/components/owner/charts/palette";
import type { OwnerUeCategorie } from "@ecoledigitale/contracts";

const ALL = "__all__";

const CATEGORIE_LABELS: Record<OwnerUeCategorie, string> = {
  fondamentale: "Fondamentale",
  specialite: "Spécialité",
  culture_generale: "Culture générale",
};

export default function OwnerPedagogiePage() {
  const [anneeScolaire, setAnneeScolaire] = useState<string>(ALL);
  const [filiereIds, setFiliereIds] = useState<string[]>([]);
  const [semestreId, setSemestreId] = useState<string>(ALL);
  const [statut, setStatut] = useState<"en_cours" | "termine" | "tous">("tous");
  const [categorie, setCategorie] = useState<string>(ALL);

  const { data: filters } = useOwnerStatsFilters();

  const params = useMemo(
    () => ({
      anneeScolaire: anneeScolaire === ALL ? undefined : anneeScolaire,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      semestreId: semestreId === ALL ? undefined : semestreId,
      statut,
      categorie: categorie === ALL ? undefined : (categorie as OwnerUeCategorie),
    }),
    [anneeScolaire, filiereIds, semestreId, statut, categorie]
  );

  const { data, isLoading, error } = useOwnerPedagogie(params);

  // Ordre de référence des filières : fixé par le référentiel, pas par les données
  // renvoyées — c'est ce qui garantit qu'une filière garde sa couleur quand un
  // filtre en retire d'autres.
  const filiereOrder = useMemo(
    () => (filters?.filieres ?? []).map((f) => f.id),
    [filters]
  );

  // Semestres proposés : restreints aux filières sélectionnées.
  const semestreOptions = useMemo(() => {
    const all = filters?.semestres ?? [];
    if (filiereIds.length === 0) return all;
    return all.filter((s) => filiereIds.includes(s.filiereId));
  }, [filters, filiereIds]);

  /**
   * Pivot pour la courbe multi-séries : une ligne par semestre, une colonne par
   * filière. Ce n'est pas un calcul de KPI — juste une mise en forme du résultat
   * déjà agrégé par SQL.
   */
  const semestreSeries = useMemo(() => {
    if (!data) return { rows: [], series: [] };
    const labels: string[] = [];
    const byLabel = new Map<string, Record<string, unknown>>();
    const filieres = new Map<string, string>();

    for (const r of data.averagesBySemestre) {
      if (!byLabel.has(r.semestreLabel)) {
        byLabel.set(r.semestreLabel, { semestre: r.semestreLabel });
        labels.push(r.semestreLabel);
      }
      byLabel.get(r.semestreLabel)![r.filiereId] = r.averageGrade;
      filieres.set(r.filiereId, r.filiereName);
    }

    const series = [...filieres.entries()]
      .filter(([id]) => filiereOrder.indexOf(id) < VIZ_MAX_SERIES)
      .map(([id, name]) => ({
        key: id,
        label: name,
        color: seriesColorFor(id, filiereOrder),
      }));

    return { rows: labels.map((l) => byLabel.get(l)!), series };
  }, [data, filiereOrder]);

  const failedRows = useMemo(() => {
    if (!data) return [];
    return data.topFailedEcue.map((e) => ({
      label: `${e.code} — ${e.libelle}`,
      // Segments disjoints : leur somme vaut `failed`, sinon on compterait
      // deux fois les notes éliminatoires.
      echecs: e.failed - e.eliminated,
      eliminatoires: e.eliminated,
      failRate: e.failRate,
      evaluated: e.evaluated,
    }));
  }, [data]);

  const distributionRows = useMemo(
    () => (data ? data.gradeDistribution.map((d) => ({ tranche: d.bucket, effectif: d.count })) : []),
    [data]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement du pilotage pédagogique…
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

  const noBulletins = data.kpis.bulletinCount === 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Pilotage pédagogique</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Module professionnel (LMD), toutes filières confondues. Les indicateurs sont
            agrégés en base : ils portent sur l&apos;ensemble du périmètre, pas sur une page.
          </p>
        </div>
        <ExportCsvButton
          endpoint="/api/v1/owner/pedagogie/export"
          queryString={buildQueryString(params)}
          filename="pilotage-pedagogique.csv"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-2">
            <Label>Année scolaire</Label>
            <Select value={anneeScolaire} onValueChange={setAnneeScolaire}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes</SelectItem>
                {(filters?.anneesScolaires ?? []).map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
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
              onChange={(next) => {
                setFiliereIds(next);
                setSemestreId(ALL);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Semestre</Label>
            <Select value={semestreId} onValueChange={setSemestreId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous</SelectItem>
                {semestreOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Statut des sessions</Label>
            <Select
              value={statut}
              onValueChange={(v) => setStatut(v as typeof statut)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous</SelectItem>
                <SelectItem value="en_cours">En cours</SelectItem>
                <SelectItem value="termine">Terminées</SelectItem>
              </SelectContent>
            </Select>
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

      {noBulletins ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-6 text-sm">
            Aucun bulletin sur ce périmètre. Les taux de réussite, de rattrapage et de
            crédits sont calculés à partir des bulletins générés — tant qu&apos;aucun
            bulletin n&apos;existe, ces indicateurs restent vides. Les statistiques par
            ECUE ci-dessous, elles, s&apos;appuient sur les résultats saisis.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Taux de réussite"
          value={formatPct(data.kpis.successRate)}
          hint={`${data.kpis.bulletinCount} bulletins`}
          icon={Award}
        />
        <StatCard
          label="Moyenne générale"
          value={`${data.kpis.averageGrade.toFixed(2)} / 20`}
          hint="Moyenne des moyennes de session"
          icon={GraduationCap}
        />
        <StatCard
          label="Crédits validés"
          value={formatPct(data.kpis.creditsRate)}
          hint={`${data.kpis.creditsValidated} / ${data.kpis.creditsTotal} crédits`}
          icon={GaugeCircle}
        />
        <StatCard
          label="Taux de rattrapage"
          value={formatPct(data.kpis.retakeRate)}
          hint="Décision « rattrapage »"
          icon={RefreshCcw}
          deltaPolarity="lower-is-better"
        />
        <StatCard
          label="Bulletins définitifs"
          value={formatPct(data.kpis.finalBulletinRate)}
          hint="Reste en provisoire au-delà"
          icon={FileCheck2}
        />
      </div>

      <BarChartCard
        title="Décisions par filière"
        subtitle="Un semestre est validé quand toutes ses UE le sont — la règle appliquée par le service de bulletins, et non le seuil de 20 crédits."
        data={data.decisionsByFiliere.map((d) => ({
          filiere: d.filiereName,
          admis: d.admis,
          rattrapage: d.rattrapage,
          ajourne: d.ajourne,
        }))}
        categoryKey="filiere"
        stacked
        height={320}
        series={[
          { key: "admis", label: "Admis", color: VIZ_STATUS.good },
          { key: "rattrapage", label: "Rattrapage", color: VIZ_STATUS.warning },
          { key: "ajourne", label: "Ajourné", color: VIZ_STATUS.critical },
        ]}
      />

      <LineChartCard
        title="Évolution de la moyenne par semestre"
        subtitle="Une série par filière. Les semestres sont ordonnés par libellé : la table des semestres ne porte aucune colonne d'ordre."
        data={semestreSeries.rows}
        categoryKey="semestre"
        series={semestreSeries.series}
        yDomain={[0, 20]}
        height={320}
        valueFormatter={(v) => `${v.toFixed(2)} / 20`}
        footnote={
          filiereOrder.length > VIZ_MAX_SERIES
            ? `Seules les ${VIZ_MAX_SERIES} premières filières sont tracées — au-delà, les couleurs ne resteraient pas distinguables. Filtrez pour comparer les autres.`
            : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <BarChartCard
          className="lg:col-span-2"
          title="ECUE les plus échouées"
          subtitle={`Part de résultats non validés. Les ECUE de moins de 5 résultats notés sont écartées, ainsi que la « Conduite ». Une ECUE sans note d'examen est en cours, pas échouée : elle n'entre pas au dénominateur.`}
          data={failedRows}
          categoryKey="label"
          orientation="horizontal"
          stacked
          height={Math.max(240, failedRows.length * 28 + 60)}
          series={[
            { key: "echecs", label: "Échecs (note < 10)", color: VIZ_STATUS.serious },
            { key: "eliminatoires", label: "Éliminatoires (note < 5)", color: VIZ_STATUS.critical },
          ]}
        />

        <ChartCard
          title="Poids de la session 2"
          subtitle="Part des validations d'ECUE obtenues au rattrapage."
          isEmpty={data.session2.validatedTotal === 0}
        >
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">
              {formatPct(data.session2.rate)}
            </span>
            <span className="text-sm text-muted-foreground">
              {data.session2.validatedSession2} sur {data.session2.validatedTotal} validations
            </span>
          </div>
          <div className="mt-3 h-2.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, data.session2.rate))}%`,
                background: VIZ_STATUS.warning,
              }}
            />
          </div>
        </ChartCard>

        <BarChartCard
          title="Distribution des moyennes"
          subtitle="Répartition des moyennes de session. Les seuils métier sont 5 (éliminatoire) et 10 (validation)."
          data={distributionRows}
          categoryKey="tranche"
          height={260}
          series={[{ key: "effectif", label: "Étudiants", color: VIZ_SEQUENTIAL[2] }]}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Santé par UE</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Triée par taux de validation croissant : les UE les plus en difficulté
            remontent en tête. La pondération des ECUE suit leurs crédits — ni le
            coefficient de liaison, ni le nombre d&apos;UV de l&apos;UE.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UE</TableHead>
                <TableHead>Filière</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead className="text-right">Étudiants</TableHead>
                <TableHead className="text-right">Moyenne</TableHead>
                <TableHead className="text-right">Validation</TableHead>
                <TableHead className="text-right">Éliminatoires</TableHead>
                <TableHead className="text-right">Session 2</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ueHealth.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground text-sm">
                    Aucun résultat d&apos;UE sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                data.ueHealth.map((u) => (
                  <TableRow key={u.ueId}>
                    <TableCell className="font-medium">
                      {u.code} — {u.libelle}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.filiereName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.categorie ? CATEGORIE_LABELS[u.categorie] : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.studentCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {u.averageGrade === null ? "—" : u.averageGrade.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(u.validationRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(u.eliminatedRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(u.session2Rate)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
