"use client";

import { useMemo } from "react";
import { Award, FileSignature, Loader2, UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import { VIZ_STATUS } from "@/components/owner/charts/palette";
import { buildQueryString, useOwnerDocuments } from "@/lib/hooks/use-owner-documents";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";

/**
 * Documents officiels — trois entrées au menu administrateur, aucune couverture
 * propriétaire jusqu'ici.
 *
 * DEUX FAITS QUE RIEN NE MONTRAIT
 *
 * 1. L'ÉLIGIBLE NON DIPLÔMÉ. Il a payé, il a validé ses UV, il attend un papier.
 *    C'est un dossier fini qui dort, et un client mécontent qui ne le dit pas.
 *
 * 2. L'OCTROI SANS LES UV. Plus rare, plus grave : un titre délivré à quelqu'un
 *    qui n'a pas les crédits. Pas une faute de frappe — un diplôme attaquable.
 *
 * ET UN TROISIÈME, QUI N'EST PAS UN CHIFFRE
 *
 * Les quatre signataires livrés avec l'application sont des NOMS DE PERSONNES
 * RÉELLES. Tant qu'un établissement ne les a pas remplacés, ses diplômes portent
 * la signature de gens qui n'ont jamais vu ses étudiants, et rien ne le signale
 * puisque le document sort correctement formé. Cet écran est le seul endroit où
 * cela se voit.
 */
export default function OwnerDocumentsPage() {
  const { anneeScolaire, filiereIds, nomClasse, semestreId } = useOwnerFilters();

  const params = useMemo(
    () => ({
      anneeScolaire: anneeScolaire ?? undefined,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      nomClasse: nomClasse ?? undefined,
      semestreId,
    }),
    [anneeScolaire, filiereIds, nomClasse, semestreId]
  );

  const { data, isLoading, error } = useOwnerDocuments(params);

  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    return {
      filename: "documents-officiels",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Diplômes définis", String(d.kpis.diplomesDefinis)],
            ["Candidats", String(d.kpis.candidats)],
            ["Éligibles", String(d.kpis.eligibles)],
            ["Octroyés", String(d.kpis.octroyes)],
            ["Éligibles non diplômés", String(d.kpis.eligiblesNonDiplomes)],
            ["Octrois sans les UV requises", String(d.kpis.octroyesSansUv)],
          ],
        },
        { kind: "heading", text: "Pipeline de diplomation", level: 1 },
        tableOrNote(
          [
            { header: "Diplôme" },
            { header: "UV req.", width: 24, align: "right" },
            { header: "Candidats", width: 26, align: "right" },
            { header: "Éligibles", width: 26, align: "right" },
            { header: "Octroyés", width: 24, align: "right" },
            { header: "Élig. non dipl.", width: 32, align: "right" },
            { header: "Octrois sans UV", width: 32, align: "right" },
          ],
          d.pipeline.map((p) => [
            `${p.code} — ${p.libelle}`,
            String(p.uvRequises),
            String(p.candidats),
            String(p.eligibles),
            String(p.octroyes),
            String(p.eligiblesNonDiplomes),
            String(p.octroyesSansUv),
          ]),
          "Aucun diplôme défini sur ce périmètre."
        ),
        { kind: "heading", text: "Signataires", level: 1 },
        tableOrNote(
          [
            { header: "Titre" },
            { header: "Nom", width: 70 },
            { header: "Valeur par défaut", width: 40, align: "right" },
          ],
          d.signataires.map((s) => [
            s.cle,
            s.nom,
            s.estValeurParDefaut ? "OUI" : "non",
          ]),
          "Aucun signataire."
        ),
        ...(d.signatairesParDefaut > 0
          ? [
              {
                kind: "note" as const,
                text: `${d.signatairesParDefaut} signataire(s) portent encore le nom livré par défaut avec l'application. Ce sont des personnes réelles, étrangères à cet établissement, dont le nom s'imprime sur les diplômes.`,
              },
            ]
          : []),
        { kind: "heading", text: "Complétude des dossiers", level: 1 },
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Étudiants actifs", String(d.dossiers.etudiants)],
            ["Sans date de naissance", String(d.dossiers.sansDateNaissance)],
            ["Sans lieu de naissance", String(d.dossiers.sansLieuNaissance)],
            ["Sans matricule", String(d.dossiers.sansMatricule)],
          ],
        },
        { kind: "note", text: d.attestations.raison ?? "" },
      ],
    };
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement des documents officiels…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardContent className="p-6 text-sm text-red-700">
          {error instanceof Error ? error.message : "Impossible de charger les données."}
        </CardContent>
      </Card>
    );
  }

  const k = data.kpis;

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Attestations, diplômes & signataires"
        question="Qui mérite son diplôme et ne l'a pas — et qui signe nos documents ?"
        precision="Un étudiant éligible jamais diplômé est un dossier fini. Un diplôme octroyé sans les UV requises est un titre attaquable."
        pdf={data ? construireRapport : undefined}
        csv={{
          endpoint: "/api/v1/owner/documents",
          queryString: ["format=csv", buildQueryString(params)].filter(Boolean).join("&"),
          filename: "documents-officiels.csv",
        }}
      />

      {/*
        LES SIGNATAIRES PASSENT EN PREMIER quand ils sont aux valeurs par défaut.
        C'est le seul point de cet écran qui engage des personnes extérieures à
        l'établissement, et il ne se voit nulle part ailleurs.
      */}
      {data.signatairesParDefaut > 0 && (
        <Card style={{ borderColor: VIZ_STATUS.critical }}>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <FileSignature className="h-4 w-4" style={{ color: VIZ_STATUS.critical }} />
              {data.signatairesParDefaut} signataire(s) portent encore le nom livré par défaut
            </div>
            <p>
              Ce sont des <strong>noms de personnes réelles</strong>, livrés avec
              l&apos;application et étrangers à cet établissement. Tant qu&apos;ils ne sont pas
              remplacés, leur signature s&apos;imprime sur vos diplômes et vos attestations —
              et rien ne le signale, puisque le document sort correctement formé.
            </p>
          </CardContent>
        </Card>
      )}

      {k.octroyesSansUv > 0 && (
        <Card style={{ borderColor: VIZ_STATUS.critical }}>
          <CardContent className="p-4 text-sm">
            <strong>
              {k.octroyesSansUv} diplôme(s) octroyé(s) sans les UV requises.
            </strong>{" "}
            Le titulaire n&apos;atteint pas le nombre de crédits que le diplôme exige. Ce
            n&apos;est pas une erreur de saisie : c&apos;est un titre délivré à tort.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Candidats", k.candidats, "inscrits d'une filière diplômante"],
            ["Éligibles", k.eligibles, "UV requises acquises"],
            ["Octroyés", k.octroyes, "révocations exclues"],
            [
              "Éligibles non diplômés",
              k.eligiblesNonDiplomes,
              "dossiers finis qui attendent",
            ],
          ] as Array<[string, number, string]>
        ).map(([label, valeur, hint], i) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {label}
              </div>
              <div
                className="mt-1 text-2xl font-semibold tabular-nums"
                style={i === 3 && valeur > 0 ? { color: VIZ_STATUS.warning } : undefined}
              >
                {valeur}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="h-4 w-4" />
            Pipeline de diplomation
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Du candidat à l&apos;octroi, par diplôme. Les deux dernières colonnes sont les
            seules qui appellent une décision.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Diplôme</TableHead>
                <TableHead className="text-right">UV requises</TableHead>
                <TableHead className="text-right">Candidats</TableHead>
                <TableHead className="text-right">Éligibles</TableHead>
                <TableHead className="text-right">Octroyés</TableHead>
                <TableHead className="text-right">Révoqués</TableHead>
                <TableHead className="text-right">Élig. non diplômés</TableHead>
                <TableHead className="text-right">Octrois sans UV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pipeline.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-sm text-muted-foreground">
                    Aucun diplôme défini sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                data.pipeline.map((p) => (
                  <TableRow key={p.diplomaId}>
                    <TableCell>
                      <div className="font-medium">{p.code}</div>
                      <div className="text-xs text-muted-foreground">{p.libelle}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.uvRequises}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.candidats}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.eligibles}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.octroyes}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.revoques}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      style={
                        p.eligiblesNonDiplomes > 0 ? { color: VIZ_STATUS.warning } : undefined
                      }
                    >
                      {p.eligiblesNonDiplomes}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      style={
                        p.octroyesSansUv > 0 ? { color: VIZ_STATUS.critical } : undefined
                      }
                    >
                      {p.octroyesSansUv}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSignature className="h-4 w-4" />
              Signataires des documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titre</TableHead>
                  <TableHead>Nom imprimé</TableHead>
                  <TableHead className="text-right">État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.signataires.map((s) => (
                  <TableRow key={s.cle}>
                    <TableCell className="text-sm text-muted-foreground">{s.cle}</TableCell>
                    <TableCell>
                      <div className="font-medium">{s.nom}</div>
                      {s.fonction && (
                        <div className="text-xs text-muted-foreground">
                          {s.fonction.split("\n")[0]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-right text-xs"
                      style={
                        s.estValeurParDefaut ? { color: VIZ_STATUS.critical } : undefined
                      }
                    >
                      {s.estValeurParDefaut ? "valeur par défaut" : "configuré"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="h-4 w-4" />
              Complétude des dossiers
            </CardTitle>
            <p className="text-xs font-normal text-muted-foreground">
              Un champ manquant, c&apos;est un diplôme non imprimable le jour de la
              cérémonie.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(
              [
                ["Étudiants actifs", data.dossiers.etudiants, false],
                ["Sans date de naissance", data.dossiers.sansDateNaissance, true],
                ["Sans lieu de naissance", data.dossiers.sansLieuNaissance, true],
                ["Sans matricule", data.dossiers.sansMatricule, true],
              ] as Array<[string, number, boolean]>
            ).map(([label, valeur, alerte]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span>{label}</span>
                <span
                  className="font-semibold tabular-nums"
                  style={alerte && valeur > 0 ? { color: VIZ_STATUS.critical } : undefined}
                >
                  {valeur}
                </span>
              </div>
            ))}

            {/* Le volume d'attestations n'a aucune source : on le DIT, plutôt
                que d'afficher un zéro qui se lirait « aucune n'a été émise ». */}
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <strong>Attestations : volume non mesurable.</strong>{" "}
              {data.attestations.raison}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
