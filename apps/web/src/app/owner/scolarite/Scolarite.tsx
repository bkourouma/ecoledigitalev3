"use client";

import { useMemo } from "react";
import { AlertTriangle, FileWarning, Receipt } from "lucide-react";
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
import { VIZ_STATUS, formatFcfa, formatPct } from "@/components/owner/charts/palette";
import { buildQueryString, useOwnerScolarite } from "@/lib/hooks/use-owner-scolarite";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";

/**
 * Scolarité — le barème et son application.
 *
 * CE QUE L'ÉCRAN DIT, ET CE QU'IL REFUSE DE DIRE
 *
 * Il compare ce qu'une classe DEVRAIT facturer, d'après sa grille tarifaire, à
 * ce qui a réellement été commandé. C'est la question qu'aucun écran ne posait :
 * `/owner/finances` a délibérément sorti la scolarité de son périmètre, et le
 * poste le plus lourd de l'école n'apparaissait donc nulle part.
 *
 * Mais il REFUSE de conclure tant qu'une classe du périmètre n'est pas tarifée.
 * Une classe sans grille ne doit pas zéro : elle ne doit rien de mesurable, et
 * son écart resterait faux dans les deux sens. L'écran affiche alors « commandé »
 * au lieu de « dû », met la colonne d'écart à « — », et remonte la liste des
 * classes concernées en tête : chaque inscrit y est facturé 0 sans que rien ne
 * l'annonce, et c'est de l'argent qui ne rentrera jamais.
 */

/* --------------------------------- Outils --------------------------------- */

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className="mt-1 text-2xl font-semibold tabular-nums"
          style={tone ? { color: tone } : undefined}
        >
          {value}
        </div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/** Un montant absent s'écrit « — », jamais « 0 FCFA ». */
function fcfaOrDash(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : formatFcfa(n);
}

/* --------------------------------- Page ----------------------------------- */

export function Scolarite() {
  const { anneeScolaire, filiereIds, nomClasse, semestreId } = useOwnerFilters();

  const params = useMemo(
    () => ({
      anneeScolaire: anneeScolaire ?? undefined,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      nomClasse: nomClasse ?? undefined,
      semestreId: semestreId ?? undefined,
    }),
    [anneeScolaire, filiereIds, nomClasse, semestreId]
  );

  const { data, isLoading, error } = useOwnerScolarite(params);

  const k = data?.kpis;
  const mesurable = data?.couverture.duInterpretable ?? false;

  const construireRapport = (): OwnerReportContent => ({
    title: "Scolarité — barème appliqué et facturation réelle",
    sections: [
      tableOrNote(
        "Par classe",
        ["Classe", "Inscrits", "Barème total", "Dû", "Commandé", "Encaissé", "Écart"],
        (data?.parClasse ?? []).map((c) => [
          c.filiereName ?? c.nomClasse,
          String(c.inscrits),
          fcfaOrDash(c.bareme?.total),
          fcfaOrDash(c.duBareme),
          formatFcfa(c.commande),
          formatFcfa(c.encaisse),
          fcfaOrDash(c.ecart),
        ]),
        "Aucune classe dans ce périmètre."
      ),
      tableOrNote(
        "Classes sans grille tarifaire",
        ["Classe", "Inscrits", "Commandé malgré tout"],
        (data?.trousFacturation ?? []).map((t) => [
          t.filiereName ?? "—",
          String(t.inscrits),
          formatFcfa(t.commande),
        ]),
        "Toutes les classes du périmètre sont tarifées."
      ),
    ],
  });

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">
          {(error as Error).message}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Inscriptions & effectifs inscrits"
        question="Chaque classe facture-t-elle bien ce que son barème prévoit ?"
        precision="L'unité est le lot (étudiant × classe) : c'est la seule qui porte une dette. Une classe sans grille tarifaire ne doit rien de mesurable — et surtout pas zéro."
        pdf={data ? construireRapport : undefined}
        csv={{
          endpoint: "/api/v1/owner/scolarite",
          queryString: ["format=csv", buildQueryString(params)].filter(Boolean).join("&"),
          filename: "scolarite-bareme.csv",
        }}
      />

      {/* Le trou de facturation passe AVANT les indicateurs : c'est la seule
          chose de cet écran sur laquelle on peut agir aujourd'hui. */}
      {(data?.trousFacturation.length ?? 0) > 0 && (
        <Card style={{ borderColor: VIZ_STATUS.critical }}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileWarning className="h-4 w-4" style={{ color: VIZ_STATUS.critical }} />
              Classes sans grille tarifaire
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Aucune ligne de barème n&apos;existe pour ces classes : chaque inscrit y est
              facturé 0 sans que rien ne le signale. Tant qu&apos;elles sont dans le périmètre,
              le dû total n&apos;est pas mesurable et la colonne « écart » reste vide.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Classe</TableHead>
                  <TableHead className="text-right">Inscrits</TableHead>
                  <TableHead className="text-right">Commandé malgré tout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.trousFacturation.map((t) => (
                  <TableRow key={t.filiereId}>
                    <TableCell className="font-medium">{t.filiereName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.inscrits}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(t.commande)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Indicateurs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={mesurable ? "Dû au barème" : "Dû au barème (partiel)"}
          value={isLoading && !data ? "…" : fcfaOrDash(k?.duBareme)}
          hint={
            mesurable
              ? `${k?.lots ?? 0} lot(s) tarifé(s)`
              : `Sur ${k?.lotsAvecBareme ?? 0} lot(s) tarifé(s) sur ${k?.lots ?? 0}`
          }
        />
        <Stat
          label="Commandé"
          value={isLoading && !data ? "…" : formatFcfa(k?.commande ?? 0)}
          hint="Toutes natures facturables"
        />
        <Stat
          label="Encaissé"
          value={isLoading && !data ? "…" : formatFcfa(k?.encaisse ?? 0)}
          hint={`Reste à recouvrer : ${formatFcfa(k?.resteDu ?? 0)}`}
          tone={(k?.resteDu ?? 0) > 0 ? VIZ_STATUS.warning : VIZ_STATUS.good}
        />
        <Stat
          label="Écart barème / commandé"
          value={isLoading && !data ? "…" : fcfaOrDash(k?.ecartBaremeCommande)}
          hint={
            k?.ecartBaremeCommande === null || k?.ecartBaremeCommande === undefined
              ? "Non mesurable : aucune classe tarifée ici"
              : "Sur le seul périmètre tarifé"
          }
          tone={
            k?.ecartBaremeCommande === null || k?.ecartBaremeCommande === undefined
              ? undefined
              : k.ecartBaremeCommande < 0
                ? VIZ_STATUS.critical
                : VIZ_STATUS.good
          }
        />
      </div>

      {/* Entonnoir */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">De l&apos;inscription au paiement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {data?.entonnoir.map((e) => (
              <div key={e.cle} className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{e.libelle}</div>
                {e.mesuree ? (
                  <div className="mt-1 text-xl font-semibold tabular-nums">{e.valeur}</div>
                ) : (
                  /* Ni chiffre ni zéro : la source n'existe pas dans cet
                     environnement, et un zéro se lirait « aucune demande ». */
                  <div className="mt-1 text-sm italic text-muted-foreground">Non mesuré</div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Par classe */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" />
            Barème et facturation, par classe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classe</TableHead>
                <TableHead className="text-right">Inscrits</TableHead>
                <TableHead className="text-right">Barème / lot</TableHead>
                <TableHead className="text-right">Dû</TableHead>
                <TableHead className="text-right">Commandé</TableHead>
                <TableHead className="text-right">Encaissé</TableHead>
                <TableHead className="text-right">Écart</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.parClasse ?? []).map((c) => (
                <TableRow key={c.cleClasse}>
                  <TableCell className="font-medium">
                    {c.filiereName ?? c.nomClasse}
                    {c.bareme === null && (
                      <span
                        className="ml-2 inline-flex items-center gap-1 text-xs"
                        style={{ color: VIZ_STATUS.critical }}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        non tarifée
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.inscrits}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fcfaOrDash(c.bareme?.total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fcfaOrDash(c.duBareme)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatFcfa(c.commande)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatFcfa(c.encaisse)}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    style={
                      c.ecart === null
                        ? undefined
                        : { color: c.ecart < 0 ? VIZ_STATUS.critical : VIZ_STATUS.good }
                    }
                  >
                    {fcfaOrDash(c.ecart)}
                  </TableCell>
                </TableRow>
              ))}
              {(data?.parClasse.length ?? 0) === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Aucune classe dans ce périmètre.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Par nature, et anomalies */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ce qui est facturé, par nature</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nature</TableHead>
                  <TableHead className="text-right">Commandes</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right">Encaissé</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.parNature ?? []).map((n) => (
                  <TableRow key={n.nature}>
                    <TableCell>{n.libelle}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.commandes}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(n.montant)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(n.encaisse)}
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.parNature.length ?? 0) === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      Aucune commande dans ce périmètre.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Points à vérifier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">Commandes sans inscription d&apos;UE</div>
                <div className="text-xs text-muted-foreground">
                  Normalement les frais — inscription, scolarité, annexes. Leur montant doit
                  rester visible : deux jointures internes le faisaient disparaître des écrans
                  d&apos;argent.
                </div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <div className="font-semibold">{data?.anomalies.commandesSansInscription ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  {formatFcfa(data?.anomalies.montantSansInscription ?? 0)}
                </div>
              </div>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">Inscriptions sans commande</div>
                <div className="text-xs text-muted-foreground">
                  Un étudiant inscrit que rien ne facture.
                </div>
              </div>
              <div className="shrink-0 font-semibold tabular-nums">
                {data?.anomalies.inscritsSansCommande ?? 0}
              </div>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">Lots sans grille tarifaire</div>
                <div className="text-xs text-muted-foreground">
                  Couverture du barème :{" "}
                  {data?.couverture.partTarifee === null ||
                  data?.couverture.partTarifee === undefined
                    ? "—"
                    : formatPct(data.couverture.partTarifee)}
                </div>
              </div>
              <div
                className="shrink-0 font-semibold tabular-nums"
                style={
                  (data?.anomalies.lotsSansBareme ?? 0) > 0
                    ? { color: VIZ_STATUS.critical }
                    : undefined
                }
              >
                {data?.anomalies.lotsSansBareme ?? 0}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
