"use client";

import { useMemo, useState } from "react";
import { Loader2, Inbox, CheckCheck, Timer, Hourglass } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { useOwnerRecrutement, buildQueryString } from "@/lib/hooks/use-owner-recrutement";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { StatCard } from "@/components/owner/charts/StatCard";
import { ChartCard } from "@/components/owner/charts/ChartCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import { DonutChartCard } from "@/components/owner/charts/DonutChartCard";
import {
  VIZ_SERIES,
  VIZ_SEQUENTIAL,
  VIZ_STATUS,
  formatPct,
} from "@/components/owner/charts/palette";

const ALL = "__all__";

const STATUS_LABELS = {
  pending: "En attente",
  approved: "Validée",
  rejected: "Rejetée",
} as const;

const STATUS_COLORS = {
  pending: VIZ_STATUS.warning,
  approved: VIZ_STATUS.good,
  rejected: VIZ_STATUS.critical,
} as const;

export default function OwnerRecrutementPage() {
  const [dateDebut, setDateDebut] = useState<string>("");
  const [dateFin, setDateFin] = useState<string>("");
  const [accountType, setAccountType] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  const params = useMemo(
    () => ({
      dateDebut: dateDebut || undefined,
      dateFin: dateFin || undefined,
      accountType:
        accountType === ALL ? undefined : (accountType as "student" | "parent"),
      status:
        status === ALL
          ? undefined
          : (status as "pending" | "approved" | "rejected"),
    }),
    [dateDebut, dateFin, accountType, status]
  );

  const { data, isLoading, error } = useOwnerRecrutement(params);

  const funnelSteps = useMemo(() => {
    if (!data) return [];
    const f = data.funnel;
    return [
      { label: "Demandes reçues", value: f.received },
      { label: "Validées", value: f.approved },
      { label: "Comptes créés", value: f.accountsCreated },
      { label: "Identifiants générés", value: f.credentialsIssued },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement du recrutement…
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

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Recrutement en ligne</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Demandes d&apos;inscription déposées depuis le site public, du {data.dateDebut} au{" "}
            {data.dateFin}.
          </p>
        </div>
        <ExportCsvButton
          endpoint="/api/v1/owner/recrutement/export"
          queryString={buildQueryString(params)}
          filename="recrutement.csv"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="rec-debut">Du</Label>
            <Input
              id="rec-debut"
              type="date"
              value={dateDebut}
              max={dateFin || undefined}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rec-fin">Au</Label>
            <Input
              id="rec-fin"
              type="date"
              value={dateFin}
              min={dateDebut || undefined}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Type de compte</Label>
            <Select value={accountType} onValueChange={setAccountType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous</SelectItem>
                <SelectItem value="student">Étudiant</SelectItem>
                <SelectItem value="parent">Parent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Statut</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Demandes reçues"
          value={String(data.kpis.received)}
          icon={Inbox}
        />
        <StatCard
          label="Taux de validation"
          value={formatPct(data.kpis.approvalRate)}
          hint="Hors demandes en attente"
          icon={CheckCheck}
        />
        <StatCard
          label="Délai moyen de traitement"
          value={
            data.kpis.avgProcessingDays === null
              ? "—"
              : `${data.kpis.avgProcessingDays.toFixed(1)} j`
          }
          icon={Timer}
          deltaPolarity="lower-is-better"
        />
        <StatCard
          label="En attente"
          value={String(data.kpis.pending)}
          hint="À traiter"
          icon={Hourglass}
          deltaPolarity="lower-is-better"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Entonnoir d'acquisition"
          subtitle="De la demande déposée jusqu'à la génération des identifiants."
          isEmpty={data.funnel.received === 0}
          footnote="Aucune colonne ne trace l'envoi des identifiants : la dernière étape mesure leur génération, pas leur transmission à la famille."
        >
          <ul className="space-y-3">
            {funnelSteps.map((step) => {
              const base = data.funnel.received || 1;
              const share = Math.round((step.value * 1000) / base) / 10;
              return (
                <li key={step.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{step.label}</span>
                    <span className="tabular-nums">
                      {step.value}
                      <span className="text-muted-foreground"> · {formatPct(share)}</span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, share)}%`,
                        background: VIZ_SEQUENTIAL[2],
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </ChartCard>

        <DonutChartCard
          title="Répartition par statut"
          slices={data.byStatus.map((s) => ({
            key: s.status,
            label: STATUS_LABELS[s.status],
            value: s.count,
            color: STATUS_COLORS[s.status],
          }))}
          centerLabel="demandes"
          centerValue={String(data.kpis.received)}
        />

        <LineChartCard
          className="lg:col-span-2"
          title="Demandes par semaine"
          subtitle="Séries distinctes pour les comptes étudiants et parents."
          data={data.weekly.map((w) => ({
            semaine: w.weekStart.slice(5),
            etudiant: w.student,
            parent: w.parent,
          }))}
          categoryKey="semaine"
          height={260}
          series={[
            { key: "etudiant", label: "Étudiant", color: VIZ_SERIES[0] },
            { key: "parent", label: "Parent", color: VIZ_SERIES[1] },
          ]}
        />

        <BarChartCard
          title="Délai de traitement"
          subtitle="Écart entre le dépôt et la revue de la demande."
          data={data.processingDelays.map((d) => ({
            tranche: d.bucket,
            demandes: d.count,
          }))}
          categoryKey="tranche"
          height={240}
          series={[{ key: "demandes", label: "Demandes", color: VIZ_SEQUENTIAL[2] }]}
        />

        <BarChartCard
          title="Niveaux souhaités"
          subtitle="Champ libre du formulaire public, normalisé pour le regroupement."
          data={data.desiredLevels.map((l) => ({
            niveau: l.level,
            demandes: l.count,
          }))}
          categoryKey="niveau"
          orientation="horizontal"
          height={Math.max(220, data.desiredLevels.length * 26 + 60)}
          series={[{ key: "demandes", label: "Demandes", color: VIZ_SEQUENTIAL[1] }]}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Motifs de rejet</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Regroupés par libellé exact. Des motifs proches mais formulés différemment
            apparaîtront sur des lignes distinctes.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Motif</TableHead>
                <TableHead className="text-right">Occurrences</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rejectionReasons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground text-sm">
                    Aucun motif de rejet renseigné sur la période.
                  </TableCell>
                </TableRow>
              ) : (
                data.rejectionReasons.map((r) => (
                  <TableRow key={r.reason}>
                    <TableCell>{r.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.count}</TableCell>
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
