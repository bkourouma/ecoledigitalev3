"use client";

import { useMemo, useState } from "react";
import { Loader2, Users, GraduationCap, UserCog, Scale, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOwnerPersonnes, buildQueryString } from "@/lib/hooks/use-owner-personnes";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { useOwnerStatsFilters } from "@/lib/hooks/use-owner-stats-filters";
import { StatCard } from "@/components/owner/charts/StatCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { DonutChartCard } from "@/components/owner/charts/DonutChartCard";
import { FiliereFilter } from "@/components/owner/charts/FiliereFilter";
import { VIZ_SEQUENTIAL } from "@/components/owner/charts/palette";

const GENDER_LABELS: Record<string, string> = {
  masculin: "Masculin",
  feminin: "Féminin",
  m: "Masculin",
  f: "Féminin",
  male: "Masculin",
  female: "Féminin",
};

const CONTRACT_LABELS: Record<string, string> = {
  permanent: "Permanent",
  temporary: "Temporaire",
  freelance: "Vacataire",
};

function genderLabel(g: string | null): string {
  if (!g) return "Non renseigné";
  return GENDER_LABELS[g] ?? g;
}

export default function OwnerPersonnesPage() {
  const [filiereIds, setFiliereIds] = useState<string[]>([]);

  const { data: filters } = useOwnerStatsFilters();

  const params = useMemo(
    () => ({ filiereIds: filiereIds.length > 0 ? filiereIds : undefined }),
    [filiereIds]
  );

  const { data, isLoading, error } = useOwnerPersonnes(params);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement de la démographie…
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Personnes</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Étudiants, enseignants et parents. Les totaux portent sur l&apos;ensemble du
            tenant, contrairement aux compteurs des pages Étudiants et Parents, calculés
            sur la page affichée.
          </p>
        </div>
        <ExportCsvButton
          endpoint="/api/v1/owner/personnes/export"
          queryString={buildQueryString(params)}
          filename="personnes.csv"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Filières</Label>
            <FiliereFilter
              filieres={filters?.filieres ?? []}
              value={filiereIds}
              onChange={setFiliereIds}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Étudiants actifs"
          value={String(data.kpis.activeStudents)}
          icon={GraduationCap}
        />
        <StatCard
          label="Enseignants actifs"
          value={String(data.kpis.activeTeachers)}
          icon={UserCog}
        />
        <StatCard label="Parents" value={String(data.kpis.parents)} icon={Users} />
        <StatCard
          label="Ratio étudiants / enseignant"
          value={
            data.kpis.studentTeacherRatio === null
              ? "—"
              : data.kpis.studentTeacherRatio.toFixed(1)
          }
          icon={Scale}
        />
        <StatCard
          label="Comptes sans identifiants"
          value={String(data.kpis.accountsWithoutCredentials)}
          hint="Mot de passe initial non généré"
          icon={KeyRound}
          deltaPolarity="lower-is-better"
        />
      </div>

      <Card className="border-border bg-muted/30">
        <CardContent className="py-4 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Portée du dernier indicateur.</span>{" "}
            Aucune colonne de la base ne trace l&apos;<em>envoi</em> des identifiants : ce
            compteur mesure les comptes dont le mot de passe initial n&apos;a pas été
            généré. Un compte doté d&apos;un mot de passe peut malgré tout ne jamais avoir
            reçu ses accès.
          </p>
          <p className="mt-2">
            L&apos;indicateur « étudiants redoublants » du cahier des charges n&apos;est pas
            affiché : la colonne correspondante n&apos;existe pas sur les profils étudiants.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <DonutChartCard
          title="Répartition par sexe"
          subtitle="Étudiants actifs du périmètre."
          slices={data.genderDistribution.map((g) => ({
            key: g.gender ?? "inconnu",
            label: genderLabel(g.gender),
            value: g.count,
          }))}
          centerLabel="étudiants"
          centerValue={String(data.kpis.activeStudents)}
        />

        <DonutChartCard
          title="Enseignants par type de contrat"
          slices={data.teachersByContract.map((c) => ({
            key: c.contractType,
            label: CONTRACT_LABELS[c.contractType] ?? c.contractType,
            value: c.count,
          }))}
          centerLabel="enseignants"
          centerValue={String(data.kpis.activeTeachers)}
        />

        <BarChartCard
          className="lg:col-span-2"
          title="Pyramide des âges"
          subtitle="Tranches de 2 ans, calculées depuis la date de naissance. Les dates aberrantes (âge hors 5–100 ans) sont écartées."
          data={data.agePyramid.map((a) => ({
            tranche: `${a.bucketStart}-${a.bucketStart + 1} ans`,
            effectif: a.count,
          }))}
          categoryKey="tranche"
          height={260}
          series={[{ key: "effectif", label: "Étudiants", color: VIZ_SEQUENTIAL[2] }]}
          footnote={
            data.coverage.studentsWithoutBirthDate > 0
              ? `${data.coverage.studentsWithoutBirthDate} étudiant${data.coverage.studentsWithoutBirthDate > 1 ? "s" : ""} sans date de naissance ne figure${data.coverage.studentsWithoutBirthDate > 1 ? "nt" : ""} pas dans cette pyramide.`
              : undefined
          }
        />

        <BarChartCard
          title="Effectifs par filière"
          data={data.headcountByFiliere.map((h) => ({
            filiere: h.filiereName,
            effectif: h.count,
          }))}
          categoryKey="filiere"
          orientation="horizontal"
          height={Math.max(220, data.headcountByFiliere.length * 26 + 60)}
          series={[{ key: "effectif", label: "Étudiants", color: VIZ_SEQUENTIAL[2] }]}
        />

        <BarChartCard
          title="Nationalités"
          subtitle="Dix nationalités les plus représentées."
          data={data.topNationalities.map((n) => ({
            nationalite: n.nationality,
            effectif: n.count,
          }))}
          categoryKey="nationalite"
          orientation="horizontal"
          height={Math.max(220, data.topNationalities.length * 26 + 60)}
          series={[{ key: "effectif", label: "Étudiants", color: VIZ_SEQUENTIAL[1] }]}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Couverture des données</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Rattachements manquants, à traiter avant toute campagne de communication.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 text-sm">
          {[
            {
              label: "Étudiants sans parent rattaché",
              value: data.coverage.studentsWithoutParent,
            },
            { label: "Parents sans enfant", value: data.coverage.parentsWithoutChild },
            {
              label: "Enseignants sans compte",
              value: data.coverage.teachersWithoutAccount,
            },
            {
              label: "Étudiants sans date de naissance",
              value: data.coverage.studentsWithoutBirthDate,
            },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border p-3">
              <p className="text-2xl font-semibold tabular-nums">{item.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enseignants</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enseignant</TableHead>
                <TableHead>Contrat</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Ancienneté</TableHead>
                <TableHead className="text-right">ECUE</TableHead>
                <TableHead className="text-right">Filières</TableHead>
                <TableHead className="text-right">Compte</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.teachers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground text-sm">
                    Aucun enseignant.
                  </TableCell>
                </TableRow>
              ) : (
                data.teachers.map((t) => (
                  <TableRow key={t.teacherId}>
                    <TableCell className="font-medium">{t.teacherName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {CONTRACT_LABELS[t.contractType] ?? t.contractType}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.status}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.seniorityYears === null ? "—" : `${t.seniorityYears} an${t.seniorityYears > 1 ? "s" : ""}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.ecueCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.filiereCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.hasUserAccount ? (
                        <span className="text-muted-foreground">Oui</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          Aucun
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
    </div>
  );
}
