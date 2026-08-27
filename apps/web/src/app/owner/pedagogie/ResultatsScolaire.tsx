"use client";

import { useMemo, useState } from "react";
import { Loader2, ArrowUpDown } from "lucide-react";
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
import { useOwnerAcademic } from "@/lib/hooks/use-owner-academic";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { jourFr, tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import { SemesterAveragesChart } from "@/components/owner/SemesterAveragesChart";
import { HeatmapGrid } from "@/components/owner/charts/HeatmapGrid";
import type { OwnerAcademicResponse } from "@ecoledigitale/contracts";

type ClassAvg = OwnerAcademicResponse["averagesByClass"][number];
type SortKey = "className" | "studentCount" | "averageGrade";
type SortDir = "asc" | "desc";

function sortRows(rows: ClassAvg[], key: SortKey, dir: SortDir): ClassAvg[] {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "className") return m * a.className.localeCompare(b.className);
    if (key === "studentCount") return m * (a.studentCount - b.studentCount);
    return m * (a.averageGrade - b.averageGrade);
  });
}

export function ResultatsScolaire() {
  const { data, isLoading, error } = useOwnerAcademic();
  const [sortKey, setSortKey] = useState<SortKey>("className");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  /**
   * Le tableau des moyennes suit le tri choisi à l'écran : le propriétaire qui
   * a classé par moyenne croissante pour repérer les classes en difficulté
   * imprime cette lecture-là, pas un ordre alphabétique qui la défait.
   */
  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    const semestres = [...d.semesterAverages].sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      filename: "resultats-scolaire",
      orientation: "portrait",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Classes suivies", String(d.averagesByClass.length)],
            ["Seuil d'alerte sur la moyenne", d.riskGradeThreshold.toFixed(2)],
            ["Classes sous le seuil", String(d.atRiskClasses.length)],
            ["Devoirs corrigés", `${d.assignments.gradedRate.toFixed(1)} %`],
            [
              "Copies",
              `${d.assignments.gradedSubmissions} corrigées sur ${d.assignments.totalSubmissions}`,
            ],
          ],
        },
        { kind: "heading", text: "Classes sous le seuil d'alerte", level: 1 },
        tableOrNote(
          [
            { header: "Classe" },
            { header: "Moyenne", width: 34, align: "right" },
            { header: "Seuil", width: 30, align: "right" },
          ],
          d.atRiskClasses.map((c) => [
            c.className,
            c.averageGrade.toFixed(2),
            c.threshold.toFixed(2),
          ]),
          "Aucune classe sous le seuil d'alerte."
        ),
        { kind: "heading", text: "Moyennes par classe", level: 1 },
        tableOrNote(
          [
            { header: "Classe" },
            { header: "Élèves", width: 30, align: "right" },
            { header: "Moyenne", width: 34, align: "right" },
          ],
          sortRows(d.averagesByClass, sortKey, sortDir).map((c) => [
            c.className,
            String(c.studentCount),
            c.averageGrade.toFixed(2),
          ]),
          "Aucune moyenne saisie."
        ),
        { kind: "heading", text: "Moyennes par période", level: 1 },
        tableOrNote(
          [{ header: "Période" }, { header: "Moyenne", width: 34, align: "right" }],
          semestres.map((s) => [s.periodName, s.averageGrade.toFixed(2)]),
          "Aucune période notée."
        ),
        { kind: "heading", text: "Réussite par programme", level: 1 },
        tableOrNote(
          [
            { header: "Programme" },
            { header: "Élèves", width: 30, align: "right" },
            { header: "Taux de réussite", width: 40, align: "right" },
          ],
          d.successByProgram.map((p) => [
            p.programmeName,
            String(p.studentCount),
            `${p.successRate.toFixed(1)} %`,
          ]),
          "Aucun programme évalué."
        ),
        { kind: "pageBreak" },
        { kind: "heading", text: "Assiduité des huit dernières semaines", level: 1 },
        tableOrNote(
          [
            { header: "Classe" },
            { header: "Semaine du", width: 34 },
            { header: "Taux de présence", width: 40, align: "right" },
            { header: "Pointages", width: 30, align: "right" },
          ],
          d.attendanceByClassWeek.map((a) => [
            a.className,
            jourFr(a.weekStart),
            `${a.presentRate.toFixed(1)} %`,
            String(a.totalRecords),
          ]),
          "Aucun pointage sur les huit dernières semaines."
        ),
      ],
    };
  };

  const sortedAverages = useMemo(() => {
    if (!data) return [];
    return sortRows(data.averagesByClass, sortKey, sortDir);
  }, [data, sortKey, sortDir]);

  /**
   * Mise en forme pour la grille de chaleur : lignes = classes, colonnes = semaines.
   * Ce n'est pas un calcul d'indicateur — les taux arrivent déjà agrégés par l'API.
   */
  const attendanceGrid = useMemo(() => {
    const cells = data?.attendanceByClassWeek ?? [];
    if (cells.length === 0) return { rows: [], cols: [], cells: [] };

    const weeks = [...new Set(cells.map((c) => c.weekStart))].sort();
    const classes = new Map<string, string>();
    for (const c of cells) classes.set(c.classId, c.className);

    return {
      rows: [...classes.entries()]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      // Libellé court `MM-JJ` : l'année est constante sur 8 semaines et
      // encombrerait l'en-tête.
      cols: weeks.map((w) => ({ key: w, label: w.slice(5) })),
      cells: cells.map((c) => ({
        rowKey: c.classId,
        colKey: c.weekStart,
        value: c.presentRate,
        hint: `${c.totalRecords} enregistrement${c.totalRecords > 1 ? "s" : ""}`,
      })),
    };
  }, [data]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "className" ? "asc" : "desc");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement des synthèses académiques…
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
      <OwnerPageHeader
        title="Résultats — Scolaire"
        question="Est-ce que mes élèves réussissent ?"
        precision="Moyennes saisies par période, réussite par programme, assiduité récente et devoirs corrigés. Lecture seule."
        pdf={construireRapport}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Devoirs corrigés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{data.assignments.gradedRate}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.assignments.gradedSubmissions} / {data.assignments.totalSubmissions} rendus
            </p>
          </CardContent>
        </Card>
        <Card className="md:col-span-2 border-amber-200/80 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-950">
              Classes à risque (moyenne &lt; {data.riskGradeThreshold} / 20)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {data.atRiskClasses.length === 0 ? (
              <p className="text-muted-foreground">Aucune classe sous le seuil sur les données actuelles.</p>
            ) : (
              <ul className="list-disc pl-4 space-y-1">
                {data.atRiskClasses.map((c) => (
                  <li key={c.classId}>
                    <span className="font-medium">{c.className}</span> — moyenne{" "}
                    <span className="tabular-nums">{c.averageGrade.toFixed(2)}</span> / 20
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Moyennes par classe</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Cliquez sur un en-tête pour trier. Données : moyennes par matière et période agrégées au
            niveau classe.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button variant="ghost" size="sm" className="-ml-3 h-8 gap-1" onClick={() => toggleSort("className")}>
                    Classe
                    <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-3 h-8 gap-1 ml-auto"
                    onClick={() => toggleSort("studentCount")}
                  >
                    Élèves (distincts)
                    <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-3 h-8 gap-1 ml-auto"
                    onClick={() => toggleSort("averageGrade")}
                  >
                    Moyenne / 20
                    <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedAverages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-sm">
                    Aucune moyenne par classe.
                  </TableCell>
                </TableRow>
              ) : (
                sortedAverages.map((r) => (
                  <TableRow key={r.classId}>
                    <TableCell className="font-medium">{r.className}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.studentCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.averageGrade.toFixed(2)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Moyennes par période (S1 / S2 / …)</CardTitle>
        </CardHeader>
        <CardContent>
          <SemesterAveragesChart rows={data.semesterAverages} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <HeatmapGrid
          className="lg:col-span-2"
          title="Assiduité (8 dernières semaines)"
          subtitle="Taux de présences et retards par classe et par semaine. Les colonnes sont les lundis de semaine ISO."
          rows={attendanceGrid.rows}
          cols={attendanceGrid.cols}
          cells={attendanceGrid.cells}
          valueFormatter={(v) => `${v.toFixed(0)} %`}
          emptyLabel="Aucune donnée d'assiduité sur les 8 dernières semaines."
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Réussite par programme</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              Part d&apos;élèves avec moyenne générale ≥ 10 / 20 (agrégation par programme).
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Programme</TableHead>
                  <TableHead className="text-right">Élèves</TableHead>
                  <TableHead className="text-right">Réussite</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.successByProgram.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground text-sm">
                      Aucune donnée.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.successByProgram.map((p) => (
                    <TableRow key={p.programmeId}>
                      <TableCell>{p.programmeName}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.studentCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.successRate.toFixed(1)} %</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
