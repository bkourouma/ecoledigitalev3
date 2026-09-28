"use client";

import { useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
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
import { VIZ_STATUS } from "@/components/owner/charts/palette";
import { useOwnerPedagogie, buildQueryString } from "@/lib/hooks/use-owner-pedagogie";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import type { OwnerUeCategorie } from "@ecoledigitale/contracts";

/**
 * Bulletins — l'état de la chaîne, et l'endroit exact où elle casse.
 *
 * CE QUE CET ONGLET REND VISIBLE
 *
 * Un semestre **clôturé sans aucun bulletin** est un blocage sec : la clôture
 * dit « c'est fini », et les étudiants n'ont pourtant aucun relevé. Sans
 * bulletin définitif, ni diplôme, ni attestation, ni réinscription ne peuvent
 * suivre — la promotion entière s'arrête là, sans qu'aucun écran ne le dise.
 *
 * Ce n'est pas un défaut de saisie mais un état de la production pédagogique.
 * C'est pourquoi il vit ici, sur l'écran des résultats, et non dans un panneau
 * d'anomalies : le fondateur n'a pas à corriger une ligne, il a à demander que
 * les bulletins sortent.
 */
export function Bulletins() {
  const { anneeScolaire, filiereIds, semestreId, nomClasse, categorie } = useOwnerFilters();
  const [statut] = useState<"en_cours" | "termine" | "tous">("tous");
  const [toutAfficher, setToutAfficher] = useState(false);

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
    const b = data!.bulletins;
    return {
      filename: "bulletins",
      orientation: "portrait",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Bulletins générés", String(b.generes)],
            ["Dont définitifs", String(b.definitifs)],
            ["Semestres du périmètre", String(b.semestres)],
            ["Semestres clôturés", String(b.semestresClotures)],
            ["Clôturés SANS bulletin", String(b.semestresCloturesSansBulletin)],
          ],
        },
        { kind: "heading", text: "Par semestre", level: 1 },
        tableOrNote(
          [
            { header: "Semestre" },
            { header: "Classe", width: 60 },
            { header: "Clôturé le", width: 32, align: "right" },
            { header: "Bulletins", width: 28, align: "right" },
            { header: "Définitifs", width: 28, align: "right" },
          ],
          b.parSemestre.map((s) => [
            s.libelle,
            s.filiereName ?? "—",
            s.clotureLe ?? "—",
            String(s.bulletins),
            String(s.definitifs),
          ]),
          "Aucun semestre sur ce périmètre."
        ),
        {
          kind: "note",
          text: "Un semestre clôturé sans bulletin bloque tout ce qui suit : diplôme, attestation, réinscription.",
        },
      ],
    };
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement des bulletins…
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

  const b = data.bulletins;
  /* Le service trie déjà les clôturés sans bulletin en tête : c'est là que la
     chaîne casse, et c'est ce qu'on doit voir sans dérouler. */
  const lignes = toutAfficher ? b.parSemestre : b.parSemestre.slice(0, 15);

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Bulletins"
        question="Les bulletins sortent-ils, et où la chaîne s'arrête-t-elle ?"
        precision="Sans bulletin définitif, ni diplôme ni attestation ni réinscription ne peuvent suivre."
        pdf={data ? construireRapport : undefined}
        csv={{
          endpoint: "/api/v1/owner/pedagogie",
          queryString: `${buildQueryString(params)}&format=csv`,
          filename: "bulletins.csv",
        }}
      />

      {/* Le blocage passe en tête : c'est la seule chose de cet onglet sur
          laquelle on peut agir dans la journée. */}
      {b.semestresCloturesSansBulletin > 0 && (
        <Card style={{ borderColor: VIZ_STATUS.critical }}>
          <CardContent className="p-4 text-sm">
            <strong>
              {b.semestresCloturesSansBulletin} semestre(s) clôturé(s) sans aucun bulletin.
            </strong>{" "}
            La clôture annonce que le semestre est terminé, mais aucun étudiant n&apos;a de
            relevé : ni diplôme, ni attestation, ni réinscription ne peuvent suivre.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Bulletins générés", b.generes, `dont ${b.definitifs} définitif(s)`],
            ["Provisoires", b.provisoires, "en attente de validation"],
            ["Semestres clôturés", b.semestresClotures, `sur ${b.semestres} du périmètre`],
            [
              "Clôturés sans bulletin",
              b.semestresCloturesSansBulletin,
              "la chaîne s'arrête là",
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
                style={i === 3 && valeur > 0 ? { color: VIZ_STATUS.critical } : undefined}
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
            <FileText className="h-4 w-4" />
            Par semestre
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Les semestres clôturés sans bulletin sont en tête : c&apos;est là que la chaîne
            casse.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Semestre</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead>Clôturé le</TableHead>
                <TableHead className="text-right">Bulletins</TableHead>
                <TableHead className="text-right">Définitifs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    Aucun semestre sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                lignes.map((s) => {
                  const bloque = s.clotureLe !== null && s.bulletins === 0;
                  return (
                    <TableRow key={s.semestreId}>
                      <TableCell className="font-medium">{s.libelle}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.filiereName ?? "—"}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-sm"
                        style={bloque ? { color: VIZ_STATUS.critical } : undefined}
                      >
                        {s.clotureLe
                          ? new Date(s.clotureLe).toLocaleDateString("fr-FR")
                          : "—"}
                        {bloque && (
                          <div className="text-xs">clôturé sans bulletin</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.bulletins}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.definitifs}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Aucune troncature silencieuse : on dit ce qui n'est pas montré. */}
          {b.parSemestre.length > lignes.length && (
            <Button variant="outline" size="sm" onClick={() => setToutAfficher(true)}>
              Afficher les {b.parSemestre.length - lignes.length} autres semestres
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
