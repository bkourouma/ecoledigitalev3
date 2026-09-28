"use client";

import { useMemo } from "react";
import { Loader2, Banknote, Coins, Percent, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { StatCard } from "@/components/owner/charts/StatCard";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import { DonutChartCard } from "@/components/owner/charts/DonutChartCard";
import {
  VIZ_SEQUENTIAL,
  formatFcfa,
  formatFcfaCompact,
  recoveryColor,
  seriesColorFor,
} from "@/components/owner/charts/palette";
import { useOwnerFinances, buildQueryString } from "@/lib/hooks/use-owner-finances";
import type { OwnerFinancesResponse } from "@ecoledigitale/contracts";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import { JournalDeCaisse } from "@/components/owner/JournalDeCaisse";
import { fetchCashRegisterPourRapport } from "@/lib/hooks/use-owner-tresorerie";
import { useSession } from "next-auth/react";
import { AlertTriangle } from "lucide-react";
import { jourFr, tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import type { ReportBlock } from "@/lib/utils/report-doc";

/**
 * Encaissements — combien est rentré sur la période, et d'où.
 *
 * L'écran NE DÉCRIT QUE LE MODULE PROFESSIONNEL. Il n'a d'abord lu que la
 * scolarité — zéro encaissement affiché pendant que la caisse encaissait, sur
 * le seul écran qui porte le mot « Encaissements » —, puis il a consolidé les
 * deux moitiés. La scolarité en est maintenant sortie : elle n'est pas saisie
 * ici, et un zéro non mesuré se lit comme une contre-performance.
 *
 * Ce qui a disparu avec elle : la ventilation par cycle et par classe, la liste
 * des échéances scolaires en retard, et la moitié scolaire de chaque total.
 *
 * La masse salariale N'EST PLUS ICI : c'est de l'argent qui sort, et elle a son
 * écran.
 */

/** Taux affiché, ou « non mesuré » quand rien n'est attendu. */
function pct(v: number | null): string {
  return v === null ? "Non mesuré" : `${v.toFixed(1)} %`;
}

type Couverture = OwnerFinancesResponse["couverture"];

type Tableaux = {
  monthly: NonNullable<OwnerFinancesResponse["monthly"]>;
  byFiliere: NonNullable<OwnerFinancesResponse["byFiliere"]>;
  byMode: NonNullable<OwnerFinancesResponse["byMode"]>;
};

/**
 * Couverture du module professionnel, tolérante à une réponse qui ne la porte pas.
 *
 * `couverture` est un ajout récent de l'endpoint. Une réponse servie par une
 * API plus ancienne — API pas encore redémarrée en dev, web déployé avant
 * l'API — ne contient pas ce champ, et l'écran entier tombait alors sur un
 * `undefined` : plus aucun chiffre à l'écran, faute d'une note explicative.
 *
 * À défaut de repère, on ne crie pas « non mesuré » : on considère la source
 * alimentée dès qu'elle porte un montant, attendu ou encaissé. Inventer une
 * alerte sur une donnée absente serait pire que ne rien dire.
 */
function couvertureDe(data: OwnerFinancesResponse | undefined): Couverture {
  const brut = (data as { couverture?: Partial<Couverture> } | undefined)?.couverture;
  if (typeof brut?.professionnelAlimente === "boolean") return brut as Couverture;
  const t = data?.totals;
  return {
    professionnelAlimente: (t?.collected ?? 0) > 0 || (t?.expected ?? 0) > 0,
  };
}

/**
 * Tableaux de l'écran, tolérants à une réponse qui n'en porte pas encore.
 *
 * Même écart de version que `couverture` : `byFiliere` et `byMode` n'existaient
 * pas sur l'ancien endpoint scolaire. Lire `.length` sur `undefined` faisait
 * tomber la page entière dès que les totaux arrivaient.
 */
function tableauxDe(data: OwnerFinancesResponse | undefined): Tableaux {
  return {
    monthly: data?.monthly ?? [],
    byFiliere: data?.byFiliere ?? [],
    byMode: data?.byMode ?? [],
  };
}

export default function OwnerEncaissementsPage() {
  const { anneeScolaire, filiereIds, period } = useOwnerFilters();
  // Le rapport imprimé va chercher le journal lui-même : il lui faut la session.
  const { data: session } = useSession();

  const params = useMemo(
    () => ({
      // « Année scolaire » dans la barre globale désigne la fenêtre de l'année :
      // c'est `academic_year` dans le vocabulaire de cet endpoint.
      period: period === "year" ? ("academic_year" as const) : (period as "month" | "quarter"),
      anneeScolaire,
      filiereIds: (filiereIds?.length ?? 0) > 0 ? filiereIds : undefined,
    }),
    [period, anneeScolaire, filiereIds]
  );

  const { data, isLoading, error, refetch } = useOwnerFinances(params);

  /*
    Le journal de caisse se cale sur LA PÉRIODE AFFICHÉE, et non sur tout
    l'historique : un journal qui déborde des bornes annoncées au-dessus de lui
    n'est plus une pièce de contrôle, c'est une source de contradiction.
    `periodStart`/`periodEnd` sont ceux que l'endpoint a effectivement retenus
    — les recalculer ici ferait diverger les deux moitiés de l'écran au premier
    changement de règle de période.
  */
  const journalFilters = useMemo(
    () => ({
      dateDebut: data?.periodStart?.slice(0, 10),
      dateFin: data?.periodEnd?.slice(0, 10),
      anneeScolaire: anneeScolaire ?? undefined,
      filiereIds: (filiereIds?.length ?? 0) > 0 ? filiereIds : undefined,
    }),
    [data?.periodStart, data?.periodEnd, anneeScolaire, filiereIds]
  );

  const couverture = useMemo(() => couvertureDe(data), [data]);
  const tableaux = useMemo(() => tableauxDe(data), [data]);

  const courbe = useMemo(
    () =>
      tableaux.monthly.map((m) => ({
        mois: m.label,
        professionnel: m.professionnel,
      })),
    [tableaux]
  );

  /**
   * Écart à la même période l'an dernier. Le calendrier scolaire est trop
   * saisonnier pour qu'un écart au mois précédent veuille dire quelque chose :
   * septembre encaisse toujours plus que juillet, ce n'est pas une performance.
   */
  const ecartN1 = useMemo(() => {
    if (!data?.totals || (data.totals.collectedPreviousYear ?? 0) <= 0) return null;
    const d = data.totals.collected - data.totals.collectedPreviousYear;
    return (100 * d) / data.totals.collectedPreviousYear;
  }, [data]);

  /*
     Le rapport est ASYNCHRONE parce qu'il contient plus que l'écran : le
     journal de caisse y entre en entier, quand l'écran le pagine à 25 lignes.
     Une pièce comptable tronquée est pire qu'une pièce absente — mais
     précharger l'intégralité à chaque visite coûterait cher pour un bouton
     parfois jamais pressé. On ne va donc la chercher qu'au clic.
  */
  const construireRapport = async (): Promise<OwnerReportContent> => {
    const d = data!;
    const blocks: ReportBlock[] = [
      {
        kind: "keyValues",
        columns: 2,
        items: [
          ["Fenêtre", `Du ${jourFr(d.periodStart)} au ${jourFr(d.periodEnd)}`],
          ["Encaissé", formatFcfa(d.totals.collected)],
          ["Attendu", formatFcfa(d.totals.expected)],
          ["Taux de recouvrement", pct(d.totals.recoveryRate)],
          ["Même période l'an dernier", formatFcfa(d.totals.collectedPreviousYear)],
        ],
      },
    ];

    // Une source vide n'est pas une source à zéro : c'est une source qu'on ne
    // mesure pas. Sans cette note, le lecteur du PDF conclut à une chute.
    if (!couverture.professionnelAlimente) {
      blocks.push({
        kind: "note",
        text: "Aucune donnée du module professionnel n'est saisie : les montants de ce rapport ne sont pas mesurés, ce ne sont pas des zéros.",
      });
    }

    blocks.push(
      { kind: "heading", text: "Encaissements par mois", level: 1 },
      tableOrNote(
        [
          { header: "Mois" },
          { header: "Encaissé", width: 48, align: "right" },
        ],
        tableaux.monthly.map((m) => [m.label, formatFcfa(m.professionnel)]),
        "Aucun encaissement sur la période.",
        ["Total", formatFcfa(d.totals.collected)]
      ),
      { kind: "heading", text: "Recouvrement par filière", level: 1 },
      tableOrNote(
        [
          { header: "Filière" },
          { header: "Attendu", width: 44, align: "right" },
          { header: "Encaissé", width: 44, align: "right" },
          { header: "Taux", width: 26, align: "right" },
        ],
        tableaux.byFiliere.map((r) => [
          r.filiereName,
          formatFcfa(r.expected),
          formatFcfa(r.collected),
          `${r.recoveryRate.toFixed(1)} %`,
        ]),
        "Aucune commande professionnelle sur la période."
      ),
      {
        kind: "note",
        text: "Une commande peut porter des UE de plusieurs filières : son montant est réparti au prorata du nombre d'inscriptions, pas attribué en totalité à la première.",
      },
      { kind: "heading", text: "Modes de règlement", level: 1 },
      tableOrNote(
        [
          { header: "Mode" },
          { header: "Règlements", width: 36, align: "right" },
          { header: "Montant", width: 46, align: "right" },
        ],
        tableaux.byMode.map((m) => [m.label, String(m.count), formatFcfa(m.amount)]),
        "Aucun encaissement professionnel sur la période."
      ),
    );

    /* Écarts de caisse : ils conditionnent la lecture de tout ce qui précède. */
    if (
      d.anomalies.ordersPaidWithoutPayment.count > 0 ||
      d.anomalies.paymentsWithoutReceipt.count > 0
    ) {
      blocks.push({
        kind: "note",
        text: `Écarts de caisse : ${d.anomalies.ordersPaidWithoutPayment.count} commande(s) « payée » sans ligne de paiement pour ${formatFcfa(
          d.anomalies.ordersPaidWithoutPayment.amount
        )} ; ${d.anomalies.paymentsWithoutReceipt.count} encaissement(s) sans numéro de reçu passé 48 h pour ${formatFcfa(
          d.anomalies.paymentsWithoutReceipt.amount
        )}.`,
      });
    }

    /*
       Le journal, en entier. Si l'endpoint plafonne avant la fin, le rapport le
       DIT : un tableau qui s'arrête sans prévenir se lit comme un journal
       complet, et c'est ainsi qu'on signe une pièce fausse.
    */
    try {
      const journal = await fetchCashRegisterPourRapport(session, journalFilters);
      blocks.push(
        { kind: "heading", text: "Journal de caisse", level: 1 },
        tableOrNote(
          [
            { header: "Date", width: 30 },
            { header: "Reçu", width: 38 },
            { header: "Étudiant" },
            { header: "Filière" },
            { header: "Mode", width: 34 },
            { header: "Montant", width: 44, align: "right" },
          ],
          journal.rows.map((r) => [
            jourFr(r.paidAt),
            r.receiptNumber ?? "manquant",
            r.studentName,
            r.filiereName ?? "—",
            r.modeLabel,
            formatFcfa(r.amount),
          ]),
          "Aucun encaissement sur cette période."
        ),
        {
          kind: "note",
          text: journal.complet
            ? "Journal daté à la date du versement, quand les montants ci-dessus sont rattachés à l'année de la classe ouverte : les deux totaux peuvent différer sans qu'aucun soit faux."
            : `Journal TRONQUÉ : ${journal.rows.length} lignes imprimées sur ${journal.totalCount}. Utiliser l'export CSV pour la totalité.`,
        }
      );
    } catch {
      blocks.push({
        kind: "note",
        text: "Le journal de caisse n'a pas pu être chargé : il ne figure pas dans ce rapport.",
      });
    }

    return { filename: "encaissements", blocks };
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement des encaissements…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
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

  return (
    <div className="space-y-8">
      <OwnerPageHeader
        title="Paiements"
        question="Combien est rentré sur la période, et d'où ?"
        precision={`Du ${jourFr(data.periodStart)} au ${jourFr(
          data.periodEnd
        )}. Module professionnel : règlements confirmés sur commandes d'UE.`}
        pdf={construireRapport}
        csv={{
          endpoint: "/api/v1/owner/reports/financial",
          queryString: `${buildQueryString(params)}&format=csv`,
          filename: "encaissements.csv",
        }}
      />

      {/*
        LES ÉCARTS DE CAISSE PASSENT EN TÊTE. Ils étaient noyés en bas de
        l'écran des Impayés, qui répond pourtant à une tout autre question.
        Le premier des deux peut cacher une perte sèche : adminUpdateEnrollment
        force le statut « payée » sans créer de règlement, donc la commande est
        soldée dans l'application sans que l'argent soit passé par la caisse.
      */}
      {(data.anomalies.ordersPaidWithoutPayment.count > 0 ||
        data.anomalies.paymentsWithoutReceipt.count > 0) && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
          <CardContent className="space-y-1 py-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-red-800 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" />
              Écarts de caisse à vérifier
            </div>
            {data.anomalies.ordersPaidWithoutPayment.count > 0 && (
              <div className="text-red-800 dark:text-red-300">
                <strong>{data.anomalies.ordersPaidWithoutPayment.count}</strong> commande(s)
                marquée(s) « payée » sans aucune ligne de paiement, pour{" "}
                {formatFcfa(data.anomalies.ordersPaidWithoutPayment.amount)} — l&apos;argent
                n&apos;est jamais passé par la caisse.
              </div>
            )}
            {data.anomalies.paymentsWithoutReceipt.count > 0 && (
              <div className="text-red-800 dark:text-red-300">
                <strong>{data.anomalies.paymentsWithoutReceipt.count}</strong> encaissement(s)
                sans numéro de reçu passé 48 h, pour{" "}
                {formatFcfa(data.anomalies.paymentsWithoutReceipt.amount)}.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/*
        Une source sans aucune donnée saisie n'est pas une source à zéro : c'est
        une source qu'on ne mesure pas. Le dire évite qu'un fondateur lise une
        absence de saisie comme un effondrement du chiffre d'affaires.
      */}
      {!couverture.professionnelAlimente && (
        <Card className="border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm">
            <strong>Module professionnel : aucune donnée saisie.</strong> Ni commande ni
            paiement d&apos;UE. Les montants ci-dessous ne sont pas mesurés.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Encaissé sur la période"
          value={formatFcfa(data.totals.collected)}
          icon={Banknote}
          hint="Règlements confirmés sur commandes d'UE"
          delta={ecartN1 ?? undefined}
          deltaSuffix=" %"
        />
        <StatCard
          label="Attendu sur la période"
          value={formatFcfa(data.totals.expected)}
          icon={Coins}
          hint="Commandes non annulées"
        />
        <StatCard
          label="Taux de recouvrement"
          value={pct(data.totals.recoveryRate)}
          icon={Percent}
          hint={`Encaissé / attendu (${formatFcfa(data.totals.expected)})`}
        />
      </div>

      <LineChartCard
        title="Encaissements par mois"
        subtitle="Sur la fenêtre choisie, datés à l'ouverture de la classe."
        footnote={
          data.totals.collectedPreviousYear > 0 ? (
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              {formatFcfa(data.totals.collectedPreviousYear)} sur la même période l&apos;an
              dernier
            </span>
          ) : (
            "Pas d'historique sur la même période l'an dernier."
          )
        }
        data={courbe}
        categoryKey="mois"
        series={[
          {
            key: "professionnel",
            label: "Encaissé",
            color: seriesColorFor("pro", ["pro"]),
          },
        ]}
        valueFormatter={formatFcfa}
        axisFormatter={formatFcfaCompact}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recouvrement par filière</CardTitle>
            <p className="text-sm text-muted-foreground">
              Une commande peut porter des UE de plusieurs filières : son montant est réparti
              au prorata des inscriptions.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filière</TableHead>
                  <TableHead className="text-right">Attendu</TableHead>
                  <TableHead className="text-right">Encaissé</TableHead>
                  <TableHead className="text-right">Taux</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableaux.byFiliere.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      Aucune commande professionnelle sur la période.
                    </TableCell>
                  </TableRow>
                ) : (
                  tableaux.byFiliere.map((r) => (
                    <TableRow key={r.filiereId ?? r.filiereName}>
                      <TableCell className="font-medium">{r.filiereName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatFcfa(r.expected)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatFcfa(r.collected)}
                      </TableCell>
                      <TableCell
                        className="text-right font-medium tabular-nums"
                        style={{ color: recoveryColor(r.recoveryRate) }}
                      >
                        {r.recoveryRate.toFixed(1)} %
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <DonutChartCard
        title="Modes de règlement"
        subtitle="Module professionnel, sur la période. Sert à négocier les frais Mobile Money et à sécuriser le circuit espèces."
        slices={tableaux.byMode.map((m, i) => ({
          key: m.mode,
          label: m.label,
          value: m.amount,
          color: VIZ_SEQUENTIAL[i % VIZ_SEQUENTIAL.length],
        }))}
        valueFormatter={formatFcfa}
        centerLabel="Encaissé"
        centerValue={formatFcfa(data.totals.collected)}
      />

      {/*
        Le journal ferme l'écran : on lit d'abord ce qui est rentré et d'où,
        puis on descend à la ligne à ligne quand on cherche une pièce précise.
      */}
      <JournalDeCaisse
        filters={journalFilters}
        exportFilename={`journal-de-caisse-${data.periodStart.slice(0, 10)}_${data.periodEnd.slice(
          0,
          10
        )}.csv`}
      />
    </div>
  );
}
