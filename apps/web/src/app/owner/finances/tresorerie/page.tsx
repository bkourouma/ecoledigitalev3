"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Receipt, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import { DonutChartCard } from "@/components/owner/charts/DonutChartCard";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import {
  formatFcfa,
  formatFcfaCompact,
  seriesColorFor,
  VIZ_SERIES,
  VIZ_STATUS,
} from "@/components/owner/charts/palette";
import {
  buildCashRegisterQuery,
  useOwnerCashRegister,
  useOwnerTresorerie,
} from "@/lib/hooks/use-owner-tresorerie";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";

/**
 * Trésorerie & recouvrement.
 *
 * L'écran répond dans l'ordre : combien nous doit-on et depuis quand (balance
 * âgée) → l'argent rentre-t-il au même rythme que l'an dernier (courbe) → par
 * quel canal (modes) → et qu'est-ce qui cloche dans la caisse (écarts). Le
 * journal de caisse ferme la boucle : c'est la pièce de contrôle exportable.
 */

/* --------------------------------- Outils --------------------------------- */

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Traduction de la période du filtre global en fenêtre de dates et en pas de
 * courbe. Un mois se lit au jour, une année au mois : garder le pas du jour sur
 * 365 points rendrait la courbe illisible.
 */
const PERIOD_WINDOW: Record<string, { days: number; granularity: "day" | "week" | "month" }> = {
  month: { days: 29, granularity: "day" },
  quarter: { days: 89, granularity: "week" },
  year: { days: 364, granularity: "month" },
};

/** Couleurs de la balance âgée : plus la dette vieillit, plus elle est grave. */
const BUCKET_COLOR: Record<string, string> = {
  a_echoir: "var(--viz-muted)",
  j0_30: VIZ_STATUS.good,
  j31_60: VIZ_STATUS.warning,
  j61_90: VIZ_STATUS.serious,
  j90_plus: VIZ_STATUS.critical,
};

/* --------------------------------- Page ----------------------------------- */

export default function OwnerTresoreriePage() {
  // Période et filières viennent du filtre global (barre du layout) : l'écran
  // n'a plus son propre sélecteur, qui aurait fait doublon.
  const { period, dateDebut, dateFin, filiereIds } = useOwnerFilters();

  const filters = useMemo(() => {
    if (period === "custom" && dateDebut && dateFin) {
      // Le pas suit l'amplitude choisie, pour que la courbe reste lisible.
      const span =
        (Date.parse(dateFin) - Date.parse(dateDebut)) / (1000 * 60 * 60 * 24);
      const granularity: "day" | "week" | "month" =
        span <= 45 ? "day" : span <= 200 ? "week" : "month";
      return { dateDebut, dateFin, granularity, filiereIds };
    }
    const w = PERIOD_WINDOW[period] ?? PERIOD_WINDOW.quarter;
    return {
      dateDebut: isoDaysAgo(w.days),
      dateFin: isoDaysAgo(0),
      granularity: w.granularity,
      filiereIds,
    };
  }, [period, dateDebut, dateFin, filiereIds]);

  const { data, isLoading, isError, error, refetch, isFetching } = useOwnerTresorerie(filters);

  const [journalPage, setJournalPage] = useState(1);
  // Changer de période ou de filière change le nombre de pages : rester en
  // page 7 afficherait un tableau vide sans expliquer pourquoi.
  useEffect(() => {
    setJournalPage(1);
  }, [filters]);
  const [journalSearch, setJournalSearch] = useState("");
  const [journalSearchInput, setJournalSearchInput] = useState("");
  const journalFilters = useMemo(
    () => ({ ...filters, search: journalSearch || undefined, page: journalPage, pageSize: 25 }),
    [filters, journalSearch, journalPage]
  );
  const journal = useOwnerCashRegister(journalFilters);

  const agedSeries = useMemo(
    () => [
      { key: "scolaire", label: "Scolarité", color: seriesColorFor("scolaire", ["scolaire", "pro"]) },
      { key: "professionnel", label: "Professionnel", color: seriesColorFor("pro", ["scolaire", "pro"]) },
    ],
    []
  );

  if (isError) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Trésorerie indisponible</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-red-700">
          <p>{error instanceof Error ? error.message : "Chargement impossible."}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  const anomalies = data?.anomalies;
  const hasAnomalies =
    (anomalies?.ordersPaidWithoutPayment.count ?? 0) > 0 ||
    (anomalies?.paymentsWithoutReceipt.count ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* En-tête et période. Le bloc reste monté pendant les rechargements. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/owner/finances"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Finances
          </Link>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Trésorerie &amp; recouvrement</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scolarité et module professionnel consolidés. Le dû à venir n&apos;est jamais compté
            comme du retard.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Période du {new Date(filters.dateDebut).toLocaleDateString("fr-FR")} au{" "}
          {new Date(filters.dateFin).toLocaleDateString("fr-FR")}
        </p>
      </div>

      {/* Écarts de caisse : en tête, parce qu'ils ne devraient pas exister. */}
      {hasAnomalies && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex flex-wrap items-start gap-3 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              {anomalies!.ordersPaidWithoutPayment.count > 0 && (
                <p>
                  <strong>{anomalies!.ordersPaidWithoutPayment.count}</strong> commande(s) marquée(s)
                  « payée » sans aucune ligne de paiement, pour{" "}
                  {formatFcfa(anomalies!.ordersPaidWithoutPayment.amount)}. Chaque ligne est un
                  encaissement fantôme ou une erreur de saisie.
                </p>
              )}
              {anomalies!.paymentsWithoutReceipt.count > 0 && (
                <p>
                  <strong>{anomalies!.paymentsWithoutReceipt.count}</strong> encaissement(s) sans
                  numéro de reçu depuis plus de 48 heures, pour{" "}
                  {formatFcfa(anomalies!.paymentsWithoutReceipt.amount)}.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Totaux */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Encaissé sur la période", value: data?.totals.collected, tone: VIZ_STATUS.good },
          { label: "Attendu sur la période", value: data?.totals.expected, tone: undefined },
          { label: "Reste à recouvrer", value: data?.totals.outstanding, tone: undefined },
          {
            label: "dont échu",
            value: data?.totals.outstandingEchu,
            tone: VIZ_STATUS.critical,
          },
        ].map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</div>
              <div
                className="mt-1 text-2xl font-semibold tabular-nums"
                style={t.tone ? { color: t.tone } : undefined}
              >
                {isLoading && data === undefined ? "…" : formatFcfa(t.value ?? 0)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data && (
        <>
          {/* Balance âgée */}
          <div className="grid gap-6 lg:grid-cols-2">
            <BarChartCard
              title="Balance âgée"
              subtitle="Reste à recouvrer par ancienneté. La probabilité de recouvrement s'effondre après 90 jours."
              data={data.agedBalance as unknown as Record<string, unknown>[]}
              categoryKey="label"
              series={agedSeries}
              stacked
              height={280}
              valueFormatter={formatFcfa}
              axisFormatter={formatFcfaCompact}
              footnote={
                data.proDefaultScheduleShare > 0 ? (
                  <span>
                    {data.proDefaultScheduleShare.toFixed(0)} % des commandes professionnelles
                    utilisent encore l&apos;échéance par défaut créée à la migration : leur
                    ancienneté est une convention (exigible à l&apos;ouverture de la cohorte), pas
                    une échéance négociée.
                  </span>
                ) : undefined
              }
            />

            <DonutChartCard
              title="Encaissements par mode"
              subtitle="Module professionnel, sur la période. Sert à négocier les frais Mobile Money et à sécuriser le circuit espèces."
              slices={data.byPaymentMode.map((m, i) => ({
                key: m.mode,
                label: m.label,
                value: m.amount,
                color: VIZ_SERIES[i % VIZ_SERIES.length],
              }))}
              valueFormatter={formatFcfa}
              centerLabel="Encaissé"
              centerValue={formatFcfa(
                data.byPaymentMode.reduce((s, m) => s + m.amount, 0)
              )}
            />
          </div>

          {/* Courbe de trésorerie */}
          <LineChartCard
            title="Courbe de trésorerie"
            subtitle="Encaissements de la période, comparés à la même saison l'an dernier — le calendrier scolaire est trop saisonnier pour qu'un écart au mois précédent veuille dire quelque chose."
            data={data.cashflow as unknown as Record<string, unknown>[]}
            categoryKey="label"
            series={[
              { key: "total", label: "Encaissé", color: VIZ_SERIES[0] },
              { key: "totalAnneePrecedente", label: "Même période N-1", color: VIZ_SERIES[1] },
            ]}
            height={300}
            valueFormatter={formatFcfa}
            axisFormatter={formatFcfaCompact}
          />

          {/* Balance âgée par filière */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Impayés par filière</CardTitle>
              <p className="text-sm text-muted-foreground">
                Classées par dette échue : c&apos;est elle qui appelle une relance, pas le dû à
                venir.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filière</TableHead>
                    <TableHead className="text-right">À échoir</TableHead>
                    <TableHead className="text-right">1-30 j</TableHead>
                    <TableHead className="text-right">31-60 j</TableHead>
                    <TableHead className="text-right">61-90 j</TableHead>
                    <TableHead className="text-right">&gt; 90 j</TableHead>
                    <TableHead className="text-right">Total échu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.agedByFiliere.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-sm text-muted-foreground">
                        Aucun impayé sur le périmètre.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.agedByFiliere.map((f) => (
                      <TableRow key={f.filiereId ?? f.filiereName}>
                        <TableCell className="font-medium">{f.filiereName}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {formatFcfa(f.aEchoir)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatFcfa(f.j0_30)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatFcfa(f.j31_60)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatFcfa(f.j61_90)}</TableCell>
                        <TableCell
                          className="text-right font-medium tabular-nums"
                          style={f.j90Plus > 0 ? { color: BUCKET_COLOR.j90_plus } : undefined}
                        >
                          {formatFcfa(f.j90Plus)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatFcfa(f.totalEchu)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Journal de caisse */}
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Receipt className="h-4 w-4" />
                  Journal de caisse
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Reçus émis sur la période — pièce de contrôle interne et d&apos;audit.{" "}
                  {journal.data
                    ? `${journal.data.totalCount} encaissement(s), ${formatFcfa(journal.data.totalAmount)} au total.`
                    : ""}
                </p>
              </div>
              <ExportCsvButton
                endpoint="/api/v1/owner/tresorerie/journal"
                queryString={buildCashRegisterQuery({ ...journalFilters, page: undefined }) + "&format=csv"}
                filename={`journal-de-caisse-${filters.dateDebut}_${filters.dateFin}.csv`}
                label="Exporter le journal"
              />
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setJournalPage(1);
                  setJournalSearch(journalSearchInput);
                }}
              >
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Étudiant, matricule, n° de reçu…"
                    value={journalSearchInput}
                    onChange={(e) => setJournalSearchInput(e.target.value)}
                    aria-label="Rechercher dans le journal de caisse"
                  />
                </div>
                <Button type="submit" variant="outline" size="sm">
                  Rechercher
                </Button>
              </form>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Reçu</TableHead>
                      <TableHead>Étudiant</TableHead>
                      <TableHead>Filière</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!journal.data || journal.data.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-sm text-muted-foreground">
                          {journal.isLoading
                            ? "Chargement…"
                            : "Aucun encaissement sur cette période."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      journal.data.rows.map((r) => (
                        <TableRow key={r.paymentId}>
                          <TableCell className="whitespace-nowrap">
                            {new Date(r.paidAt).toLocaleDateString("fr-FR")}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.receiptNumber ?? (
                              <span
                                className="text-red-600"
                                title="Encaissement sans numéro de reçu"
                              >
                                manquant
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{r.studentName}</div>
                            {r.matricule && (
                              <div className="font-mono text-xs text-muted-foreground">
                                {r.matricule}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.filiereName ?? "—"}
                          </TableCell>
                          <TableCell>{r.modeLabel}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatFcfa(r.amount)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {journal.data && journal.data.totalCount > journal.data.pageSize && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {(journal.data.page - 1) * journal.data.pageSize + 1}–
                    {Math.min(
                      journal.data.page * journal.data.pageSize,
                      journal.data.totalCount
                    )}{" "}
                    sur {journal.data.totalCount}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={journalPage <= 1}
                      onClick={() => setJournalPage((p) => Math.max(1, p - 1))}
                    >
                      Précédent
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={journalPage * journal.data.pageSize >= journal.data.totalCount}
                      onClick={() => setJournalPage((p) => p + 1)}
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Données au {new Date(data.computedAt).toLocaleString("fr-FR")}
            {isFetching ? " · actualisation en cours" : ""}. Le journal ne dit pas qui a encaissé :{" "}
            <code>professional_payments</code> ne stocke pas l&apos;auteur de la saisie.
          </p>
        </>
      )}
    </div>
  );
}
