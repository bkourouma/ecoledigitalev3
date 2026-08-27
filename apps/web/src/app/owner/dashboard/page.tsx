"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
import { OwnerPulse, formatPulseValue } from "@/components/owner/OwnerPulse";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import {
  VIZ_SERIES,
  formatFcfa,
  formatFcfaCompact,
} from "@/components/owner/charts/palette";
import { useOwnerPulse } from "@/lib/hooks/use-owner-pulse";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import { useOwnerTresorerie } from "@/lib/hooks/use-owner-tresorerie";
import { tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import type { ReportBlock } from "@/lib/utils/report-doc";

/**
 * Tableau de bord du propriétaire.
 *
 * L'écran répond à UNE question — « comment va l'école, là, maintenant ? » — et
 * s'arrête là. Il ne résume pas les seize autres écrans : chacun a désormais son
 * entrée de menu, et quatre cartes de synthèse recopiant leurs chiffres ne
 * faisaient qu'ajouter une deuxième version, forcément en retard, de la même
 * information.
 *
 * Ce qui reste tient en trois blocs, dans l'ordre où la question se pose :
 *   1. le pouls — huit chiffres, l'argent puis l'école ;
 *   2. la courbe — l'argent rentre-t-il au même rythme que l'an dernier ;
 *   3. le tableau — où se concentre ce qui n'est pas rentré.
 *
 * UNE SEULE DIMENSION DE FILTRE : l'année scolaire. Elle agit vraiment — le
 * pouls la reçoit, cale sa fenêtre dessus et renomme ses indicateurs mensuels
 * (« Encaissements du mois » devient « de l'année »). La courbe et le tableau
 * des impayés reprennent la fenêtre que le pouls a retenue, pour que les trois
 * blocs parlent du même périmètre.
 *
 * Une chose ne se restreint pas, et le dit : le RESTE À RECOUVRER est un stock,
 * pas un flux. Ce qu'on vous doit aujourd'hui n'appartient à aucune année
 * scolaire, et son libellé devient « toutes années » dès qu'une année est
 * choisie.
 */

/** Douze mois glissants, bornes ISO — la fenêtre de la courbe et du tableau. */
function fenetreDouzeMois(): { dateDebut: string; dateFin: string } {
  const fin = new Date();
  const debut = new Date(fin);
  debut.setUTCMonth(debut.getUTCMonth() - 11);
  debut.setUTCDate(1);
  return {
    dateDebut: debut.toISOString().slice(0, 10),
    dateFin: fin.toISOString().slice(0, 10),
  };
}

/** Les cinq premières filières, le reste agrégé — jamais tronqué en silence. */
const TOP_FILIERES = 5;

export default function OwnerDashboardPage() {
  // L'année vient de la barre de filtre globale. Elle agit réellement : le pouls
  // la reçoit et bascule ses indicateurs mensuels en lecture d'année.
  const { anneeScolaire } = useOwnerFilters();

  // Même clé de requête que `<OwnerPulse />` : React Query sert les deux
  // consommateurs avec un seul appel réseau.
  const pulse = useOwnerPulse(anneeScolaire);

  /**
   * Fenêtre des blocs qui suivent.
   *
   * AVEC une année choisie : celle que le pouls a RETENUE, pour que courbe,
   * tableau et indicateurs parlent du même périmètre. Recalculer les bornes
   * ici finirait par diverger du pivot de septembre du serveur.
   *
   * SANS année : le pouls décrit le présent (mois en cours, 30 jours) mais
   * renvoie quand même les bornes de l'année scolaire courante — c'est la
   * fenêtre de ses indicateurs *annuels* (taux de recouvrement), pas celle
   * de la courbe. Les coller ici affichait 2025-2026 sous le titre
   * « 12 derniers mois », et sélectionner l'année en cours ne changeait rien
   * à la courbe ni au tableau.
   */
  const douzeMois = useMemo(fenetreDouzeMois, []);
  const fenetre =
    anneeScolaire &&
    pulse.data?.academicYearLabel === anneeScolaire &&
    pulse.data.windowStart &&
    pulse.data.windowEnd
      ? { dateDebut: pulse.data.windowStart, dateFin: pulse.data.windowEnd }
      : douzeMois;

  const tresorerie = useOwnerTresorerie({ ...fenetre, granularity: "month" });

  const courbe = useMemo(
    () =>
      (tresorerie.data?.cashflow ?? []).map((p) => ({
        mois: p.label,
        total: p.total,
        totalAnneePrecedente: p.totalAnneePrecedente,
      })),
    [tresorerie.data]
  );

  /**
   * Les filières classées par reste échu. La sixième et les suivantes ne
   * disparaissent pas : elles sont regroupées sur une ligne « autres », dont le
   * total additionné au top 5 redonne le total du bandeau.
   */
  const { top, autres, totalEchu } = useMemo(() => {
    const rows = [...(tresorerie.data?.agedByFiliere ?? [])].sort(
      (a, b) => b.totalEchu - a.totalEchu
    );
    const head = rows.slice(0, TOP_FILIERES);
    const tail = rows.slice(TOP_FILIERES);
    return {
      top: head,
      autres: {
        count: tail.length,
        montant: tail.reduce((s, f) => s + f.totalEchu, 0),
      },
      totalEchu: rows.reduce((s, f) => s + f.totalEchu, 0),
    };
  }, [tresorerie.data]);


  /**
   * Titre de la courbe et de son tableau : il doit nommer la fenêtre réellement
   * affichée. Laisser « 12 derniers mois » au-dessus des encaissements de
   * 2023-2024 serait le genre d'étiquette qu'on ne relit pas et qui fait prendre
   * une décision sur le mauvais périmètre.
   */
  const titreCourbe = anneeScolaire
    ? `Encaissements de l'année ${pulse.data?.academicYearLabel ?? ""}`.trim()
    : "Encaissements des 12 derniers mois";

  /**
   * « Situation au JJ/MM/AAAA » : une page, les huit chiffres puis les deux
   * tableaux. Le PDF reprend la valeur telle qu'elle est affichée, y compris le
   * « — » d'un indicateur non mesuré : imprimer un zéro à sa place inventerait
   * une mesure qui n'a pas eu lieu.
   */
  const construireRapport = (): OwnerReportContent => {
    const blocks: ReportBlock[] = [];

    if (pulse.data) {
      blocks.push(
        { kind: "heading", text: "Le pouls de l'établissement", level: 1 },
        {
          kind: "table",
          table: {
            columns: [
              { header: "Indicateur" },
              { header: "Valeur", width: 44, align: "right" },
              { header: "Comparaison", width: 44, align: "right" },
              { header: "Lecture", width: 40 },
            ],
            rows: pulse.data.kpis.map((k) => [
              k.label,
              formatPulseValue(k),
              k.previousValue === null
                ? "—"
                : `${formatPulseValue({ ...k, value: k.previousValue })} · ${k.previousLabel}`,
              k.measured ? (k.detail ?? "") : "Non mesuré",
            ]),
          },
        }
      );
      if (pulse.data.academicYearLabel) {
        blocks.push({
          kind: "note",
          text: `Année scolaire couverte : ${pulse.data.academicYearLabel}.`,
        });
      }
    }

    if (tresorerie.data) {
      blocks.push(
        { kind: "heading", text: titreCourbe, level: 1 },
        tableOrNote(
          [
            { header: "Mois" },
            { header: "Encaissé", width: 46, align: "right" },
            { header: "Même mois l'an dernier", width: 56, align: "right" },
            { header: "Écart", width: 40, align: "right" },
          ],
          tresorerie.data.cashflow.map((p) => [
            p.label,
            formatFcfa(p.total),
            formatFcfa(p.totalAnneePrecedente),
            formatFcfa(p.total - p.totalAnneePrecedente),
          ]),
          "Aucun encaissement sur cette fenêtre."
        ),
        { kind: "heading", text: "Où se concentre le reste à recouvrer", level: 1 },
        tableOrNote(
          [
            { header: "Filière" },
            { header: "À échoir", width: 42, align: "right" },
            { header: "Échu", width: 42, align: "right" },
          ],
          [...tresorerie.data.agedByFiliere]
            .sort((a, b) => b.totalEchu - a.totalEchu)
            .map((f) => [f.filiereName, formatFcfa(f.aEchoir), formatFcfa(f.totalEchu)]),
          "Rien à recouvrer sur ce périmètre.",
          ["Total", "", formatFcfa(totalEchu)]
        )
      );
    }


    return { filename: "situation-etablissement", orientation: "portrait", blocks };
  };

  return (
    <div className="space-y-8">
      <OwnerPageHeader
        title="Tableau de bord"
        question="Comment va l'école, là, maintenant ?"
        precision="Scolaire et professionnel consolidés. L'année couverte est annoncée sous les indicateurs."
        pdf={construireRapport}
      />

      <OwnerPulse anneeScolaire={anneeScolaire} />

      <LineChartCard
        title={titreCourbe}
        subtitle="Comparés au même mois l'an dernier — le calendrier scolaire est trop saisonnier pour qu'un écart au mois précédent veuille dire quelque chose."
        data={courbe}
        categoryKey="mois"
        series={[
          { key: "total", label: "Encaissé", color: VIZ_SERIES[0] },
          { key: "totalAnneePrecedente", label: "Même mois N-1", color: VIZ_SERIES[1] },
        ]}
        valueFormatter={formatFcfa}
        axisFormatter={formatFcfaCompact}
      />

      <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-base">Où se concentre le reste à recouvrer</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Les {TOP_FILIERES} filières qui pèsent le plus, classées par montant échu.
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/owner/finances/tresorerie">
                Détail
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filière</TableHead>
                  <TableHead className="text-right">À échoir</TableHead>
                  <TableHead className="text-right">Échu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm text-muted-foreground">
                      {tresorerie.isLoading
                        ? "Chargement…"
                        : anneeScolaire
                          ? "Rien à recouvrer sur cette année."
                          : "Rien à recouvrer sur les douze derniers mois."}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {top.map((f) => (
                      <TableRow key={f.filiereId ?? f.filiereName}>
                        <TableCell className="font-medium">{f.filiereName}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatFcfa(f.aEchoir)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatFcfa(f.totalEchu)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Le reliquat est nommé, pas escamoté : le total affiché
                        doit rester celui de tout le périmètre. */}
                    {autres.count > 0 && (
                      <TableRow>
                        <TableCell className="text-muted-foreground">
                          {autres.count} autre{autres.count > 1 ? "s" : ""} filière
                          {autres.count > 1 ? "s" : ""}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatFcfa(autres.montant)}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell className="font-semibold">Total échu</TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums font-semibold">
                        {formatFcfa(totalEchu)}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

    </div>
  );
}
