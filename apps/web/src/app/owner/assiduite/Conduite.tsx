"use client";

import { useMemo } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
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
import { useOwnerAssiduite, buildQueryString } from "@/lib/hooks/use-owner-assiduite";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";

/**
 * Conduite — la note de tenue, et les bulletins qu'elle bloque.
 *
 * POURQUOI ELLE VIT SUR L'ÉCRAN DES PRÉSENCES
 *
 * La conduite est une note, pas une présence. Mais elle sanctionne le même
 * comportement — la tenue et l'assiduité — et un fondateur les lit ensemble :
 * une classe très absente avec 16 de moyenne de conduite pose une question que
 * ni l'un ni l'autre chiffre ne pose seul.
 *
 * CE QU'IL FAUT VOIR EN PREMIER
 *
 * Un étudiant inscrit **sans note de conduite** empêche la génération de son
 * bulletin. Ce n'est pas une anomalie de saisie qu'on signale pour la forme :
 * c'est un relevé qui ne sortira pas, donc un diplôme et une réinscription qui
 * attendent. C'est le seul chiffre de cet onglet sur lequel on agit.
 */

/** Une note absente n'est pas une note à zéro. */
function note(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

/** Une fenêtre de dates par défaut, alignée sur celle de l'onglet Présences. */
function fenetreDe(
  period: string | undefined,
  dateDebut: string | undefined,
  dateFin: string | undefined
): { dateDebut?: string; dateFin?: string } {
  if (dateDebut || dateFin) return { dateDebut, dateFin };
  if (period === "year") {
    const d = new Date();
    const debut = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
    return { dateDebut: `${debut}-09-01`, dateFin: `${debut + 1}-08-31` };
  }
  return {};
}

export function Conduite() {
  const { anneeScolaire, filiereIds, nomClasse, semestreId, period, dateDebut, dateFin } =
    useOwnerFilters();

  const params = useMemo(
    () => ({
      ...fenetreDe(period, dateDebut, dateFin),
      anneeScolaire: anneeScolaire ?? undefined,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      nomClasse: nomClasse ?? undefined,
      semestreId,
    }),
    [period, dateDebut, dateFin, anneeScolaire, filiereIds, nomClasse, semestreId]
  );

  const { data, isLoading, error } = useOwnerAssiduite(params);

  const construireRapport = (): OwnerReportContent => {
    const c = data!.conduite;
    return {
      filename: "conduite",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Notes de conduite saisies", String(c.notesTotal)],
            ["Inscrits sans note", String(c.etudiantsSansNote)],
          ],
        },
        { kind: "heading", text: "Par classe", level: 1 },
        tableOrNote(
          [
            { header: "Classe" },
            { header: "Inscrits", width: 26, align: "right" },
            { header: "Notes", width: 24, align: "right" },
            { header: "Moyenne", width: 26, align: "right" },
            { header: "Min", width: 20, align: "right" },
            { header: "Max", width: 20, align: "right" },
            { header: "< 10", width: 20, align: "right" },
            { header: "Sans note", width: 26, align: "right" },
          ],
          c.parClasse.map((l) => [
            l.filiereName,
            String(l.inscrits),
            String(l.notes),
            note(l.moyenne),
            note(l.mini),
            note(l.maxi),
            String(l.sousLaMoyenne),
            String(l.sansNote),
          ]),
          "Aucune classe sur ce périmètre."
        ),
        {
          kind: "note",
          text: "Un inscrit sans note de conduite empêche la génération de son bulletin : ni diplôme ni réinscription ne peuvent suivre.",
        },
      ],
    };
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement de la conduite…
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

  const c = data.conduite;
  const avecNotes = c.parClasse.filter((l) => l.notes > 0);

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Conduite"
        question="La tenue est-elle notée, et quels bulletins attendent encore une note ?"
        precision="La conduite ne s'enseigne pas et ne se vend pas : l'administration l'attribue sur une unité dédiée, sans enseignant ni prix."
        pdf={data ? construireRapport : undefined}
        csv={{
          endpoint: "/api/v1/owner/assiduite/export",
          queryString: buildQueryString(params),
          filename: "conduite.csv",
        }}
      />

      {/* Le blocage passe en tête : c'est la seule chose sur laquelle on agit. */}
      {c.etudiantsSansNote > 0 && (
        <Card style={{ borderColor: VIZ_STATUS.critical }}>
          <CardContent className="p-4 text-sm">
            <strong>{c.etudiantsSansNote} inscrit(s) sans note de conduite.</strong> Leur
            bulletin ne peut pas être généré : ni diplôme, ni attestation, ni réinscription
            ne peuvent suivre tant que la note manque.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Notes saisies
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{c.notesTotal}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              sur {avecNotes.length} classe(s) notée(s)
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Inscrits sans note
            </div>
            <div
              className="mt-1 text-2xl font-semibold tabular-nums"
              style={c.etudiantsSansNote > 0 ? { color: VIZ_STATUS.critical } : undefined}
            >
              {c.etudiantsSansNote}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              autant de bulletins bloqués
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Notes sous la moyenne
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {c.parClasse.reduce((t, l) => t + l.sousLaMoyenne, 0)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              conduite strictement inférieure à 10
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Conduite par classe
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Une moyenne s&apos;écrit « — » quand la classe n&apos;a aucune note : un zéro se
            lirait « toute la classe a eu 0 de conduite ».
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classe</TableHead>
                <TableHead className="text-right">Inscrits</TableHead>
                <TableHead className="text-right">Notes</TableHead>
                <TableHead className="text-right">Moyenne</TableHead>
                <TableHead className="text-right">Min — Max</TableHead>
                <TableHead className="text-right">&lt; 10</TableHead>
                <TableHead className="text-right">Sans note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.parClasse.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    Aucune classe sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                c.parClasse.map((l) => (
                  <TableRow key={l.filiereId ?? l.filiereName}>
                    <TableCell className="font-medium">{l.filiereName}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.inscrits}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.notes}</TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      style={
                        l.moyenne !== null && l.moyenne < 10
                          ? { color: VIZ_STATUS.critical }
                          : undefined
                      }
                    >
                      {note(l.moyenne)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {l.mini === null ? "—" : `${note(l.mini)} — ${note(l.maxi)}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.sousLaMoyenne}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      style={l.sansNote > 0 ? { color: VIZ_STATUS.critical } : undefined}
                    >
                      {l.sansNote}
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
