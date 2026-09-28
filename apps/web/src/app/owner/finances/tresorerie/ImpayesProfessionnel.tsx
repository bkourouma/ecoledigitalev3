"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  Banknote,
  Coins,
  Info,
  Percent,
  Wallet,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useOwnerFinancesPro, buildQueryString } from "@/lib/hooks/use-owner-finances-pro";
import {
  useOwnerTresorerie,
} from "@/lib/hooks/use-owner-tresorerie";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { jourFr, tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import type { ReportBlock } from "@/lib/utils/report-doc";
import { StatCard } from "@/components/owner/charts/StatCard";
import { ChartCard } from "@/components/owner/charts/ChartCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import { DonutChartCard } from "@/components/owner/charts/DonutChartCard";
import {
  VIZ_SEQUENTIAL,
  VIZ_SERIES,
  VIZ_STATUS,
  formatFcfa,
  formatFcfaCompact,
  formatPct,
  recoveryColor,
} from "@/components/owner/charts/palette";
import type {
  OwnerFinancesProMode,
  OwnerFinancesProPeriod,
  OwnerFinancesProResponse,
} from "@ecoledigitale/contracts";

const MODE_LABELS: Record<OwnerFinancesProMode, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  autre: "Autre",
};

/**
 * États de règlement, vocabulaire de l'écran admin Paiements.
 *
 * Une seule entrée s'en écarte, et volontairement : le « Tous » de
 * l'administration inclut les étudiants soldés, ce qu'un écran intitulé
 * « Impayés » ne peut pas prendre pour défaut. L'étiquette dit donc ce que le
 * filtre fait réellement — montrer les non soldés — plutôt que d'emprunter un
 * mot qui promettrait autre chose.
 */
const ETAT_LABELS = {
  tous: "Non soldés (défaut)",
  non_regle: "Non réglés",
  partiel: "Partiels",
  solde: "Soldés",
} as const;

/** Veille d'une date ISO, en UTC. */
function isoVeille(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function ImpayesProfessionnel() {
  const [etat, setEtat] = useState<keyof typeof ETAT_LABELS>("tous");

  // Année, classe et semestre viennent du filtre global ; l'état de règlement
  // reste propre au tableau des impayés.
  const { anneeScolaire, filiereIds, nomClasse, semestreId } = useOwnerFilters();

  /** Recherche du tableau des impayés, reprise du champ « Étudiant… » admin. */
  const [rechercheInput, setRechercheInput] = useState("");
  const [recherche, setRecherche] = useState("");

  /**
   * La fenêtre est TOUJOURS celle de l'année scolaire choisie.
   *
   * L'écran n'a plus de sélecteur de période : « Ce trimestre » posé par-dessus
   * « 2023-2024 » posait deux questions de temps à la fois. On ne lit donc plus
   * `period` de la barre — un `?per=month` hérité d'un autre écran piloterait
   * en silence des chiffres dont plus aucun contrôle ne rendrait compte.
   *
   * `academic_year` est le nom que cet endpoint donne à la fenêtre de l'année
   * académique, du 1er septembre au 31 août.
   */
  const params = useMemo(
    () => ({
      period: "academic_year" as OwnerFinancesProPeriod,
      anneeScolaire,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      nomClasse,
      semestreId,
      etat,
      recherche: recherche || undefined,
    }),
    [anneeScolaire, filiereIds, nomClasse, semestreId, etat, recherche]
  );

  const { data, isLoading, error } = useOwnerFinancesPro(params);

  /**
   * Fenêtre des blocs de trésorerie : celle que l'API de recouvrement a
   * RETENUE, pas une que l'écran recalculerait de son côté.
   *
   * Ces blocs viennent d'un second endpoint (`/owner/tresorerie`) qui prend des
   * bornes de dates, là où le recouvrement prend une période nommée. Les laisser
   * dériver leur propre fenêtre afficherait la balance âgée de 90 jours glissants
   * sous des totaux calculés sur 2023-2024 : deux périmètres sur le même écran,
   * sans que rien ne le dise. C'est le montage déjà retenu par le tableau de bord,
   * où la courbe reprend la fenêtre du pouls.
   *
   * `periodEnd` est une borne EXCLUE côté serveur : sur une année scolaire, le
   * 1er septembre suivant. La trésorerie, elle, filtre en `BETWEEN` inclusif —
   * sans ce retrait d'un jour, une classe ouverte le 1er septembre entrerait
   * dans le périmètre de l'année précédente.
   */
  const tresoFilters = useMemo(() => {
    const dateDebut = data?.periodStart;
    const dateFin = data ? isoVeille(data.periodEnd) : undefined;
    // Le pas suit l'amplitude : garder le pas du jour sur 365 points rendrait la
    // courbe illisible.
    const span =
      dateDebut && dateFin
        ? (Date.parse(dateFin) - Date.parse(dateDebut)) / (1000 * 60 * 60 * 24)
        : 90;
    const granularity: "day" | "week" | "month" =
      span <= 45 ? "day" : span <= 200 ? "week" : "month";
    /*
       LE PÉRIMÈTRE COMPLET, ET NON PLUS SA SEULE FILIÈRE.

       Ces blocs ne recevaient que la filière, parce que l'endpoint de
       trésorerie ne connaissait qu'elle : la classe y était dégradée par un
       split sur la clé « filiereId|nom ». Choisir « LICENCE 1 A » restreignait
       donc les totaux du haut de l'écran pendant que la balance âgée, la
       courbe, les modes de règlement et le journal décrivaient l'école entière
       — deux périmètres sur la même page, sans que rien ne le dise.

       Depuis l'adoption du socle commun (owner-perimetre.sql), l'endpoint
       accepte les quatre dimensions. L'écran les transmet telles quelles.
    */
    return {
      dateDebut,
      dateFin,
      granularity,
      anneeScolaire,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      nomClasse,
      semestreId,
    };
  }, [data, anneeScolaire, filiereIds, nomClasse, semestreId]);

  const treso = useOwnerTresorerie(tresoFilters);

  const anomalies = treso.data?.anomalies;
  const hasAnomalies =
    (anomalies?.ordersPaidWithoutPayment.count ?? 0) > 0 ||
    (anomalies?.paymentsWithoutReceipt.count ?? 0) > 0;

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

  /**
   * Le rapport suit l'ordre de la relance : combien manque, à qui, puis sur
   * quelles filières et quelles UE. Les impayés nominatifs viennent en premier
   * parce que ce sont eux qu'on décroche le téléphone pour appeler.
   */
  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    const blocks: ReportBlock[] = [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Fenêtre", `Du ${d.periodStart} au ${d.periodEnd}`],
            ["Attendu", formatFcfa(d.totals.expected)],
            ["Encaissé", formatFcfa(d.totals.collected)],
            ["Reste à recouvrer", formatFcfa(d.totals.outstanding)],
            [
              "Taux de recouvrement",
              d.totals.recoveryRate === null
                ? "Non mesuré — aucun montant attendu"
                : formatPct(d.totals.recoveryRate),
            ],
            ["Étudiants non soldés", String(d.totals.unsettledStudents)],
          ],
        },
        {
          kind: "note",
          text: "Les UE de catégorie « Conduite » sont incluses dans ces montants : c'est du chiffre d'affaires réel. L'écran administrateur des paiements, lui, les exclut — d'où un écart normal entre les deux.",
        },
        ...(d.totals.outstanding === 0
          ? [
              {
                kind: "note" as const,
                text: "Aucun impayé sur ce périmètre : tout ce qui était attendu a été encaissé.",
              },
            ]
          : []),
        { kind: "heading", text: "Impayés par étudiant", level: 1 },
        tableOrNote(
          [
            { header: "Étudiant" },
            { header: "Matricule", width: 32 },
            { header: "Filière(s)", width: 55 },
            { header: "Dû", width: 34, align: "right" },
            { header: "Réglé", width: 34, align: "right" },
            { header: "Reste", width: 34, align: "right" },
            { header: "Plus ancien", width: 28, align: "right" },
          ],
          d.topUnpaid.map((u) => [
            u.studentName,
            u.matricule ?? "—",
            u.filiereNames ?? "—",
            formatFcfa(u.due),
            formatFcfa(u.paid),
            formatFcfa(u.outstanding),
            u.oldestUnpaidAt ? jourFr(u.oldestUnpaidAt) : "—",
          ]),
          "Aucun impayé sur ce périmètre.",
          [
            d.totals.unsettledStudents > d.topUnpaid.length
              ? `Total affiché (${d.topUnpaid.length} / ${d.totals.unsettledStudents})`
              : "Total affiché",
            "",
            "",
            "",
            "",
            formatFcfa(d.topUnpaid.reduce((s, u) => s + u.outstanding, 0)),
            "",
          ]
        ),
        { kind: "heading", text: "Recouvrement par filière", level: 1 },
        tableOrNote(
          [
            { header: "Filière" },
            { header: "Attendu", width: 40, align: "right" },
            { header: "Encaissé", width: 40, align: "right" },
            { header: "Taux", width: 26, align: "right" },
          ],
          d.recoveryByFiliere.map((f) => [
            f.filiereName,
            formatFcfa(f.expected),
            formatFcfa(f.collected),
            formatPct(f.recoveryRate),
          ]),
          "Aucune filière sur ce périmètre."
        ),
        { kind: "heading", text: "Chiffre d'affaires par UE", level: 1 },
        tableOrNote(
          [
            { header: "Code", width: 28 },
            { header: "Unité d'enseignement" },
            { header: "Filière", width: 50 },
            { header: "Inscrits", width: 26, align: "right" },
            { header: "CA", width: 42, align: "right" },
          ],
          d.revenueByUe.map((u) => [
            u.code,
            u.libelle,
            u.filiereName,
            String(u.confirmedEnrollments),
            formatFcfa(u.revenue),
          ]),
          "Aucune inscription confirmée sur ce périmètre."
        ),
        { kind: "heading", text: "Encaissements par mode de règlement", level: 1 },
        tableOrNote(
          [
            { header: "Mode" },
            { header: "Règlements", width: 36, align: "right" },
            { header: "Montant", width: 44, align: "right" },
          ],
          d.byPaymentMode.map((m) => [
            MODE_LABELS[m.mode] ?? m.mode,
            String(m.count),
            formatFcfa(m.amount),
          ]),
          "Aucun encaissement sur la période."
        ),
        { kind: "heading", text: "Entonnoir des inscriptions", level: 1 },
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Commandes créées", String(d.enrollmentFunnel.created)],
            ["Confirmées", String(d.enrollmentFunnel.confirmed)],
            ["Terminées", String(d.enrollmentFunnel.completed)],
            ["Annulées", String(d.enrollmentFunnel.cancelled)],
          ],
        },
    ];

    /*
      Les écarts de caisse viennent du second endpoint, et n'entrent dans le
      document que s'il a répondu. Un rapport de recouvrement qui tait un
      encaissement fantôme est un rapport faux : ils ferment le document, mais
      ils y sont.

      Pas de balance âgée ici non plus : elle se calcule sur des dates
      d'exigibilité que ce module ne saisit pas. L'ancienneté du document est
      celle de la colonne « Plus ancien » du tableau des impayés, datée sur la
      commande.
    */
    const t = treso.data;
    if (t && hasAnomalies) {
      blocks.push(
        { kind: "heading", text: "Écarts de caisse", level: 1 },
        {
          kind: "keyValues",
          columns: 1,
          items: [
            [
              "Commandes « payées » sans ligne de paiement",
              `${t.anomalies.ordersPaidWithoutPayment.count} pour ${formatFcfa(
                t.anomalies.ordersPaidWithoutPayment.amount
              )}`,
            ],
            [
              "Encaissements sans numéro de reçu (plus de 48 h)",
              `${t.anomalies.paymentsWithoutReceipt.count} pour ${formatFcfa(
                t.anomalies.paymentsWithoutReceipt.amount
              )}`,
            ],
          ],
        }
      );
    }

    return { filename: "impayes-professionnel", blocks };
  };

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

  // Le type le déclare requis, et il l'est — mais seulement d'une API à jour.
  // Le cast dit la vérité du runtime plutôt que de la masquer : cf. le
  // commentaire du bloc de rapprochement plus bas.
  const conduite = data.totals.conduite as
    | OwnerFinancesProResponse["totals"]["conduite"]
    | undefined;

  return (
    <div className="space-y-8">
      <OwnerPageHeader
        title="Impayés — Professionnel"
        question="Qui me doit combien sur les inscriptions aux UE ?"
        precision={`Du ${data.periodStart} au ${data.periodEnd}${
          data.nomClasse ? ` · ${data.nomClasse.split("|").slice(1).join("|")}` : ""
        }. Recouvrement des inscriptions aux UE, sur les classes ouvertes dans cette fenêtre. Le journal de caisse, lui, est sur l'écran « Paiements ».`}
        pdf={construireRapport}
        csv={{
          endpoint: "/api/v1/owner/finances/professionnel/export",
          queryString: buildQueryString(params),
          filename: "impayes-professionnel.csv",
        }}
      />

      {/*
        RAPPROCHEMENT AVEC L'ÉCRAN ADMIN PAIEMENTS.

        Cet écran et /admin/finances/student-payments lisent les mêmes commandes,
        avec un périmètre volontairement différent : l'administration écarte les
        UE de conduite de son plan de facturation, le propriétaire ne le peut
        pas — sur cette base elles portent des commandes intégralement encaissées,
        et les retirer ferait disparaître de l'argent réellement entré en caisse.

        Plutôt que de laisser un fondateur buter sur deux chiffres qui ne
        tombent pas juste, on écrit l'écart : « ici, moins la conduite, égale
        là-bas ». La ligne ne s'affiche que si de la conduite existe au
        périmètre — sinon il n'y a rien à rapprocher.

        LECTURE DÉFENSIVE : `conduite` est un champ RÉCENT de la réponse. L'API
        de ce projet ne recharge pas à chaud — un serveur démarré avant ce
        déploiement répond sans lui, et un accès direct faisait tomber TOUT
        l'écran sur un `TypeError`. Un écran qui perd une note de rapprochement
        reste utilisable ; un écran blanc, non.
      */}
      {conduite && conduite.expected > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Dont <strong>{formatFcfa(conduite.expected)}</strong> d&apos;UE de
            conduite ({formatFcfa(conduite.collected)} encaissés). L&apos;écran{" "}
            <em>Paiements</em> de l&apos;administration ne les facture pas : son attendu sur ce
            périmètre vaut{" "}
            <strong>
              {formatFcfa(data.totals.expected - conduite.expected)}
            </strong>
            .
          </span>
        </div>
      )}

      {/*
        DÉLAI INSCRIPTION → PREMIER RÈGLEMENT.
        Au-delà du seuil, ce n'est plus un retard de paiement : c'est une
        politique d'acompte qui ne tient pas, et l'école a livré des heures de
        cours avant d'avoir vu le premier franc. Le délai par classe dit
        laquelle renégocier.
      */}
      {treso.data?.delaiPaiement && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Délai entre l&apos;inscription et le premier règlement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {treso.data.delaiPaiement.mesure ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <span>
                    Moyenne{" "}
                    <strong className="tabular-nums">
                      {treso.data.delaiPaiement.moyenJours} j
                    </strong>
                  </span>
                  <span>
                    Médiane{" "}
                    <strong className="tabular-nums">
                      {treso.data.delaiPaiement.medianeJours} j
                    </strong>
                  </span>
                  <span className="text-muted-foreground">
                    sur {treso.data.delaiPaiement.lotsPayes} inscription(s) réglée(s) · seuil
                    d&apos;alerte {treso.data.delaiPaiement.seuilJours} j
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">Réglées</TableHead>
                      <TableHead className="text-right">Délai moyen</TableHead>
                      <TableHead className="text-right">Médiane</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {treso.data.delaiPaiement.parClasse.map((c) => (
                      <TableRow key={c.filiereId ?? c.filiereName}>
                        <TableCell className="font-medium">{c.filiereName}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.lots}</TableCell>
                        <TableCell
                          className="text-right tabular-nums"
                          style={
                            c.moyenJours !== null &&
                            c.moyenJours > treso.data!.delaiPaiement.seuilJours
                              ? { color: VIZ_STATUS.critical }
                              : undefined
                          }
                        >
                          {/* Une classe sans règlement n'a pas un délai de zéro :
                              elle n'en a pas. */}
                          {c.moyenJours === null ? "—" : `${c.moyenJours} j`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.medianeJours === null ? "—" : `${c.medianeJours} j`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              /* Aucun chiffre quand les dates ne décrivent pas des faits : un
                 délai de 0 jour se lirait « tout le monde paie le jour même ». */
              <p className="text-muted-foreground">
                {treso.data.delaiPaiement.raisonNonMesure}
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
          hint={
            data.totals.recoveryRate === null
              ? "Aucun montant attendu — le rapport n'a pas de dénominateur"
              : "Encaissé / attendu"
          }
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

      {/*
        Rien à recouvrer : on le dit, au lieu de laisser un tableau d'impayés
        vide se lire comme un filtre trop étroit.
      */}
      {data.totals.outstanding === 0 && (
        <Card className="border-emerald-300/70 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CardContent className="py-3 text-sm">
            <strong>Aucun impayé sur ce périmètre.</strong> Tout ce qui était attendu
            a été encaissé.
          </CardContent>
        </Card>
      )}

      {/*
        NI BALANCE ÂGÉE NI TRANCHES D'ANCIENNETÉ SUR CET ÉCRAN, ET C'EST DÉFINITIF.

        Les deux se calculent sur une date d'exigibilité, que seule
        `professional_order_installments` porte — une table que le module
        professionnel n'alimente pas : ici, on ne gère pas d'échéancier. Cinq
        tranches vides ne décrivaient donc pas une dette saine, elles décrivaient
        une mesure impossible, et le bandeau qui les accompagnait promettait une
        saisie d'échéanciers qui n'aura pas lieu.

        L'ancienneté existe quand même, autrement : le tableau des impayés date
        chaque dette à la plus ancienne COMMANDE non soldée de l'étudiant
        (`MIN(professional_orders.created_at)`, colonne « Depuis »). C'est la
        seule ancienneté que ce module puisse produire honnêtement.
      */}
      {treso.data && (
        <>
          <LineChartCard
            title="Courbe de trésorerie"
            subtitle="Encaissements de la période, comparés à la même saison l'an dernier — le calendrier scolaire est trop saisonnier pour qu'un écart à la période précédente veuille dire quelque chose."
            data={treso.data.cashflow as unknown as Record<string, unknown>[]}
            categoryKey="label"
            series={[
              { key: "total", label: "Encaissé", color: VIZ_SERIES[0] },
              { key: "totalAnneePrecedente", label: "Même période N-1", color: VIZ_SERIES[1] },
            ]}
            height={300}
            valueFormatter={formatFcfa}
            axisFormatter={formatFcfaCompact}
          />

        </>
      )}

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
                {data.totals.unsettledStudents > data.topUnpaid.length
                  ? `Liste plafonnée à ${data.topUnpaid.length} ; ${data.totals.unsettledStudents} étudiants non soldés au total. Le reste à recouvrer ci-dessus porte sur tout le périmètre.`
                  : "Restes à recouvrer, les plus élevés d'abord. Plafond de 20 lignes."}
                {recherche && (
                  <> Recherche « {recherche} » : elle ne restreint que ce tableau, pas les totaux.</>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-end gap-2">
              {/*
                Recherche nom / matricule, comme le champ « Étudiant… » de la
                page admin Paiements. Validée à l'Entrée plutôt qu'à la frappe :
                elle repart au serveur, et une requête par caractère saturerait
                l'API pour rien.
              */}
              <form
                className="w-56"
                onSubmit={(e) => {
                  e.preventDefault();
                  setRecherche(rechercheInput.trim());
                }}
              >
                <Input
                  value={rechercheInput}
                  onChange={(e) => setRechercheInput(e.target.value)}
                  placeholder="Étudiant…"
                  aria-label="Rechercher un étudiant par nom ou matricule"
                />
              </form>
              <div className="w-56">
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
                    {etat === "tous"
                      ? "Aucun impayé sur ce périmètre."
                      : "Aucun étudiant dans cet état de règlement sur la période."}
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
              href="/admin/finances/student-payments"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Paiements étudiants
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      {/*
        LE JOURNAL DE CAISSE N'EST PLUS ICI. Il vivait sur cet écran par accident
        d'histoire — les deux lisent professional_payments — mais il répond à la
        question inverse : « qu'est-ce qui EST rentré, ligne par ligne », quand
        cet écran-ci traite de ce qui n'est PAS rentré. Il est désormais sur
        « Paiements », avec les écarts de caisse qui permettent de le lire.
        Composant partagé : components/owner/JournalDeCaisse.tsx.
      */}
      {treso.data && (
        <p className="text-xs text-muted-foreground">
          Trésorerie au {new Date(treso.data.computedAt).toLocaleString("fr-FR")}
          {treso.isFetching ? " · actualisation en cours" : ""}. Le journal de caisse est
          désormais sur l&apos;écran « Paiements ».
        </p>
      )}
    </div>
  );
}
