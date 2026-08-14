"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Loader2, Banknote, Coins, Percent, Wallet, Users } from "lucide-react";
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
import { useOwnerFinancesPro, buildQueryString } from "@/lib/hooks/use-owner-finances-pro";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import { StatCard } from "@/components/owner/charts/StatCard";
import { ChartCard } from "@/components/owner/charts/ChartCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import { DonutChartCard } from "@/components/owner/charts/DonutChartCard";
import { FiliereFilter } from "@/components/owner/charts/FiliereFilter";
import {
  VIZ_SEQUENTIAL,
  VIZ_STATUS,
  formatFcfa,
  formatFcfaCompact,
  formatPct,
  recoveryColor,
} from "@/components/owner/charts/palette";
import type {
  OwnerFinancesProMode,
  OwnerFinancesProPeriod,
} from "@ecoledigitale/contracts";

const ALL = "__all__";

const PERIOD_LABELS: Record<OwnerFinancesProPeriod, string> = {
  month: "Mois en cours",
  quarter: "Trimestre en cours",
  year: "Année civile en cours",
  academic_year: "Année scolaire",
  custom: "Période personnalisée",
};

const MODE_LABELS: Record<OwnerFinancesProMode, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  autre: "Autre",
};

const ETAT_LABELS = {
  tous: "Non soldés (défaut)",
  non_regle: "Aucun règlement",
  partiel: "Règlement partiel",
  solde: "Soldés",
} as const;

export default function OwnerFinancesProfessionnelPage() {
  const [mode, setMode] = useState<string>(ALL);
  const [etat, setEtat] = useState<keyof typeof ETAT_LABELS>("tous");

  // Période, année et filières viennent du filtre global ; mode de règlement et
  // état de règlement restent propres à cet écran.
  const {
    period: globalPeriod,
    anneeScolaire,
    filiereIds,
    dateDebut,
    dateFin,
  } = useOwnerFilters();

  const params = useMemo(() => {
    // « Année scolaire » dans la barre globale désigne la fenêtre de l'année
    // académique — `academic_year` dans le vocabulaire de cet endpoint.
    const period: OwnerFinancesProPeriod =
      globalPeriod === "year" ? "academic_year" : (globalPeriod as OwnerFinancesProPeriod);
    return {
      period,
      dateDebut: period === "custom" ? dateDebut : undefined,
      dateFin: period === "custom" ? dateFin : undefined,
      anneeScolaire,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      mode: mode === ALL ? undefined : (mode as OwnerFinancesProMode),
      etat,
    };
  }, [globalPeriod, dateDebut, dateFin, anneeScolaire, filiereIds, mode, etat]);

  const { data, isLoading, error } = useOwnerFinancesPro(params);

  const monthlyRows = useMemo(
    () =>
      data
        ? data.monthlyCollections.map((m) => ({
            mois: m.month,
            montant: m.amount,
            transactions: m.transactionCount,
          }))
        : [],
    [data]
  );

  const funnelRows = useMemo(() => {
    if (!data) return [];
    const f = data.enrollmentFunnel;
    return [
      { etape: "Créées", valeur: f.created },
      { etape: "Confirmées", valeur: f.confirmed },
      { etape: "Terminées", valeur: f.completed },
      { etape: "Annulées", valeur: f.cancelled },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement du recouvrement…
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
          <h2 className="text-xl font-semibold tracking-tight">
            Recouvrement — Module professionnel
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Inscriptions aux UE, du {data.periodStart} au {data.periodEnd}. Complète la page
            Finances, qui ne couvre que la scolarité du module académique.
          </p>
        </div>
        <ExportCsvButton
          endpoint="/api/v1/owner/finances/professionnel/export"
          queryString={buildQueryString(params)}
          filename="recouvrement-professionnel.csv"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        {/* Période, année et filières sont portées par la barre globale. */}
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Mode de règlement</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous</SelectItem>
                {Object.entries(MODE_LABELS).map(([k, v]) => (
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
        <StatCard
          label="Chiffre d'affaires attendu"
          value={formatFcfa(data.totals.expected)}
          hint="Commandes hors annulées"
          icon={Banknote}
        />
        <StatCard
          label="Encaissé"
          value={formatFcfa(data.totals.collected)}
          hint="Paiements confirmés uniquement"
          icon={Coins}
        />
        <StatCard
          label="Taux de recouvrement"
          value={formatPct(data.totals.recoveryRate)}
          hint="Encaissé / attendu"
          icon={Percent}
        />
        <StatCard
          label="Reste à recouvrer"
          value={formatFcfa(data.totals.outstanding)}
          hint="Sur la cohorte de la période"
          icon={Wallet}
          deltaPolarity="lower-is-better"
        />
        <StatCard
          label="Étudiants non soldés"
          value={String(data.totals.unsettledStudents)}
          hint="Reste dû supérieur à 0,5 FCFA"
          icon={Users}
          deltaPolarity="lower-is-better"
        />
      </div>

      <Card className="border-amber-200/80 bg-amber-50/40 dark:bg-amber-950/20">
        <CardContent className="py-4 text-sm">
          <p>
            <span className="font-medium">Écart assumé avec l&apos;écran admin.</span> Les UE
            « Conduite » sont <span className="font-medium">incluses</span> ici — c&apos;est du
            chiffre d&apos;affaires réellement facturé et encaissé — alors que l&apos;écran
            <span className="whitespace-nowrap"> Paiements</span> du module professionnel les
            exclut. Les deux totaux peuvent donc légitimement différer.
          </p>
          <p className="mt-2 text-muted-foreground">
            L&apos;encaissé est toujours calculé à partir des lignes de paiement confirmées :
            une commande au statut « payée » ne prouve à elle seule aucun encaissement.
          </p>
        </CardContent>
      </Card>

      {/* Deux mesures d'échelles différentes : deux graphiques, jamais deux axes
          verticaux sur le même tracé — la comparaison visuelle y serait arbitraire. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <BarChartCard
          className="lg:col-span-2"
          title="Encaissements mensuels"
          subtitle="12 mois glissants, toutes cohortes confondues — indépendant du filtre de période ci-dessus."
          data={monthlyRows}
          categoryKey="mois"
          height={280}
          series={[{ key: "montant", label: "Encaissé", color: VIZ_SEQUENTIAL[2] }]}
          valueFormatter={formatFcfa}
          axisFormatter={formatFcfaCompact}
        />

        <LineChartCard
          className="lg:col-span-2"
          title="Transactions mensuelles"
          subtitle="Règlements distincts, et non lignes de paiement : un règlement unique touchant plusieurs commandes génère plusieurs lignes mais reste une seule transaction."
          data={monthlyRows}
          categoryKey="mois"
          height={200}
          series={[{ key: "transactions", label: "Transactions", color: VIZ_SEQUENTIAL[1] }]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DonutChartCard
          title="Répartition par mode de règlement"
          slices={data.byPaymentMode.map((m) => ({
            key: m.mode,
            label: MODE_LABELS[m.mode],
            value: m.amount,
          }))}
          valueFormatter={formatFcfa}
          centerLabel="encaissé"
          centerValue={formatFcfaCompact(data.totals.collected)}
        />

        <BarChartCard
          title="Recouvrement par filière"
          subtitle="Attendu réparti au prorata des inscriptions : une commande peut porter des UE de plusieurs filières."
          data={data.recoveryByFiliere.map((r) => ({
            filiere: r.filiereName,
            taux: r.recoveryRate,
          }))}
          categoryKey="filiere"
          orientation="horizontal"
          height={Math.max(220, data.recoveryByFiliere.length * 28 + 60)}
          series={[{ key: "taux", label: "Taux de recouvrement", color: VIZ_STATUS.good }]}
          colorByRow={(row) => recoveryColor(Number(row.taux))}
          valueFormatter={(v) => formatPct(v)}
          axisFormatter={(v) => `${v} %`}
          footnote="Vert : au moins 80 %. Ambre : au moins 60 %. Rouge : en dessous."
        />

        <BarChartCard
          title="Chiffre d'affaires par UE"
          subtitle="Somme des prix figés à l'inscription, et non le tarif courant de l'UE multiplié par l'effectif."
          data={data.revenueByUe.map((u) => ({
            ue: `${u.code} — ${u.libelle}`,
            ca: u.revenue,
          }))}
          categoryKey="ue"
          orientation="horizontal"
          height={Math.max(220, data.revenueByUe.length * 26 + 60)}
          series={[{ key: "ca", label: "CA", color: VIZ_SEQUENTIAL[2] }]}
          valueFormatter={formatFcfa}
          axisFormatter={formatFcfaCompact}
        />

        <ChartCard
          title="Entonnoir des inscriptions"
          subtitle="Sur la cohorte de commandes de la période."
          isEmpty={data.enrollmentFunnel.created === 0}
        >
          <ul className="space-y-3">
            {funnelRows.map((step) => {
              const base = data.enrollmentFunnel.created || 1;
              const share = Math.round((step.valeur * 1000) / base) / 10;
              return (
                <li key={step.etape} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{step.etape}</span>
                    <span className="tabular-nums">
                      {step.valeur}
                      <span className="text-muted-foreground"> · {formatPct(share)}</span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, share)}%`,
                        background:
                          step.etape === "Annulées" ? VIZ_STATUS.critical : VIZ_SEQUENTIAL[2],
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </ChartCard>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Impayés</CardTitle>
              <p className="text-xs text-muted-foreground font-normal mt-1">
                20 restes à recouvrer les plus élevés.
              </p>
            </div>
            <div className="w-56 shrink-0">
              <Select
                value={etat}
                onValueChange={(v) => setEtat(v as keyof typeof ETAT_LABELS)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ETAT_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Étudiant</TableHead>
                <TableHead>Matricule</TableHead>
                <TableHead>Filières</TableHead>
                <TableHead className="text-right">Dû</TableHead>
                <TableHead className="text-right">Payé</TableHead>
                <TableHead className="text-right">Reste</TableHead>
                <TableHead className="text-right">Depuis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topUnpaid.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground text-sm">
                    Aucun étudiant dans cet état de règlement sur la période.
                  </TableCell>
                </TableRow>
              ) : (
                data.topUnpaid.map((s) => (
                  <TableRow key={s.studentId}>
                    <TableCell className="font-medium">{s.studentName}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {s.matricule ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.filiereNames ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(s.due)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(s.paid)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatFcfa(s.outstanding)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {s.oldestUnpaidAt ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            Pour encaisser un règlement, rendez-vous sur{" "}
            <Link
              href="/professionnel/admin/paiements"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Paiements du module professionnel
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
