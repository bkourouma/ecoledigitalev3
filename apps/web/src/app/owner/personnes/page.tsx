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
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { jourFr, tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
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
  /**
   * Année ET filières. Les deux agissent réellement depuis que le périmètre se
   * lit sur les inscriptions professionnelles : auparavant le filtre filière
   * passait par `student_enrollments`, table vide, et vidait l'écran entier.
   */
  const { anneeScolaire, filiereIds } = useOwnerFilters();

  const params = useMemo(
    () => ({
      anneeScolaire: anneeScolaire ?? undefined,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
    }),
    [anneeScolaire, filiereIds]
  );

  const { data, isLoading, error } = useOwnerPersonnes(params);

  /**
   * La couverture des données ferme le rapport plutôt que de l'ouvrir : ce sont
   * des trous à combler, pas des chiffres à lire. Mais elle y figure — un
   * effectif dont un quart des dates de naissance manque se lit autrement.
   */
  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    return {
      filename: "effectifs",
      orientation: "portrait",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Étudiants actifs", String(d.kpis.activeStudents)],
            ["Enseignants actifs", String(d.kpis.activeTeachers)],
            ["Parents", String(d.kpis.parents)],
            [
              "Ratio étudiants / enseignant",
              d.kpis.studentTeacherRatio === null
                ? "Non mesuré"
                : d.kpis.studentTeacherRatio.toFixed(1),
            ],
            ["Comptes sans identifiants", String(d.kpis.accountsWithoutCredentials)],
          ],
        },
        { kind: "heading", text: "Effectifs par filière", level: 1 },
        tableOrNote(
          [
            { header: "Filière" },
            { header: "Cycle", width: 45 },
            { header: "Étudiants", width: 30, align: "right" },
          ],
          d.headcountByFiliere.map((f) => [
            f.filiereName,
            f.cycleName ?? "—",
            String(f.count),
          ]),
          "Aucun étudiant rattaché à une filière.",
          [
            "Total",
            "",
            String(d.headcountByFiliere.reduce((s, f) => s + f.count, 0)),
          ]
        ),
        { kind: "heading", text: "Répartition par sexe", level: 1 },
        tableOrNote(
          [{ header: "Sexe" }, { header: "Étudiants", width: 30, align: "right" }],
          d.genderDistribution.map((g) => [genderLabel(g.gender), String(g.count)]),
          "Aucune donnée de sexe renseignée."
        ),
        { kind: "heading", text: "Pyramide des âges", level: 1 },
        tableOrNote(
          [{ header: "Tranche d'âge" }, { header: "Étudiants", width: 30, align: "right" }],
          d.agePyramid.map((a) => [
            `${a.bucketStart} – ${a.bucketStart + 1} ans`,
            String(a.count),
          ]),
          "Aucune date de naissance exploitable."
        ),
        { kind: "heading", text: "Nationalités les plus représentées", level: 1 },
        tableOrNote(
          [{ header: "Nationalité" }, { header: "Étudiants", width: 30, align: "right" }],
          d.topNationalities.map((n) => [n.nationality, String(n.count)]),
          "Aucune nationalité renseignée."
        ),
        { kind: "heading", text: "Enseignants par type de contrat", level: 1 },
        tableOrNote(
          [{ header: "Contrat" }, { header: "Enseignants", width: 30, align: "right" }],
          d.teachersByContract.map((c) => [
            CONTRACT_LABELS[c.contractType] ?? c.contractType,
            String(c.count),
          ]),
          "Aucun type de contrat renseigné."
        ),
        { kind: "pageBreak" },
        { kind: "heading", text: "Enseignants", level: 1 },
        tableOrNote(
          [
            { header: "Nom" },
            { header: "Contrat", width: 30 },
            { header: "Statut", width: 26 },
            { header: "Embauche", width: 28, align: "right" },
            { header: "Ancienneté", width: 26, align: "right" },
            { header: "ECUE", width: 20, align: "right" },
            { header: "Filières", width: 22, align: "right" },
            { header: "Compte", width: 22 },
          ],
          d.teachers.map((t) => [
            t.teacherName,
            CONTRACT_LABELS[t.contractType] ?? t.contractType,
            t.status,
            t.hireDate ? jourFr(t.hireDate) : "—",
            t.seniorityYears === null ? "—" : `${t.seniorityYears.toFixed(1)} an(s)`,
            String(t.ecueCount),
            String(t.filiereCount),
            t.hasUserAccount ? "Oui" : "Non",
          ]),
          "Aucun enseignant enregistré."
        ),
        { kind: "heading", text: "Couverture des données", level: 1 },
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Étudiants sans parent rattaché", String(d.coverage.studentsWithoutParent)],
            ["Parents sans enfant rattaché", String(d.coverage.parentsWithoutChild)],
            ["Enseignants sans compte", String(d.coverage.teachersWithoutAccount)],
            [
              "Étudiants sans date de naissance",
              String(d.coverage.studentsWithoutBirthDate),
            ],
          ],
        },
      ],
    };
  };

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
      <OwnerPageHeader
        title="Effectifs"
        question="Combien d'élèves, qui sont-ils, où sont-ils ?"
        precision={`Les totaux portent sur l'ensemble de l'établissement, contrairement aux compteurs des écrans Étudiants et Parents, calculés sur la page affichée. ${
          anneeScolaire
            ? `Périmètre : ${anneeScolaire}.`
            : "Toutes années cumulées : un étudiant passé par plusieurs promotions compte dans chacune, la somme des effectifs par filière dépasse donc le nombre de personnes."
        }`}
        pdf={construireRapport}
        csv={{
          endpoint: "/api/v1/owner/personnes/export",
          queryString: buildQueryString(params),
          filename: "effectifs.csv",
        }}
      />

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
          hint="Étudiants, parents et enseignants du périmètre"
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
            reçu ses accès. Il ne porte que sur les personnes de cet écran —
            étudiants du périmètre, leurs parents, enseignants — et non sur les comptes
            d&apos;administration.
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
