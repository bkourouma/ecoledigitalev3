"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@ecoledigitale/ui";
import { AlertTriangle, Compass, Loader2, Radar } from "lucide-react";
import { StatCard } from "@/components/owner/charts/StatCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { DonutChartCard } from "@/components/owner/charts/DonutChartCard";
import { VIZ_SERIES, VIZ_STATUS, formatFcfa } from "@/components/owner/charts/palette";
import { useProspectionDashboard } from "@/lib/hooks/use-prospection";
import { PROVENANCE_CANAL_LABELS } from "@ecoledigitale/contracts";
import { formatAmountFCFA } from "@/lib/utils";

/**
 * Tableau de bord de la prospection — d'où viennent les étudiants, ce que
 * chaque canal rapporte, et ce qui reste dû aux commerciaux.
 *
 * L'axe du temps date l'étudiant par le DÉBUT DE SA PREMIÈRE CLASSE, pas par la
 * date de saisie de sa fiche : sur une base reprise, toutes les fiches portent
 * le même horodatage et la courbe se tasserait sur un seul mois.
 */

/** Quatre familles pour l'histogramme : un canal par barre serait illisible. */
const FAMILLES = [
  { key: "commercial", label: "Commerciaux", color: VIZ_SERIES[0] },
  { key: "medias", label: "Médias (Google, Facebook, radio/télé/journal)", color: VIZ_SERIES[1] },
  { key: "bouche_a_oreille", label: "Bouche-à-oreille", color: VIZ_SERIES[2] },
  { key: "autre", label: "Autre", color: VIZ_SERIES[3] },
];

function moisLabel(mois: string): string {
  const [annee, m] = mois.split("-");
  const date = new Date(Number(annee), Number(m) - 1, 1);
  return isNaN(date.getTime())
    ? mois
    : date.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

export default function ProspectionDashboardPage() {
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");

  const query = useProspectionDashboard({
    date_debut: dateDebut || undefined,
    date_fin: dateFin || undefined,
  });
  const data = query.data;

  const parMois = useMemo(
    () =>
      (data?.par_mois ?? []).map((m) => ({
        mois: moisLabel(m.mois),
        commercial: m.commercial,
        medias: m.medias,
        bouche_a_oreille: m.bouche_a_oreille,
        autre: m.autre,
      })),
    [data?.par_mois]
  );

  const slices = useMemo(
    () =>
      (data?.par_canal ?? []).map((c) => ({
        key: c.canal,
        label: PROVENANCE_CANAL_LABELS[c.canal],
        value: c.etudiants,
      })),
    [data?.par_canal]
  );

  const tauxRenseigne =
    data && data.total_etudiants > 0 ? (data.renseignes / data.total_etudiants) * 100 : 0;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <Radar className="h-7 w-7 text-indigo-500" />
            Prospection
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            D&apos;où viennent les étudiants, et ce que chaque canal rapporte réellement.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Du</label>
            <Input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Au</label>
            <Input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          </div>
          <Link href="/professionnel/admin/prospection/provenances">
            <Button variant="outline">
              <Compass className="h-4 w-4 mr-2" />
              Provenances
            </Button>
          </Link>
        </div>
      </div>

      {query.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
          Chargement…
        </p>
      ) : query.isError ? (
        <p className="py-16 text-center text-sm text-red-600">
          <AlertTriangle className="h-4 w-4 inline mr-2" />
          {(query.error as Error)?.message ?? "Chargement impossible."}
        </p>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              label="Étudiants"
              value={String(data.total_etudiants)}
              hint="Toutes les fiches étudiants de l'établissement."
            />
            <StatCard
              label="Provenance renseignée"
              value={`${Math.round(tauxRenseigne)} %`}
              hint={`${data.renseignes} renseignées · ${data.non_renseignes} sans provenance.`}
            />
            <StatCard
              label="Amenés par un commercial"
              value={String(data.via_commercial)}
              hint="Seul canal ouvrant droit à commission."
            />
            <StatCard
              label="Commissions dues"
              value={formatAmountFCFA(Math.round(data.commission_due))}
              hint={`${formatAmountFCFA(Math.round(data.commission_acquise))} acquis · ${formatAmountFCFA(
                Math.round(data.commission_versee)
              )} versés.`}
            />
          </div>

          {/* Information, pas alerte : ne pas avoir de provenance est un cas
              normal — tous les étudiants ne sont pas venus par quelqu'un. */}
          {data.non_renseignes > 0 && (
            <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Les chiffres ci-dessous ne portent que sur les {data.renseignes} provenance
              {data.renseignes > 1 ? "s" : ""} renseignée{data.renseignes > 1 ? "s" : ""}.{" "}
              {data.non_renseignes} étudiant{data.non_renseignes > 1 ? "s" : ""} n&apos;en
              {data.non_renseignes > 1 ? " ont" : " a"} pas. La provenance d&apos;un étudiant se
              consulte et se corrige sur sa fiche, dans Étudiants.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DonutChartCard
              title="Répartition par provenance"
              subtitle="Nombre d'étudiants par canal déclaré."
              slices={slices}
              centerLabel="Renseignés"
              centerValue={String(data.renseignes)}
              footnote="Les fiches sans provenance ne sont pas comptées."
            />
            <BarChartCard
              title="Arrivées par mois"
              subtitle="Étudiants datés par le début de leur première classe ouverte."
              data={parMois}
              categoryKey="mois"
              stacked
              series={FAMILLES}
              footnote="Un étudiant sans classe ouverte n'apparaît pas sur cet axe."
            />
          </div>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Ce que rapporte chaque canal</CardTitle>
              <p className="text-sm text-muted-foreground">
                Ligne « Scolarité » du barème effectivement encaissée — hors frais
                d&apos;inscription, frais annexes et conduite.
              </p>
            </CardHeader>
            <CardContent>
              {data.par_canal.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucune provenance renseignée pour l&apos;instant.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3">Canal</th>
                      <th className="py-2 pr-3 text-right">Étudiants</th>
                      <th className="py-2 pr-3 text-right">Scolarité encaissée</th>
                      <th className="py-2 text-right">Encaissé par étudiant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.par_canal.map((c) => (
                      <tr key={c.canal}>
                        <td className="py-2 pr-3 font-medium">
                          {PROVENANCE_CANAL_LABELS[c.canal]}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{c.etudiants}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatFcfa(c.scolarite_encaissee)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">
                          {c.etudiants > 0
                            ? formatFcfa(Math.round(c.scolarite_encaissee / c.etudiants))
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Commerciaux les plus actifs</CardTitle>
              <Link href="/professionnel/admin/prospection/commissions/historique">
                <Button variant="outline" size="sm">
                  Commissions à payer
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {data.top_commerciaux.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucun étudiant n&apos;est encore rattaché à un commercial.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3">Commercial</th>
                      <th className="py-2 pr-3 text-right">Étudiants</th>
                      <th className="py-2 pr-3 text-right">Scolarité apportée</th>
                      <th className="py-2 pr-3 text-right">Commission acquise</th>
                      <th className="py-2 text-right">Solde dû</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.top_commerciaux.map((c) => (
                      <tr key={c.commercial_id}>
                        <td className="py-2 pr-3 font-medium">{c.nom}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{c.etudiants}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatFcfa(c.scolarite_encaissee)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatFcfa(c.commission_acquise)}
                        </td>
                        <td
                          className="py-2 text-right tabular-nums font-semibold"
                          style={{ color: c.solde > 0 ? VIZ_STATUS.warning : undefined }}
                        >
                          {formatFcfa(c.solde)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
