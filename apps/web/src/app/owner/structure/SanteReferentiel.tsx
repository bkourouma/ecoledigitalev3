"use client";

import { useMemo } from "react";
import {
  Loader2,
  BookOpen,
  Library,
  GitMerge,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOwnerReferentiel } from "@/lib/hooks/use-owner-referentiel";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import type { ReportBlock } from "@/lib/utils/report-doc";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import { StatCard } from "@/components/owner/charts/StatCard";
import { formatFcfa } from "@/components/owner/charts/palette";
import { cn } from "@/lib/utils";
import type { OwnerUeCategorie } from "@ecoledigitale/contracts";


const CATEGORIE_LABELS: Record<OwnerUeCategorie, string> = {
  fondamentale: "Fondamentale",
  specialite: "Spécialité",
  culture_generale: "Culture générale",
};

/*
   LE CATALOGUE D'INCOHÉRENCES A ÉTÉ RETIRÉ DE CET ÉCRAN le 23/09/2026.

   Avec lui partent ISSUE_META, ISSUE_ORDER et SEVERITY_STYLES, qui ne
   décrivaient que son rendu. C'était un contrôle de qualité de saisie, pas une
   statistique de pilotage : il s'adresse à qui corrige, pas à qui décide.

   Il reste là où l'on agit : `/professionnel/admin/sessions/[id]` annonce
   « N ECUE obligatoire(s) sans enseignant » sur l'ouverture concernée, et porte
   le formulaire d'affectation. Signaler deux fois la même chose, dont une fois à
   qui ne peut rien y faire, ne corrigeait rien.
*/

export function SanteReferentiel() {
  /**
   * Cycle, filières ET catégorie d'UE viennent tous du filtre global : l'écran
   * ne porte plus aucun état de filtre.
   *
   * Un filtre inopérant avait été corrigé au passage : l'écran dérivait ses
   * cycles des LIBELLÉS portés par les filières et envoyait ce libellé dans
   * `cycleId`, que l'API attend en UUID. Choisir un cycle ne filtrait rien.
   */
  const { cycleId, filiereIds, categorie } = useOwnerFilters();

  const params = useMemo(
    () => ({
      cycleId,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      categorie: categorie as OwnerUeCategorie | undefined,
    }),
    [cycleId, filiereIds, categorie]
  );

  const { data, isLoading, error } = useOwnerReferentiel(params);

  /**
   * Le rapport suit l'écran : les indicateurs, puis une ligne par classe avec
   * son catalogue et son économie côte à côte.
   */
  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    const blocks: ReportBlock[] = [
      {
        kind: "keyValues",
        columns: 2,
        items: [
          ["Filières actives", String(d.kpis.activeFilieres)],
          ["UE actives", String(d.kpis.activeUe)],
          ["ECUE actives", String(d.kpis.activeEcue)],
          [
            "Crédits moyens par semestre",
            d.kpis.avgCreditsPerSemestre === null
              ? "Non mesuré"
              : d.kpis.avgCreditsPerSemestre.toFixed(1),
          ],
        ],
      },
    ];

    /*
       LES INCOHÉRENCES NE FIGURENT PLUS NI À L'ÉCRAN NI AU RAPPORT.

       Retiré de l'espace Propriétaire sur décision du 23/09/2026. C'est un
       contrôle de qualité de saisie, pas une statistique de pilotage : il
       s'adresse à qui corrige, pas à qui décide.

       LE CONTRÔLE N'EST PAS PERDU — il vit là où l'on agit :
       `/professionnel/admin/sessions/[id]` annonce « N ECUE obligatoire(s) sans
       enseignant » sur l'ouverture concernée, et c'est cet écran-là qui porte le
       formulaire d'affectation. Signaler deux fois la même chose, dont une fois
       à qui ne peut rien y faire, ne corrigeait rien.

       L'endpoint continue de calculer `issues` : le contrat l'expose et rien ne
       garantit qu'aucun autre client ne le lise. Son retrait éventuel relève du
       nettoyage de code mort (lot 5), pas de cette décision d'affichage.
    */
    blocks.push(
      { kind: "pageBreak" },
      { kind: "heading", text: "Classes", level: 1 },
      tableOrNote(
        [
          /* Les mêmes colonnes qu'à l'écran : un imprimé qui montre moins que la
             page se lit comme un autre état de l'école. */
          { header: "Classe" },
          { header: "Code", width: 24 },
          { header: "Cycle", width: 32 },
          { header: "Sem.", width: 20, align: "right" },
          { header: "UE", width: 18, align: "right" },
          { header: "Crédits", width: 24, align: "right" },
          { header: "Ouv.", width: 20, align: "right" },
          { header: "Étud.", width: 20, align: "right" },
          { header: "CA théorique", width: 36, align: "right" },
          { header: "Encaissé", width: 34, align: "right" },
        ],
        d.filieres.map((f) => [
          f.name,
          f.code,
          f.cycleName ?? "—",
          String(f.semestreCount),
          String(f.ueCount),
          String(f.sumCredits),
          String(f.ouvertureCount),
          /* Les deux effectifs quand ils divergent : les confirmés, et
             l'assiette réelle du CA théorique. */
          f.lotsFacturables === f.studentCount
            ? String(f.studentCount)
            : `${f.studentCount} (${f.lotsFacturables} fact.)`,
          f.caTheorique === null ? "non tarifée" : formatFcfa(f.caTheorique),
          formatFcfa(f.caEncaisse),
        ]),
        "Aucune classe sur ce périmètre."
      ),
      {
        kind: "note",
        text: "« Ouv. » à zéro signale une classe jamais ouverte. « non tarifée » signale l'absence de grille dans cycles_frais : chaque inscrit y est facturé 0, et le détail nominatif est sur l'écran Scolarité.",
      },
      { kind: "heading", text: "Barème de scolarité par classe", level: 1 },
      tableOrNote(
        [
          { header: "Classe" },
          { header: "Cycle", width: 32 },
          { header: "Inscription", width: 30, align: "right" },
          { header: "Scolarité", width: 30, align: "right" },
          { header: "Annexes", width: 28, align: "right" },
          { header: "Autres", width: 28, align: "right" },
          { header: "Total", width: 32, align: "right" },
        ],
        d.filieres.map((f) =>
          f.bareme == null
            ? [f.name, f.cycleName ?? "—", "non tarifée", "", "", "", ""]
            : [
                f.name,
                f.cycleName ?? "—",
                formatFcfa(f.bareme.inscription),
                formatFcfa(f.bareme.scolarite),
                formatFcfa(f.bareme.annexes),
                formatFcfa(f.bareme.autres),
                formatFcfa(f.baremeTotal ?? 0),
              ]
        ),
        "Aucune classe sur ce périmètre."
      )
    );

    return { filename: "catalogue", blocks };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Analyse du référentiel…
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
        title="Cycles, filières & classes"
        pdf={construireRapport}
      />

      {/*
        Plus aucune carte « Filtres » : cycle, filières et catégorie d'UE sont
        tous portés par la barre globale, en haut de l'écran.
      */}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Filières actives"
          value={String(data.kpis.activeFilieres)}
          icon={BookOpen}
        />
        <StatCard label="UE actives" value={String(data.kpis.activeUe)} icon={Library} />
        <StatCard label="ECUE actives" value={String(data.kpis.activeEcue)} icon={Library} />
        <StatCard
          label="Crédits par semestre"
          value={
            data.kpis.avgCreditsPerSemestre === null
              ? "—"
              : data.kpis.avgCreditsPerSemestre.toFixed(1)
          }
          hint="Moyenne des Σ crédits ECUE"
          icon={GitMerge}
        />
      </div>

      {/*
        LA CLASSE COMME LIGNE ÉCONOMIQUE.

        Un catalogue ne dit pas ce qu'il rapporte. Ce tableau répond à la
        question qu'on pose devant une liste de classes : laquelle tourne,
        laquelle dort, laquelle facture.

        Les coquilles vides se lisent ICI — une classe à 0 ouverture et 0
        étudiant se voit dans son propre tableau, sans panneau d'alertes séparé.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classes</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classe</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead className="text-right">Semestres</TableHead>
                <TableHead className="text-right">UE</TableHead>
                <TableHead className="text-right">Crédits</TableHead>
                <TableHead className="text-right">Ouvertures</TableHead>
                <TableHead className="text-right">Étudiants</TableHead>
                <TableHead className="text-right">CA théorique</TableHead>
                <TableHead className="text-right">Encaissé</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.filieres.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-sm text-muted-foreground">
                    Aucune classe sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                data.filieres.map((f) => {
                  const mismatch = f.sumNbUv > 0 && f.sumNbUv !== f.sumCredits;
                  /* Une classe qui n'a jamais ouvert n'est pas en défaut : elle
                     attend. On l'estompe, on ne l'alarme pas. */
                  const dort = f.ouvertureCount === 0;
                  return (
                    <TableRow key={f.filiereId} className={cn(dort && "opacity-60")}>
                      <TableCell className="font-medium">{f.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.cycleName ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.semestreCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{f.ueCount}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          mismatch && "font-medium text-amber-700 dark:text-amber-400"
                        )}
                        title={
                          mismatch
                            ? `UV déclarés : ${f.sumNbUv} — la pondération utilise les crédits`
                            : undefined
                        }
                      >
                        {f.sumCredits}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.ouvertureCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.studentCount}
                      </TableCell>
                      {/* Le CA théorique affiche son assiette : sans elle, la
                          multiplication n'est pas vérifiable, et un lecteur qui
                          voit « 0 étudiant » à côté de « 960 000 attendu »
                          cherche une erreur là où il y a deux définitions
                          d'effectif — les confirmés et les facturables. */}
                      <TableCell className="text-right tabular-nums">
                        {f.caTheorique === null ? (
                          <span className="text-xs italic text-muted-foreground">
                            non tarifée
                          </span>
                        ) : (
                          <>
                            {formatFcfa(f.caTheorique)}
                            {f.lotsFacturables !== f.studentCount && (
                              <div className="text-xs text-muted-foreground">
                                sur {f.lotsFacturables} lot(s) facturable(s)
                              </div>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatFcfa(f.caEncaisse)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/*
        LE BARÈME DE SCOLARITÉ PAR CLASSE — la grille saisie sur l'écran
        Scolarité (admin/finances/scolarite), en lecture seule. Une classe sans
        grille affiche « non tarifée », jamais 0 FCFA : elle n'est pas gratuite.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Barème de scolarité par classe</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classe</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead className="text-right">Inscription</TableHead>
                <TableHead className="text-right">Scolarité</TableHead>
                <TableHead className="text-right">Frais annexes</TableHead>
                <TableHead className="text-right">Autres frais</TableHead>
                <TableHead className="text-right">Total à payer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.filieres.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    Aucune classe sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                data.filieres.map((f) => (
                  <TableRow key={f.filiereId}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell className="text-muted-foreground">{f.cycleName ?? "—"}</TableCell>
                    {f.bareme == null ? (
                      <TableCell
                        colSpan={5}
                        className="text-right text-xs italic text-muted-foreground"
                      >
                        non tarifée
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="text-right tabular-nums">
                          {formatFcfa(f.bareme.inscription)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatFcfa(f.bareme.scolarite)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatFcfa(f.bareme.annexes)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatFcfa(f.bareme.autres)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatFcfa(f.baremeTotal ?? 0)}
                        </TableCell>
                      </>
                    )}
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
