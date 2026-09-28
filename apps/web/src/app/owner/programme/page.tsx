"use client";

import { useMemo, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
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
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import { VIZ_STATUS, formatFcfa } from "@/components/owner/charts/palette";
import { buildQueryString, useOwnerProgramme } from "@/lib/hooks/use-owner-programme";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";

/**
 * Programme — la dernière entrée manquante du miroir du menu administrateur.
 *
 * CE QU'IL AJOUTE
 *
 * Le catalogue disait ce que l'école propose ; il ne disait pas ce que chaque
 * unité d'enseignement RAPPORTE ni ce qu'elle PÈSE. Une UE est à la fois un
 * produit — un prix, des inscrits — et une brique pédagogique — des crédits, des
 * ECUE. Une UE à 150 000 FCFA qui pèse un crédit n'est pas le même objet qu'une
 * UE à 60 000 qui en pèse huit, et seule la lecture conjointe le montre.
 *
 * L'ÉCART DE MAQUETTE
 *
 * Le nombre de crédits AFFICHÉ sur l'UE et celui qui s'IMPRIME sur les relevés
 * peuvent diverger. Quand c'est le cas, le document officiel porte un faux — et
 * il faut le corriger avant de générer les bulletins d'une promotion, sinon il
 * faut réimprimer. La colonne le dit ; il n'y a pas de panneau d'alertes, parce
 * que ce n'est pas une anomalie de saisie à trier mais une donnée à lire dans sa
 * ligne.
 */
export default function OwnerProgrammePage() {
  const { anneeScolaire, filiereIds, nomClasse, semestreId } = useOwnerFilters();
  const [toutAfficher, setToutAfficher] = useState(false);

  const params = useMemo(
    () => ({
      anneeScolaire: anneeScolaire ?? undefined,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      nomClasse: nomClasse ?? undefined,
      semestreId,
    }),
    [anneeScolaire, filiereIds, nomClasse, semestreId]
  );

  const { data, isLoading, error } = useOwnerProgramme(params);

  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    return {
      filename: "programme",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["UE actives (hors conduite)", String(d.kpis.ueActives)],
            ["Dont déjà ouvertes", String(d.kpis.ueOuvertes)],
            ["ECUE actives", String(d.kpis.ecueActives)],
            [
              "Prix moyen d'une UE vendable",
              d.kpis.prixMoyen === null ? "Non mesuré" : formatFcfa(d.kpis.prixMoyen),
            ],
            ["Écarts de maquette", String(d.kpis.ecartsMaquette)],
            ["ECUE sans crédit", String(d.kpis.ecueSansCredit)],
            ["ECUE orphelines", String(d.kpis.ecueOrphelines)],
          ],
        },
        {
          kind: "note",
          text: "« Crédits affichés » est la valeur saisie sur l'UE ; « crédits calculés » est la somme des crédits de ses ECUE, seule valeur utilisée en pondération et imprimée sur les relevés. Un écart signifie que le document officiel porte un nombre de crédits faux.",
        },
        { kind: "heading", text: "Unités d'enseignement", level: 1 },
        tableOrNote(
          [
            { header: "Code", width: 40 },
            { header: "Libellé" },
            { header: "Classe", width: 50 },
            { header: "Aff.", width: 18, align: "right" },
            { header: "Calc.", width: 18, align: "right" },
            { header: "Écart", width: 18, align: "right" },
            { header: "Prix", width: 32, align: "right" },
            { header: "Ouv.", width: 18, align: "right" },
            { header: "Inscrits", width: 24, align: "right" },
            { header: "Heures", width: 22, align: "right" },
          ],
          d.ue.map((u) => [
            u.code,
            u.libelle,
            u.filiereName ?? "—",
            String(u.nbUv),
            String(u.sommeCredits),
            u.ecartMaquette ? "OUI" : "",
            formatFcfa(u.prix),
            String(u.ouvertures),
            String(u.inscrits),
            u.heuresPlanifiees === null ? "—" : String(u.heuresPlanifiees),
          ]),
          "Aucune UE sur ce périmètre."
        ),
        ...(d.volumeHoraire.mesurable
          ? []
          : [
              {
                kind: "note" as const,
                text: `Volume horaire non exploitable. ${d.volumeHoraire.raison ?? ""}`,
              },
            ]),
      ],
    };
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement du programme…
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
  const lignes = toutAfficher ? data.ue : data.ue.slice(0, 25);

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Programme (UE · ECUE · Semestres)"
        question="Que pèse chaque unité d'enseignement, et que rapporte-t-elle ?"
        precision="Les UE déjà ouvertes viennent en tête : une UE qui tourne se corrige avant les bulletins, une UE jamais ouverte se corrige quand on veut."
        pdf={data ? construireRapport : undefined}
        csv={{
          endpoint: "/api/v1/owner/programme",
          queryString: ["format=csv", buildQueryString(params)].filter(Boolean).join("&"),
          filename: "programme.csv",
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              UE actives
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{k.ueActives}</div>
            {/* Les UE de conduite sont exclues de ce compte : le tableau en
                dessous les liste pourtant, et sans cette phrase le lecteur
                compte deux lignes de plus qu'annoncé. */}
            <div className="mt-0.5 text-xs text-muted-foreground">
              dont {k.ueOuvertes} déjà ouverte(s) · conduite exclue
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Prix moyen d&apos;une UE
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {k.prixMoyen === null ? (
                <span className="text-sm italic text-muted-foreground">non mesuré</span>
              ) : (
                formatFcfa(k.prixMoyen)
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              UE vendables uniquement
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Écarts de maquette
            </div>
            <div
              className="mt-1 text-2xl font-semibold tabular-nums"
              style={k.ecartsMaquette > 0 ? { color: VIZ_STATUS.warning } : undefined}
            >
              {k.ecartsMaquette}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              crédits affichés ≠ crédits imprimés
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              ECUE actives
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{k.ecueActives}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {k.ecueSansCredit} sans crédit · {k.ecueOrphelines} orpheline(s)
            </div>
          </CardContent>
        </Card>
      </div>

      {k.ecartsMaquette > 0 && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <strong>Ce que signifie un écart de maquette.</strong> Les crédits affichés sur
          l&apos;UE et ceux qui s&apos;impriment sur les relevés diffèrent — c&apos;est la
          somme des crédits des ECUE qui sert de pondération et qui figure sur les documents.
          À corriger <em>avant</em> de générer les bulletins d&apos;une promotion, sinon il
          faut réimprimer.
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" />
            Unités d&apos;enseignement
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            « Aff. » = crédits saisis sur l&apos;UE · « Calc. » = somme des crédits de ses
            ECUE, la valeur qui s&apos;imprime.
            {!data.volumeHoraire.mesurable && ` ${data.volumeHoraire.raison}`}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UE</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead className="text-right">Aff.</TableHead>
                <TableHead className="text-right">Calc.</TableHead>
                <TableHead className="text-right">Prix</TableHead>
                <TableHead className="text-right">ECUE</TableHead>
                <TableHead className="text-right">Ouvertures</TableHead>
                <TableHead className="text-right">Inscrits</TableHead>
                <TableHead className="text-right">Heures</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-sm text-muted-foreground">
                    Aucune UE sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                lignes.map((u) => (
                  <TableRow key={u.ueId} className={u.ouvertures === 0 ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="font-medium">{u.code}</div>
                      <div className="text-xs text-muted-foreground">{u.libelle}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.filiereName ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      style={u.ecartMaquette ? { color: VIZ_STATUS.warning } : undefined}
                      title={
                        u.ecartMaquette
                          ? "Les crédits affichés diffèrent de ceux qui s'impriment sur les relevés"
                          : undefined
                      }
                    >
                      {u.nbUv}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      style={u.ecartMaquette ? { color: VIZ_STATUS.warning } : undefined}
                    >
                      {u.sommeCredits}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(u.prix)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.ecue}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.ouvertures}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.inscrits}</TableCell>
                    {/* « — » et non 0 : aucune séance horodatée ne veut pas dire
                        zéro heure de cours, mais aucun planning saisi. */}
                    <TableCell className="text-right tabular-nums">
                      {u.heuresPlanifiees === null ? (
                        <span className="text-xs italic text-muted-foreground">—</span>
                      ) : (
                        `${u.heuresPlanifiees} h`
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Aucune troncature silencieuse : on dit ce qui n'est pas montré. */}
          {data.ue.length > lignes.length && (
            <Button variant="outline" size="sm" onClick={() => setToutAfficher(true)}>
              Afficher les {data.ue.length - lignes.length} autres UE
            </Button>
          )}
          {data.ueTotal > data.ue.length && (
            <p className="text-xs text-muted-foreground">
              {data.ueTotal} UE au total sur ce périmètre ; l&apos;écran en charge{" "}
              {data.ue.length}. Utilisez l&apos;export pour la liste complète.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
