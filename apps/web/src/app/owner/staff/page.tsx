"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOwnerStaff } from "@/lib/hooks/use-owner-staff";

export default function OwnerStaffPage() {
  const { data, isLoading, error } = useOwnerStaff();

  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement du personnel…
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
          {error instanceof Error ? error.message : "Chargement impossible."}
        </CardContent>
      </Card>
    );
  }

  const totalHours = data.teachers.reduce((s, t) => s + t.hoursTaught, 0);
  const totalValidated = data.teachers.reduce((s, t) => s + t.hoursValidated, 0);
  const activeTeachers = data.teachers.filter((t) => t.status === "active").length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Ressources humaines</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Enseignants, heures déclarées / validées, cours sans titulaire, paies en attente de validation
            propriétaire.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/owner/finances">Vers finances &amp; validation paie</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Enseignants (lignes)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{data.teachers.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Statut actif (liste)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{activeTeachers}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Heures déclarées</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{fmt(totalHours)} h</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Heures validées</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{fmt(totalValidated)} h</CardContent>
        </Card>
      </div>

      {typeof data.activeFormateurs === "number" ? (
        <Card className="border-dashed">
          <CardContent className="py-3 text-sm">
            <span className="text-muted-foreground">Formateurs actifs (tenant sessions) : </span>
            <span className="font-semibold tabular-nums">{data.activeFormateurs}</span>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enseignants</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Heures décl.</TableHead>
                <TableHead className="text-right">Heures valid.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.teachers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-sm">
                    Aucun enseignant.
                  </TableCell>
                </TableRow>
              ) : (
                data.teachers.map((t) => (
                  <TableRow key={t.teacherId}>
                    <TableCell className="font-medium">
                      {t.firstName} {t.lastName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.hoursTaught}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.hoursValidated}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cours sans titulaire actif</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Classe</TableHead>
                  <TableHead>Cours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.coursesWithoutTeacher.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground text-sm">
                      Aucune ligne.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.coursesWithoutTeacher.map((c) => (
                    <TableRow key={c.classCourseId}>
                      <TableCell>{c.className}</TableCell>
                      <TableCell>{c.courseName}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Paies en attente de validation</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Enseignant</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payrollPending.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground text-sm">
                      Aucune fiche « calculée » en attente.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.payrollPending.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.teacherName}</TableCell>
                      <TableCell>{p.periodLabel ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(p.amount)} FCFA</TableCell>
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
