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
import { SemesterAveragesChart } from "@/components/owner/SemesterAveragesChart";
import { AttendanceHeatmap } from "@/components/owner/AttendanceHeatmap";
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

export default function OwnerAcademiquePage() {
  const { data, isLoading, error } = useOwnerAcademic();
  const [sortKey, setSortKey] = useState<SortKey>("className");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedAverages = useMemo(() => {
    if (!data) return [];
    return sortRows(data.averagesByClass, sortKey, sortDir);
  }, [data, sortKey, sortDir]);

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
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Synthèses académiques</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Lecture seule : moyennes saisies par période, réussite par programme, assiduité récente et
          devoirs corrigés.
        </p>
      </div>

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
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Assiduité (8 dernières semaines)</CardTitle>
          </CardHeader>
          <CardContent>
            <AttendanceHeatmap cells={data.attendanceByClassWeek} />
          </CardContent>
        </Card>

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
