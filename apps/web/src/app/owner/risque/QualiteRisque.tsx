"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Phone, TrendingDown } from "lucide-react";
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
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import { ChartCard } from "@/components/owner/charts/ChartCard";
import { VIZ_STATUS, VIZ_SERIES, formatFcfa } from "@/components/owner/charts/palette";
import { buildQueryString, useOwnerRisque } from "@/lib/hooks/use-owner-risque";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Qualité & risque.
 *
 * Le haut de l'écran est une LISTE D'APPELS À PASSER, pas un tableau de bord :
 * nom, téléphone, motif dominant. C'est la seule sortie de l'espace
 * propriétaire qui se traduit directement en action dans la journée.
 *
 * Le reste répond aux deux questions qui suivent : qui bloque la chaîne
 * (avancement de saisie, nommément), et l'assiduité pèse-t-elle vraiment sur
 * les résultats (le nuage le montre au lieu de l'affirmer).
 */

/* --------------------------------- Outils --------------------------------- */

function scoreColor(score: number): string {
  if (score >= 70) return VIZ_STATUS.critical;
  if (score >= 40) return VIZ_STATUS.warning;
  return VIZ_STATUS.good;
}

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

/* --------------------------------- Page ----------------------------------- */

export function QualiteRisque() {
  const { filiereIds, nomClasse } = useOwnerFilters();
  const { data, isLoading, isError, error, refetch } = useOwnerRisque({
    filiereIds,
    nomClasse: nomClasse ?? undefined,
  });
  const [showAll, setShowAll] = useState(false);

  const k = data?.kpis;

  const aRappeler = useMemo(
    () => (data?.students ?? []).filter((s) => s.score >= (k?.seuilRisque ?? 70)),
    [data, k]
  );
  const aSurveiller = useMemo(
    () => (data?.students ?? []).filter((s) => s.score >= 40 && s.score < (k?.seuilRisque ?? 70)),
    [data, k]
  );
  const listeAffichee = useMemo(() => {
    const base = [...aRappeler, ...aSurveiller];
    return showAll ? base : base.slice(0, 20);
  }, [aRappeler, aSurveiller, showAll]);

  const chutes = useMemo(
    () => (data?.presence ?? []).filter((p) => p.ecart !== null && p.ecart <= -10),
    [data]
  );

  /**
   * La liste d'appels imprimée porte les coordonnées : c'est un document de
   * travail, pas un tableau de bord. Elle sort TOUS les étudiants au-dessus du
   * seuil, là où l'écran s'arrête à vingt derrière un « voir plus ».
   */
  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} %`);
    const aRisque = d.students.filter((s) => s.score >= d.kpis.seuilRisque);
    return {
      filename: "points-de-vigilance",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Étudiants suivis", String(d.kpis.etudiantsSuivis)],
            ["À risque", String(d.kpis.aRisque)],
            ["À surveiller", String(d.kpis.aSurveiller)],
            ["Seuil de risque", String(d.kpis.seuilRisque)],
            ["Enseignants en retard de saisie", String(d.kpis.enseignantsEnRetardSaisie)],
            ["Enseignants sous-pointant les appels", String(d.kpis.enseignantsSousAppel)],
          ],
        },
        // Sans cette mention, un score bâti sur trois signaux se lirait comme un
        // score bâti sur quatre — et paraîtrait plus rassurant qu'il ne l'est.
        ...(d.kpis.supportsMesurables
          ? []
          : [
              {
                kind: "note" as const,
                text: "Le signal « consultation des supports » est retiré du score : aucun support déposé, ou aucune consultation jamais enregistrée. Les scores ci-dessous reposent donc sur un signal de moins.",
              },
            ]),
        { kind: "heading", text: "Étudiants à rappeler", level: 1 },
        tableOrNote(
          [
            { header: "Étudiant" },
            { header: "Matricule", width: 28 },
            { header: "Téléphone", width: 34 },
            { header: "Filière", width: 42 },
            { header: "Score", width: 20, align: "right" },
            { header: "Motif dominant", width: 46 },
            { header: "Absence", width: 26, align: "right" },
            { header: "Moyenne", width: 24, align: "right" },
            { header: "Reste dû", width: 34, align: "right" },
          ],
          aRisque.map((s) => [
            s.nom,
            s.matricule ?? "—",
            s.telephone ?? "—",
            s.filiereName ?? "—",
            String(s.score),
            s.motifDominant,
            pct(s.tauxAbsence),
            s.moyenne === null ? "—" : s.moyenne.toFixed(2),
            formatFcfa(s.resteDu),
          ]),
          "Aucun étudiant au-dessus du seuil de risque."
        ),
        { kind: "heading", text: "Avancement de la saisie, par enseignant", level: 1 },
        tableOrNote(
          [
            { header: "Enseignant" },
            { header: "Notes attendues", width: 38, align: "right" },
            { header: "Notes saisies", width: 34, align: "right" },
            { header: "Taux de saisie", width: 34, align: "right" },
            { header: "Séances (30 j)", width: 34, align: "right" },
            { header: "Séances pointées", width: 38, align: "right" },
            { header: "Taux d'appel", width: 30, align: "right" },
          ],
          d.enseignants.map((t) => [
            t.nom,
            String(t.notesAttendues),
            String(t.notesSaisies),
            pct(t.tauxSaisie),
            String(t.seances30j),
            String(t.seancesPointees30j),
            pct(t.tauxAppels),
          ]),
          "Aucune saisie attendue sur ce périmètre."
        ),
        { kind: "heading", text: "Présence par filière — 30 jours contre 7 jours", level: 1 },
        tableOrNote(
          [
            { header: "Filière" },
            { header: "30 jours", width: 34, align: "right" },
            { header: "7 jours", width: 34, align: "right" },
            { header: "Écart", width: 30, align: "right" },
          ],
          d.presence.map((p) => [
            p.filiereName,
            pct(p.taux30j),
            pct(p.taux7j),
            p.ecart === null ? "—" : `${p.ecart > 0 ? "+" : ""}${p.ecart.toFixed(1)} pts`,
          ]),
          "Aucun pointage sur ce périmètre."
        ),
      ],
    };
  };

  if (isError) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Analyse du risque indisponible</CardTitle>
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
      <OwnerPageHeader
        title="Points de vigilance"
        question="Qui risque de décrocher, et qu'est-ce qui n'est pas saisi ?"
        precision="Score de décrochage, avancement de la saisie par enseignant, et poids réel de l'assiduité sur les résultats."
        pdf={data ? construireRapport : undefined}
        csv={{
          endpoint: "/api/v1/owner/risque",
          /* Le fichier exporte doit porter le perimetre affiche a l ecran :
             un en-tete qui ment sur son contenu est pire que pas d en-tete. */
          queryString: [
            "format=csv",
            buildQueryString({ filiereIds, nomClasse: nomClasse ?? undefined }),
          ]
            .filter(Boolean)
            .join("&"),
          filename: "etudiants-a-risque.csv",
        }}
      />

      {/* Indicateurs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="À rappeler"
          value={isLoading && !data ? "…" : String(k?.aRisque ?? 0)}
          tone={(k?.aRisque ?? 0) > 0 ? VIZ_STATUS.critical : VIZ_STATUS.good}
          hint={`Score ≥ ${k?.seuilRisque ?? 70} sur 100`}
        />
        <Stat
          label="À surveiller"
          value={isLoading && !data ? "…" : String(k?.aSurveiller ?? 0)}
          tone={(k?.aSurveiller ?? 0) > 0 ? VIZ_STATUS.warning : undefined}
          hint="Score entre 40 et 69"
        />
        <Stat
          label="Enseignants en retard de saisie"
          value={isLoading && !data ? "…" : String(k?.enseignantsEnRetardSaisie ?? 0)}
          tone={(k?.enseignantsEnRetardSaisie ?? 0) > 0 ? VIZ_STATUS.warning : VIZ_STATUS.good}
          hint="Bloquent la génération des bulletins"
        />
        <Stat
          label="Étudiants suivis"
          value={isLoading && !data ? "…" : String(k?.etudiantsSuivis ?? 0)}
          hint="Inscrits sur une cohorte non annulée"
        />
      </div>

      {/*
        Un score fondé sur trois signaux ne vaut pas un score fondé sur quatre.
        Le taire ferait passer une mesure partielle pour une mesure complète.
      */}
      {data && !k?.supportsMesurables && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Le signal «&nbsp;supports de cours non consultés&nbsp;» n&apos;est pas mesurable sur cet
          établissement : aucun support déposé, ou aucune consultation jamais enregistrée. Il est
          retiré du score et son poids réparti sur les autres signaux.
        </div>
      )}

      {/* Chute de présence */}
      {chutes.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex flex-wrap items-start gap-3 p-4 text-sm text-red-800">
            <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                {chutes.length} filière(s) décrochent de plus de 10 points sur la dernière semaine.
              </p>
              <ul className="mt-1 space-y-0.5">
                {chutes.map((p) => (
                  <li key={p.filiereId}>
                    {p.filiereName} — {p.taux7j} % cette semaine contre {p.taux30j} % sur le mois
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* La liste d'appels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4" />
            Étudiants à rappeler
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Classés par score de décrochage. Le motif dominant dit de quoi parler au téléphone.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-right">Score</TableHead>
                <TableHead>Étudiant</TableHead>
                <TableHead>Motif dominant</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Absences</TableHead>
                <TableHead className="text-right">Moyenne</TableHead>
                <TableHead className="text-right">Reste dû</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listeAffichee.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    {isLoading
                      ? "Chargement…"
                      : "Aucun étudiant au-dessus du seuil de vigilance. "}
                  </TableCell>
                </TableRow>
              ) : (
                listeAffichee.map((s) => (
                  <TableRow key={s.studentId}>
                    <TableCell className="text-right">
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: scoreColor(s.score) }}
                      >
                        {s.score}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.nom}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.matricule ?? "—"}
                        {s.filiereName ? ` · ${s.filiereName}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{s.motifDominant}</span>
                      {/* Un score sur 2 signaux n'a pas la même valeur qu'un score sur 4. */}
                      {s.signauxMesures.length < 4 && (
                        <div className="text-xs text-muted-foreground">
                          {s.signauxMesures.length} signal(aux) sur 4 mesurés
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.telephone ? (
                        <a href={`tel:${s.telephone}`} className="underline underline-offset-2">
                          {s.telephone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">pas de téléphone</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.heuresTotal > 0 ? (
                        <>
                          {s.heuresAbsence} h
                          <span className="text-muted-foreground"> / {s.heuresTotal} h</span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">non mesuré</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.moyenne === null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span
                          style={s.moyenne < 10 ? { color: VIZ_STATUS.critical } : undefined}
                        >
                          {s.moyenne}
                        </span>
                      )}
                      {s.nbEliminees > 0 && (
                        <div className="text-xs" style={{ color: VIZ_STATUS.critical }}>
                          {s.nbEliminees} éliminatoire(s)
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.resteDu > 0 ? (
                        <>
                          {new Intl.NumberFormat("fr-FR").format(s.resteDu)}
                          {s.joursRetardPaiement !== null && (
                            <div className="text-xs text-muted-foreground">
                              {s.joursRetardPaiement} j de retard
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Aucune troncature silencieuse. */}
          {aRappeler.length + aSurveiller.length > listeAffichee.length && (
            <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
              Afficher les {aRappeler.length + aSurveiller.length - listeAffichee.length} étudiants
              restants
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Avancement de la saisie */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Avancement de la saisie, par enseignant</CardTitle>
          <p className="text-sm text-muted-foreground">
            Notes d&apos;examen attendues sur les cohortes closes, et appels effectués sur les 30
            derniers jours. Les plus en retard d&apos;abord.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enseignant</TableHead>
                <TableHead className="text-right">Notes saisies</TableHead>
                <TableHead className="text-right">Taux de saisie</TableHead>
                <TableHead className="text-right">Séances pointées</TableHead>
                <TableHead className="text-right">Taux d&apos;appels</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data || data.enseignants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    {isLoading ? "Chargement…" : "Aucun enseignant affecté sur le périmètre."}
                  </TableCell>
                </TableRow>
              ) : (
                data.enseignants.map((e) => (
                  <TableRow key={e.teacherId}>
                    <TableCell className="font-medium">{e.nom}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.notesSaisies}
                      <span className="text-muted-foreground"> / {e.notesAttendues}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.tauxSaisie === null ? (
                        <span className="text-xs text-muted-foreground">rien attendu</span>
                      ) : (
                        <span
                          style={{
                            color: e.tauxSaisie >= 100 ? VIZ_STATUS.good : VIZ_STATUS.warning,
                          }}
                        >
                          {e.tauxSaisie} %
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.seances30j > 0 ? (
                        <>
                          {e.seancesPointees30j}
                          <span className="text-muted-foreground"> / {e.seances30j}</span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">aucune séance</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.tauxAppels === null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span
                          style={{
                            color: e.tauxAppels >= 90 ? VIZ_STATUS.good : VIZ_STATUS.critical,
                          }}
                        >
                          {e.tauxAppels} %
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

      {/* Corrélation assiduité / résultats */}
      <ChartCard
        title="Assiduité et résultats"
        subtitle="Un point par étudiant : heures d'absence en abscisse, moyenne en ordonnée."
        footnote="Sert à défendre la politique d'assiduité avec un chiffre plutôt qu'un discours."
        isEmpty={!data || data.correlation.length === 0}
        emptyLabel="Pas encore assez de pointages et de notes pour tracer la relation."
      >
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--viz-grid)" />
            <XAxis
              type="number"
              dataKey="heuresAbsence"
              name="Heures d'absence"
              tick={{ fontSize: 11 }}
              label={{ value: "Heures d'absence", position: "insideBottom", offset: -12, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="moyenne"
              name="Moyenne"
              domain={[0, 20]}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(value: number, name: string) => [value, name]}
            />
            <Scatter data={data?.correlation ?? []} fill={VIZ_SERIES[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartCard>

      {data && (
        <p className="text-xs text-muted-foreground">
          Données au {new Date(data.computedAt).toLocaleString("fr-FR")}.
        </p>
      )}
    </div>
  );
}
