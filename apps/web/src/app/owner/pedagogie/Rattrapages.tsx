"use client";

import { useMemo, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
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
import { useOwnerPedagogie, buildQueryString } from "@/lib/hooks/use-owner-pedagogie";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import type { OwnerUeCategorie } from "@ecoledigitale/contracts";

/**
 * Rattrapages — la session 2, vue comme un chantier et non comme un taux.
 *
 * LA QUESTION À LAQUELLE CET ONGLET RÉPOND
 *
 * L'onglet Professionnel dit déjà quelle PART des validations vient du
 * rattrapage. Celui-ci répond à la question d'avant : **qui est concerné, et
 * est-ce que ça marche ?**
 *
 * Une session de rattrapage coûte des salles, des surveillants et des
 * corrections. Si sa moyenne ne dépasse pas celle de la session normale, elle
 * ne rattrape personne — elle repousse. Les deux moyennes sont donc affichées
 * côte à côte : c'est le seul moyen de trancher, et aucune des deux ne se lit
 * seule.
 *
 * Les ECUE les plus reprises disent où le programme casse. Deux ECUE qui
 * concentrent les rattrapages d'une promotion justifient de revoir leur
 * volume horaire ou leur enseignant, pas d'ajouter une session.
 */

/** Une note absente n'est pas une note à zéro. */
function note(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

export function Rattrapages() {
  const { anneeScolaire, filiereIds, semestreId, nomClasse, categorie } = useOwnerFilters();
  const [statut] = useState<"en_cours" | "termine" | "tous">("tous");

  const params = useMemo(
    () => ({
      anneeScolaire,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      semestreId,
      nomClasse: nomClasse ?? undefined,
      statut,
      categorie: categorie as OwnerUeCategorie | undefined,
    }),
    [anneeScolaire, filiereIds, semestreId, nomClasse, statut, categorie]
  );

  const { data, isLoading, error } = useOwnerPedagogie(params);

  const construireRapport = (): OwnerReportContent => {
    const r = data!.rattrapage;
    return {
      filename: "rattrapages",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Étudiants en rattrapage", String(r.etudiantsConcernes)],
            ["Notes de session 2", String(r.notesSession2)],
            ["Moyenne session 2", note(r.moyenneSession2)],
            ["Moyenne session 1", note(r.moyenneSession1)],
          ],
        },
        { kind: "heading", text: "ECUE les plus reprises", level: 1 },
        tableOrNote(
          [
            { header: "ECUE" },
            { header: "Classe", width: 60 },
            { header: "Étudiants", width: 28, align: "right" },
            { header: "Moyenne", width: 28, align: "right" },
          ],
          r.ecueLesPlusReprises.map((e) => [
            `${e.code} — ${e.libelle}`,
            e.filiereName ?? "—",
            String(e.etudiants),
            note(e.moyenne),
          ]),
          "Aucune note de session 2 sur ce périmètre."
        ),
      ],
    };
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement des rattrapages…
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

  const r = data.rattrapage;
  /* Le rattrapage n'a d'intérêt que s'il fait progresser : on compare, on ne
     commente pas une moyenne isolée. `null` des deux côtés quand rien n'est
     mesurable — une session sans note n'a pas de moyenne. */
  const progresse =
    r.moyenneSession1 !== null && r.moyenneSession2 !== null
      ? r.moyenneSession2 - r.moyenneSession1
      : null;

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Rattrapages"
        question="Qui repasse, et est-ce que la session 2 rattrape vraiment ?"
        precision="Session 2 des unités d'enseignement professionnelles. La conduite en est exclue : elle se note, elle ne se repasse pas."
        pdf={data ? construireRapport : undefined}
        csv={{
          endpoint: "/api/v1/owner/pedagogie",
          queryString: `${buildQueryString(params)}&format=csv`,
          filename: "rattrapages.csv",
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Étudiants en rattrapage
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {r.etudiantsConcernes}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {r.notesSession2} note(s) de session 2
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Moyenne session 2
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {note(r.moyenneSession2)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Session 1 : {note(r.moyenneSession1)}
            </div>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              La session 2 fait-elle progresser ?
            </div>
            {progresse === null ? (
              /* Ni verdict ni flèche sans les deux moyennes : une couleur seule
                 n'est pas une information. */
              <div className="mt-1 text-sm italic text-muted-foreground">
                Non mesurable : il faut des notes dans les deux sessions.
              </div>
            ) : (
              <>
                <div
                  className="mt-1 text-2xl font-semibold tabular-nums"
                  style={{
                    color: progresse > 0 ? VIZ_STATUS.good : VIZ_STATUS.critical,
                  }}
                >
                  {progresse > 0 ? "+" : ""}
                  {progresse.toFixed(2)} point(s)
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {progresse > 0
                    ? "La session 2 relève le niveau des étudiants qui la passent."
                    : "La session 2 ne relève pas le niveau : elle repousse l'échec plutôt qu'elle ne le corrige."}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4" />
            ECUE les plus reprises
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Là où le programme casse. Deux ECUE qui concentrent les rattrapages d&apos;une
            promotion justifient de revoir leur volume horaire ou leur enseignant, pas
            d&apos;ajouter une session.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ECUE</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead className="text-right">Étudiants</TableHead>
                <TableHead className="text-right">Moyenne</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.ecueLesPlusReprises.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground">
                    Aucune note de session 2 sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                r.ecueLesPlusReprises.map((e) => (
                  <TableRow key={e.ecueId}>
                    <TableCell>
                      <div className="font-medium">{e.code}</div>
                      <div className="text-xs text-muted-foreground">{e.libelle}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.filiereName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.etudiants}</TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      style={
                        e.moyenne !== null && e.moyenne < 10
                          ? { color: VIZ_STATUS.critical }
                          : undefined
                      }
                    >
                      {note(e.moyenne)}
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
