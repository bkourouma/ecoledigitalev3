"use client";

import { useMemo } from "react";
import { AlertTriangle, Info, TrendingDown, Users } from "lucide-react";
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
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { ChartCard } from "@/components/owner/charts/ChartCard";
import {
  formatFcfa,
  formatFcfaCompact,
  VIZ_SERIES,
  VIZ_STATUS,
} from "@/components/owner/charts/palette";
import { useOwnerEconomie } from "@/lib/hooks/use-owner-economie";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Économie de l'établissement.
 *
 * Règle qui gouverne tout l'écran : le mot « marge » suppose que les charges
 * soient saisies. Tant qu'elles ne le sont pas, on affiche « marge brute
 * pédagogique » et un bandeau qui dit pourquoi. Une marge de 100 % n'est pas une
 * performance, c'est une comptabilité absente — et le laisser deviner serait le
 * mensonge le plus coûteux de tout le pilotage.
 */

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className="mt-1 text-2xl font-semibold tabular-nums"
          style={tone ? { color: tone } : undefined}
        >
          {value}
        </div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function OwnerEconomiePage() {
  const { filiereIds } = useOwnerFilters();
  const { data, isLoading, isError, error, refetch } = useOwnerEconomie(filiereIds);

  const k = data?.kpis;
  const cov = data?.couverture;
  const interpretable = cov?.margeInterpretable ?? false;

  const forecastRows = useMemo(
    () =>
      (data?.forecast ?? []).map((p) => ({
        semaine: `S${p.semaine}`,
        prudent: p.solde_prudent,
        median: p.solde_median,
        optimiste: p.solde_optimiste,
      })),
    [data]
  );

  if (isError) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Analyse économique indisponible</CardTitle>
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Économie</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Marge brute pédagogique par filière, valeur par famille, rétention et prévision de
            trésorerie.
          </p>
        </div>
        <ExportCsvButton
          endpoint="/api/v1/owner/economie"
          queryString={
            filiereIds.length ? `format=csv&filiereIds=${filiereIds.join(",")}` : "format=csv"
          }
          filename="economie.csv"
          label="Exporter"
        />
      </div>

      {/*
        Le bandeau le plus important de l'écran : sans charges saisies, le
        chiffre affiché est un chiffre d'affaires, pas une marge.
      */}
      {data && !interpretable && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">
                Les montants ci-dessous sont un chiffre d&apos;affaires, pas une marge.
              </p>
              <p>
                Aucun coût enseignant n&apos;est enregistré
                {cov?.chargesSaisies
                  ? ""
                  : " et aucune charge (loyer, énergie, fournitures) n'est saisie"}
                . Un taux proche de 100 % ne traduit donc pas une rentabilité, mais l&apos;absence
                de dépenses en base. Saisissez les charges pour que cet écran devienne un vrai
                résultat d&apos;exploitation.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {data && interpretable && !cov?.chargesSaisies && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Marge <strong>brute pédagogique</strong> : elle déduit le coût enseignant, mais aucune
            charge d&apos;établissement n&apos;est saisie. Ce n&apos;est pas un résultat
            d&apos;exploitation.
          </span>
        </div>
      )}

      {/* Indicateurs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Encaissé"
          value={isLoading && !data ? "…" : formatFcfa(k?.encaisseTotal ?? 0)}
          hint="Sur le périmètre filtré"
        />
        <Stat
          label={interpretable ? "Marge brute pédagogique" : "Encaissé moins coûts connus"}
          value={isLoading && !data ? "…" : formatFcfa(k?.margeBruteTotale ?? 0)}
          tone={(k?.margeBruteTotale ?? 0) < 0 ? VIZ_STATUS.critical : undefined}
          hint={
            interpretable
              ? `${k?.tauxMargeBrute ?? 0} % de l'encaissé`
              : "Aucun coût enregistré : lecture impossible"
          }
        />
        <Stat
          label="Familles suivies"
          value={isLoading && !data ? "…" : String(k?.famillesSuivies ?? 0)}
          hint={`dont ${k?.fratries ?? 0} fratrie(s) — base d'une remise fratrie`}
        />
        <Stat
          label="Rupture de trésorerie"
          value={
            isLoading && !data
              ? "…"
              : k?.semaineRupture
                ? `Semaine ${k.semaineRupture}`
                : "Aucune"
          }
          tone={k?.semaineRupture ? VIZ_STATUS.critical : VIZ_STATUS.good}
          hint={
            k?.dateRupture
              ? `à partir du ${new Date(k.dateRupture).toLocaleDateString("fr-FR")}`
              : "Sur l'horizon de 13 semaines, scénario médian"
          }
        />
      </div>

      {/* Prévision de trésorerie */}
      <ChartCard
        title="Prévision de trésorerie — 13 semaines"
        subtitle="Solde cumulé des flux attendus, selon trois hypothèses de recouvrement."
        footnote="Prévision de FLUX partant de zéro : aucune table ne porte le solde bancaire de l'établissement. Le croisement de la courbe avec zéro indique la semaine où les encaissements ne couvriront plus les sorties."
        isEmpty={forecastRows.length === 0}
        emptyLabel="Aucune échéance ni sortie prévue sur l'horizon."
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={forecastRows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--viz-grid)" />
            <XAxis dataKey="semaine" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => formatFcfaCompact(v)} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => formatFcfa(v)} />
            <Legend />
            {/* La ligne de zéro est le repère qui compte. */}
            <ReferenceLine y={0} stroke={VIZ_STATUS.critical} strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="prudent"
              name="Prudent (70 %)"
              stroke={VIZ_SERIES[2]}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="median"
              name="Médian (85 %)"
              stroke={VIZ_SERIES[0]}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="optimiste"
              name="Optimiste (100 %)"
              stroke={VIZ_SERIES[1]}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Marge par filière */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {interpretable ? "Marge brute pédagogique par filière" : "Encaissé par filière"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Encaissé réparti au prorata des inscriptions. Les charges d&apos;établissement
            (loyer, énergie) ne sont jamais réparties automatiquement : une clé inventée
            fabriquerait des marges sans signification comptable.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filière</TableHead>
                <TableHead className="text-right">Étudiants</TableHead>
                <TableHead className="text-right">Encaissé</TableHead>
                <TableHead className="text-right">Coût enseignant</TableHead>
                <TableHead className="text-right">Charges affectées</TableHead>
                <TableHead className="text-right">
                  {interpretable ? "Marge brute" : "Reste"}
                </TableHead>
                <TableHead className="text-right">Par étudiant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data || data.marges.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    {isLoading ? "Chargement…" : "Aucune filière avec de l'activité sur le périmètre."}
                  </TableCell>
                </TableRow>
              ) : (
                data.marges.map((m) => (
                  <TableRow key={m.filiereId}>
                    <TableCell className="font-medium">{m.filiereName}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.etudiants}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(m.encaisse)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.coutEnseignant > 0 ? (
                        formatFcfa(m.coutEnseignant)
                      ) : (
                        <span className="text-xs text-muted-foreground">non saisi</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.chargesAffectees > 0 ? (
                        formatFcfa(m.chargesAffectees)
                      ) : (
                        <span className="text-xs text-muted-foreground">non saisi</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      <span style={m.margeBrute < 0 ? { color: VIZ_STATUS.critical } : undefined}>
                        {formatFcfa(m.margeBrute)}
                      </span>
                      {m.tauxMarge !== null && (
                        <div className="text-xs text-muted-foreground">{m.tauxMarge} %</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.margeParEtudiant === null ? "—" : formatFcfa(m.margeParEtudiant)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Rétention */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rétention inter-semestres</CardTitle>
          <p className="text-sm text-muted-foreground">
            Part des étudiants qui se réinscrivent sur une cohorte démarrant après la fin de la
            précédente. Le meilleur prédicteur du chiffre d&apos;affaires de l&apos;an prochain.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filière</TableHead>
                <TableHead className="text-right">Cohorte</TableHead>
                <TableHead className="text-right">Poursuivent</TableHead>
                <TableHead className="text-right">Taux de rétention</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data || data.retention.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground">
                    {isLoading ? "Chargement…" : "Pas encore de parcours sur plusieurs semestres."}
                  </TableCell>
                </TableRow>
              ) : (
                data.retention.map((r) => (
                  <TableRow key={r.filiereId}>
                    <TableCell className="font-medium">{r.filiereName}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.cohorte}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.poursuivis}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.tauxRetention === null ? (
                        "—"
                      ) : (
                        <span
                          style={{
                            color:
                              r.tauxRetention >= 70
                                ? VIZ_STATUS.good
                                : r.tauxRetention >= 40
                                  ? VIZ_STATUS.warning
                                  : VIZ_STATUS.critical,
                          }}
                        >
                          {r.tauxRetention} %
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* LTV par famille */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Valeur par famille
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            L&apos;unité économique est le foyer, pas l&apos;élève : une fratrie qui part, ce sont
            plusieurs scolarités perdues le même jour. Montants <strong>réalisés</strong>, pas
            projetés.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Famille</TableHead>
                <TableHead className="text-right">Enfants</TableHead>
                <TableHead className="text-right">Encaissé</TableHead>
                <TableHead className="text-right">Ancienneté</TableHead>
                <TableHead className="text-right">Revenu annuel moyen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data || data.familles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    {isLoading ? "Chargement…" : "Aucune famille rattachée à un élève payant."}
                  </TableCell>
                </TableRow>
              ) : (
                data.familles.slice(0, 25).map((fam) => (
                  <TableRow key={fam.parentId}>
                    <TableCell className="font-medium">
                      {fam.parentNom}
                      {fam.enfants > 1 && (
                        <span
                          className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs"
                          title="Cible d'une remise fratrie"
                        >
                          fratrie
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fam.enfants}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(fam.encaisseTotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fam.anneesPresence === null ? "—" : `${fam.anneesPresence} an(s)`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fam.revenuAnnuelMoyen === null ? "—" : formatFcfa(fam.revenuAnnuelMoyen)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {data && data.familles.length > 25 && (
            <p className="mt-3 text-xs text-muted-foreground">
              25 familles affichées sur {data.familles.length}. L&apos;export contient la liste
              complète.
            </p>
          )}
        </CardContent>
      </Card>

      {data && (
        <p className="text-xs text-muted-foreground">
          Données au {new Date(data.computedAt).toLocaleString("fr-FR")}.
          {cov?.historiqueStatutsDepuis && (
            <>
              {" "}
              Historique des statuts élève constitué depuis le{" "}
              {new Date(cov.historiqueStatutsDepuis).toLocaleDateString("fr-FR")} : les départs
              antérieurs à cette date ne sont pas datables.
            </>
          )}
        </p>
      )}
    </div>
  );
}
