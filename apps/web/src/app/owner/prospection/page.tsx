"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  BadgePercent,
  UserCheck,
  Loader2,
  Megaphone,
  Users,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OWNER_PROSPECTION_CANAL_LABELS } from "@ecoledigitale/contracts";
import type { OwnerProspectionCanal } from "@ecoledigitale/contracts";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import {
  buildProspectionQueryString,
  useOwnerProspection,
} from "@/lib/hooks/use-owner-prospection";
import { StatCard } from "@/components/owner/charts/StatCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import { LineChartCard } from "@/components/owner/charts/LineChartCard";
import { DonutChartCard } from "@/components/owner/charts/DonutChartCard";
import {
  VIZ_SERIES,
  VIZ_SEQUENTIAL,
  VIZ_STATUS,
  formatFcfa,
  formatFcfaCompact,
  formatPct,
} from "@/components/owner/charts/palette";
import { jourFr, tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";

/**
 * Prospection — lecture propriétaire.
 *
 * L'écran d'exploitation vit ailleurs (`/professionnel/admin/prospection`) :
 * on y saisit une provenance, on y règle une commission ligne à ligne. Ici,
 * rien ne se saisit. Trois questions, dans cet ordre :
 *
 *   1. SAIT-ON D'OÙ VIENNENT LES ÉTUDIANTS ? La couverture ouvre la page, avant
 *      toute répartition, parce qu'elle la qualifie. Une part de canal établie
 *      sur un tiers des fiches décrit ce tiers — l'afficher sans le dire
 *      transformerait un trou de saisie en décision marketing.
 *   2. QUEL CANAL RAPPORTE ? Pas « lequel amène le plus de monde » : le tableau
 *      par canal porte l'encaissé, l'encaissé par étudiant et le net après
 *      commission. Un canal qui amène beaucoup d'impayés ne rapporte rien.
 *   3. COMBIEN COÛTENT LES COMMERCIAUX, et combien leur reste-t-il dû ?
 *
 * MAILLE — un étudiant appartient à l'année et à la filière de sa première
 * ouverture de classe, et tout ce qu'il a payé lui reste rattaché, même des
 * années plus tard. Une commission rémunère un étudiant amené : ce coût
 * appartient à la cohorte qui l'a engendré.
 *
 * OÙ NAÎT LA DONNÉE — la provenance se saisit à la création de l'étudiant, et
 * elle y est FACULTATIVE : une fiche créée sans ce bloc reste sans provenance,
 * et rien ne la réclamera ensuite. C'est l'origine mécanique du trou de
 * couverture, et c'est pourquoi le bandeau nomme cet écran plutôt que de dire
 * « saisissez mieux ».
 */

/** Couleur par canal, stable d'un bloc à l'autre de l'écran. */
const CANAL_COLORS: Record<OwnerProspectionCanal, string> = {
  commercial: VIZ_SERIES[0],
  google: VIZ_SERIES[1],
  facebook: VIZ_SERIES[2],
  autre_media: VIZ_SERIES[3],
  connaissance: VIZ_SERIES[4],
  etudiant: VIZ_SERIES[5 % VIZ_SERIES.length],
  autre: VIZ_SEQUENTIAL[1],
  // L'inconnu se lit comme un manque, pas comme un canal de plus.
  non_renseigne: VIZ_STATUS.warning,
};

const canalLabel = (canal: OwnerProspectionCanal): string =>
  OWNER_PROSPECTION_CANAL_LABELS[canal] ?? canal;

const fcfa0 = (n: number | null): string => (n === null ? "—" : formatFcfa(n));

export default function OwnerProspectionPage() {
  const { anneeScolaire, filiereIds, nomClasse } = useOwnerFilters();
  const { data, isLoading, error } = useOwnerProspection(anneeScolaire, filiereIds, nomClasse);

  const queryString = useMemo(
    () => buildProspectionQueryString(anneeScolaire, filiereIds, nomClasse),
    [anneeScolaire, filiereIds, nomClasse]
  );

  /**
   * La couverture ouvre le rapport, comme elle ouvre l'écran : imprimé sans
   * elle, un camembert de canaux se lit comme une vérité d'établissement.
   */
  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    return {
      filename: "prospection",
      orientation: "landscape",
      blocks: [
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Étudiants du périmètre", String(d.couverture.etudiants)],
            [
              "Provenance connue",
              `${d.couverture.renseignes} (${formatPct(d.kpis.couverture)})`,
            ],
            ["Provenance inconnue", String(d.couverture.nonRenseignes)],
            ["Scolarité encaissée", formatFcfa(d.kpis.scolariteEncaissee)],
            [
              "Scolarité non rattachée à un canal",
              formatFcfa(d.couverture.scolariteNonRattachee),
            ],
            ["Étudiants amenés par un commercial", String(d.kpis.viaCommercial)],
            ["Commission acquise", formatFcfa(d.kpis.commissionAcquise)],
            ["Commission versée", formatFcfa(d.kpis.commissionVersee)],
            ["Reste dû aux commerciaux", formatFcfa(d.kpis.commissionDue)],
            ["Taux effectif consenti", formatPct(d.kpis.tauxEffectif)],
          ],
        },
        ...(d.couverture.representative
          ? []
          : [
              {
                kind: "note" as const,
                text:
                  `Provenance connue pour ${d.couverture.renseignes} étudiant(s) sur ` +
                  `${d.couverture.etudiants}. La répartition par canal ci-dessous décrit ` +
                  `cette part-là, pas l'établissement. La provenance se renseigne à la ` +
                  `création de la fiche de l'étudiant, où elle est facultative.`,
              },
            ]),
        { kind: "heading", text: "Par canal", level: 1 },
        tableOrNote(
          [
            { header: "Canal" },
            { header: "Étudiants", width: 24, align: "right" },
            { header: "Part", width: 20, align: "right" },
            { header: "Scolarité encaissée", width: 38, align: "right" },
            { header: "Par étudiant", width: 32, align: "right" },
            { header: "Commission", width: 32, align: "right" },
            { header: "Net", width: 38, align: "right" },
          ],
          d.parCanal.map((c) => [
            canalLabel(c.canal),
            String(c.etudiants),
            formatPct(c.part),
            formatFcfa(c.scolariteEncaissee),
            fcfa0(c.scolariteParEtudiant),
            formatFcfa(c.commissionAcquise),
            formatFcfa(c.net),
          ]),
          "Aucun étudiant dans le périmètre."
        ),
        { kind: "heading", text: "Commerciaux", level: 1 },
        tableOrNote(
          [
            { header: "Commercial" },
            { header: "Étudiants", width: 24, align: "right" },
            { header: "Scolarité encaissée", width: 38, align: "right" },
            { header: "Commission acquise", width: 36, align: "right" },
            { header: "Versée", width: 32, align: "right" },
            { header: "Reste dû", width: 32, align: "right" },
            { header: "Taux effectif", width: 26, align: "right" },
          ],
          d.commerciaux.map((c) => [
            c.actif ? c.nom : `${c.nom} (inactif)`,
            String(c.etudiants),
            formatFcfa(c.scolariteEncaissee),
            formatFcfa(c.commissionAcquise),
            formatFcfa(c.commissionVersee),
            formatFcfa(c.solde),
            formatPct(c.tauxEffectif),
          ]),
          "Aucun commercial n'a amené d'étudiant dans ce périmètre."
        ),
        { kind: "heading", text: "Dette de commissions", level: 1 },
        {
          kind: "keyValues",
          columns: 2,
          items: [
            ["Montant dû", formatFcfa(d.dette.total)],
            ["Lignes à régler", String(d.dette.lignes)],
            ["Commerciaux concernés", String(d.dette.commerciaux)],
            [
              "Plus ancien encaissement dû",
              d.dette.plusAncienne
                ? `${jourFr(d.dette.plusAncienne)} (${d.dette.ageJours} jour(s))`
                : "—",
            ],
          ],
        },
        { kind: "heading", text: "Arrivées par mois", level: 1 },
        tableOrNote(
          [
            { header: "Mois" },
            { header: "Total", width: 22, align: "right" },
            { header: "Commercial", width: 28, align: "right" },
            { header: "Médias", width: 24, align: "right" },
            { header: "Bouche-à-oreille", width: 34, align: "right" },
            { header: "Autre / inconnu", width: 32, align: "right" },
          ],
          d.parMois.map((m) => [
            m.mois,
            String(m.total),
            String(m.commercial),
            String(m.medias),
            String(m.boucheAOreille),
            String(m.autre),
          ]),
          "Aucune ouverture de classe ne date les étudiants du périmètre."
        ),
        ...(d.etudiantsSansDate > 0
          ? [
              {
                kind: "note" as const,
                text:
                  `${d.etudiantsSansDate} étudiant(s) n'apparaissent pas dans les ` +
                  `arrivées mensuelles : aucune ouverture de classe ne les date. Ils ` +
                  `restent comptés dans les effectifs et les encaissements.`,
              },
            ]
          : []),
      ],
    };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement de la prospection…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="max-w-lg border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Erreur</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-700">
          {error instanceof Error ? error.message : "Impossible de charger les données."}
        </CardContent>
      </Card>
    );
  }

  const cov = data.couverture;
  const detteTone = data.dette.total > 0 ? VIZ_STATUS.warning : undefined;
  const rendementCommercial = data.parCanal.find((c) => c.canal === "commercial") ?? null;

  return (
    <div className="space-y-8">
      <OwnerPageHeader
        title="Prospection & commissions"
        pdf={construireRapport}
        csv={{
          endpoint: "/api/v1/owner/prospection/export",
          queryString,
          filename: "prospection.csv",
        }}
      />

      {!cov.representative && cov.etudiants > 0 ? (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex gap-3 p-4 text-sm">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
              aria-hidden
            />
            <div className="space-y-1">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                La provenance n&apos;est connue que pour {cov.renseignes} étudiant(s) sur{" "}
                {cov.etudiants}.
              </p>
              <p className="text-amber-800 dark:text-amber-300">
                Tout ce qui suit décrit cette part-là, pas l&apos;établissement. Les{" "}
                {cov.nonRenseignes} fiches sans provenance pèsent{" "}
                {formatFcfa(cov.scolariteNonRattachee)} de scolarité encaissée qu&apos;aucun
                canal ne revendique.
              </p>
              <p className="text-amber-800 dark:text-amber-300">
                La provenance se renseigne <strong>à la création de la fiche</strong>,
                dans le bloc « Provenance » de{" "}
                <span className="font-medium">Scolarité › Nouvel étudiant</span> — et elle
                y est facultative. Une fiche créée sans ce bloc reste sans provenance tant
                que personne ne la rattrape, sur la fiche de l&apos;étudiant ou sur{" "}
                <span className="font-medium">Prospection › Provenances</span>.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Provenance connue"
          value={formatPct(data.kpis.couverture)}
          hint={`${cov.renseignes} sur ${cov.etudiants} étudiants`}
          icon={Users}
        />
        <StatCard
          label="Amenés par un commercial"
          value={String(data.kpis.viaCommercial)}
          hint={
            cov.renseignes > 0
              ? `${formatPct(
                  Math.round((data.kpis.viaCommercial * 1000) / cov.renseignes) / 10
                )} des provenances connues`
              : "Aucune provenance renseignée"
          }
          icon={UserCheck}
        />
        <StatCard
          label="Scolarité encaissée"
          value={formatFcfa(data.kpis.scolariteEncaissee)}
          hint="Ligne « Scolarité » du barème, paiements confirmés"
          icon={Wallet}
        />
        <StatCard
          label="Reste dû aux commerciaux"
          value={formatFcfa(data.kpis.commissionDue)}
          hint={
            data.dette.lignes > 0
              ? `${data.dette.lignes} ligne(s), ${data.dette.commerciaux} commercial(aux)`
              : "Tout est réglé"
          }
          icon={BadgePercent}
          deltaPolarity="lower-is-better"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DonutChartCard
          title="D'où viennent les étudiants"
          slices={data.parCanal.map((c) => ({
            key: c.canal,
            label: canalLabel(c.canal),
            value: c.etudiants,
            color: CANAL_COLORS[c.canal],
          }))}
          centerLabel="étudiants"
          centerValue={String(cov.etudiants)}
        />

        <BarChartCard
          title="Ce que rapporte chaque canal"
          data={data.parCanal.map((c) => ({
            canal: canalLabel(c.canal),
            net: Math.round(c.net),
          }))}
          categoryKey="canal"
          orientation="horizontal"
          height={Math.max(220, data.parCanal.length * 30 + 60)}
          series={[{ key: "net", label: "Net encaissé", color: VIZ_SEQUENTIAL[2] }]}
          valueFormatter={formatFcfa}
          axisFormatter={formatFcfaCompact}
        />

        <LineChartCard
          className="lg:col-span-2"
          title="Arrivées par mois"
          data={data.parMois.map((m) => ({
            mois: m.mois,
            commercial: m.commercial,
            medias: m.medias,
            bouche: m.boucheAOreille,
            autre: m.autre,
          }))}
          categoryKey="mois"
          height={260}
          series={[
            { key: "commercial", label: "Commercial", color: VIZ_SERIES[0] },
            { key: "medias", label: "Médias", color: VIZ_SERIES[1] },
            { key: "bouche", label: "Bouche-à-oreille", color: VIZ_SERIES[2] },
            { key: "autre", label: "Autre / inconnu", color: VIZ_STATUS.warning },
          ]}
          footnote={
            data.etudiantsSansDate > 0
              ? `${data.etudiantsSansDate} étudiant(s) manquent à cette courbe : aucune ouverture de classe ne les date. Ils restent comptés partout ailleurs.`
              : undefined
          }
        />
      </div>

      {/*
        Le rendement ne se détaille que pour « Commercial IPAM ». Les autres
        canaux n'engagent aucune dépense : leur commission est nulle par
        construction et leur « net » retombe donc sur l'encaissé, colonne pour
        colonne. Leurs effectifs et leurs parts restent lisibles sur le
        camembert ci-dessus.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rendement du canal commercial</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Canal</TableHead>
                <TableHead className="text-right">Étudiants</TableHead>
                <TableHead className="text-right">Part</TableHead>
                <TableHead className="text-right">Scolarité encaissée</TableHead>
                <TableHead className="text-right">Par étudiant</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Net pour l&apos;école</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rendementCommercial === null ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    Aucun étudiant amené par un commercial dans ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: CANAL_COLORS.commercial }}
                        aria-hidden
                      />
                      {canalLabel("commercial")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rendementCommercial.etudiants}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPct(rendementCommercial.part)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatFcfa(rendementCommercial.scolariteEncaissee)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fcfa0(rendementCommercial.scolariteParEtudiant)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rendementCommercial.commissionAcquise > 0
                      ? formatFcfa(rendementCommercial.commissionAcquise)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatFcfa(rendementCommercial.net)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 opacity-70" aria-hidden />
            Commerciaux
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Commission acquise
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {formatFcfa(data.kpis.commissionAcquise)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Taux effectif consenti : {formatPct(data.kpis.tauxEffectif)}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Déjà versée
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {formatFcfa(data.kpis.commissionVersee)}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Reste dû
              </div>
              <div
                className="mt-1 text-xl font-semibold tabular-nums"
                style={detteTone ? { color: detteTone } : undefined}
              >
                {formatFcfa(data.dette.total)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {data.dette.plusAncienne
                  ? `Plus ancien encaissement dû : ${jourFr(data.dette.plusAncienne)} (${data.dette.ageJours} j)`
                  : "Aucune ligne en attente"}
              </div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Commercial</TableHead>
                <TableHead className="text-right">Étudiants</TableHead>
                <TableHead className="text-right">Scolarité encaissée</TableHead>
                <TableHead className="text-right">Commission acquise</TableHead>
                <TableHead className="text-right">Versée</TableHead>
                <TableHead className="text-right">Reste dû</TableHead>
                <TableHead className="text-right">Taux effectif</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.commerciaux.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    Aucun commercial n&apos;a amené d&apos;étudiant dans ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                data.commerciaux.map((c) => (
                  <TableRow key={c.commercialId}>
                    <TableCell className="font-medium">
                      {c.nom}
                      {c.actif ? null : (
                        <span className="ml-2 text-xs text-muted-foreground">inactif</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.etudiants}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(c.scolariteEncaissee)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(c.commissionAcquise)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(c.commissionVersee)}
                    </TableCell>
                    <TableCell
                      className="text-right font-medium tabular-nums"
                      style={c.solde > 0 ? { color: VIZ_STATUS.warning } : undefined}
                    >
                      {formatFcfa(c.solde)}
                      {c.lignesDues > 0 ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({c.lignesDues})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(c.tauxEffectif)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Entre parenthèses, le nombre d&apos;encaissements dont la commission n&apos;a
            pas encore été réglée. Le règlement se fait sur la page Prospection de
            l&apos;administration : cet écran ne touche à rien.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
