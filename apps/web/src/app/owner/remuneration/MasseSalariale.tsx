"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Loader2, Banknote, FileSignature, Users, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { SearchableSelect } from "@/components/SearchableSelect";
import { StatCard } from "@/components/owner/charts/StatCard";
import { BarChartCard } from "@/components/owner/charts/BarChartCard";
import {
  VIZ_SEQUENTIAL,
  formatFcfa,
  formatFcfaCompact,
} from "@/components/owner/charts/palette";
import {
  buildQueryString,
  useOwnerPayroll,
  type OwnerPayrollFilters,
} from "@/lib/hooks/use-owner-payroll";
import { createApiHeaders } from "@/lib/api-utils";
import { tableOrNote, type OwnerReportContent } from "@/lib/utils/owner-report";
import type { ReportBlock } from "@/lib/utils/report-doc";
import type {
  OwnerPayrollArchive,
  OwnerPayrollPeriodOption,
  OwnerPayrollStatus,
} from "@ecoledigitale/contracts";

/**
 * Masse salariale enseignante.
 *
 * L'écran répond à « combien je paie, à qui, et qu'est-ce qui attend ma
 * signature ? ». Trois choix dictés par ce que la base contient réellement :
 *
 *  - L'ÉVOLUTION EST PAR PÉRIODE DE PAIE, pas par mois. Les bulletins sont
 *    rattachés à des exercices annuels et `calculated_at` porte la date de
 *    composition du bulletin, pas celle du travail rémunéré : sur cette base,
 *    les six exercices ont tous été calculés le même mois.
 *  - AUCUN TAUX HORAIRE N'EST AFFICHÉ. La table des heures d'enseignement est
 *    vide ; un « coût horaire » calculé dessus vaudrait zéro et serait faux.
 *  - LE FILTRE D'ARCHIVAGE VAUT « TOUTES » PAR DÉFAUT. Archiver classe un
 *    exercice clos, ce n'est pas une annulation — et sur un établissement dont
 *    tous les exercices sont archivés, masquer les archives ouvrirait un écran
 *    vide.
 *
 * LES FILTRES SONT CEUX DE LA PAGE ADMINISTRATEUR DES BULLETINS ARCHIVÉS —
 * enseignant, année scolaire, période — parce que les deux écrans lisent les
 * mêmes bulletins et qu'un même bulletin doit s'y attraper de la même façon.
 * Trois règles reprises telles quelles de cet écran :
 *
 *  - CHAQUE OPTION ANNONCE SON EFFECTIF, et une option sans effectif n'est pas
 *    proposée. Un menu qui offre six statuts là où la base n'en porte que deux
 *    propose quatre chemins vers un écran vide.
 *  - LA PÉRIODE EST LIBELLÉE PAR SON INTERVALLE, pas par son nom : le nom est
 *    saisi à la main et ne dit pas toujours ce qu'il couvre.
 *  - CHANGER D'ANNÉE REMET LA PÉRIODE À « TOUTES » : garder une période de
 *    l'année qu'on quitte filtrerait sur un couple impossible.
 */

const ALL = "__all__";

const STATUS_LABELS: Record<OwnerPayrollStatus, string> = {
  calculated: "Calculée",
  approved: "Approuvée",
  paid: "Versée",
  disputed: "Contestée",
  cancelled: "Annulée",
  unpaid: "Impayée",
};

const ARCHIVE_LABELS: Record<OwnerPayrollArchive, string> = {
  toutes: "Toutes",
  actives: "Hors archives",
  archivees: "Archivées seulement",
};

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const fmtDate = (d: string | null): string => {
  if (!d) return "—";
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
};

/**
 * Libellé d'une période, déduit de son INTERVALLE et non de son nom — le
 * libellé exact de la page administrateur des bulletins archivés.
 *
 * Le nom est saisi à la main : « Exercice 2026-2027 » couvre en réalité
 * août → décembre 2026. Afficher le nom seul laissait le propriétaire choisir à
 * l'aveugle entre deux exercices qui se recouvrent.
 *
 *   « Septembre 2025 → août 2026 — année 2025-2026 »
 *   « Décembre 2025 — année 2025-2026 »  (période d'un seul mois)
 */
const libellePeriode = (p: OwnerPayrollPeriodOption): string => {
  const [anD, moisD] = p.periodStart.split("-").map(Number);
  const [anF, moisF] = p.periodEnd.split("-").map(Number);
  const suffixe = p.anneeScolaire ? ` — année ${p.anneeScolaire}` : "";
  if (!anD || !moisD) return p.name + suffixe;
  const premier = majuscule(`${MOIS[moisD - 1]} ${anD}`);
  if (!anF || !moisF || (anD === anF && moisD === moisF)) return premier + suffixe;
  return `${premier} → ${MOIS[moisF - 1]} ${anF}${suffixe}`;
};

export function MasseSalariale() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  const [annee, setAnnee] = useState<string>(ALL);
  const [periodId, setPeriodId] = useState<string>(ALL);
  const [enseignantId, setEnseignantId] = useState<string>("");
  const [status, setStatus] = useState<string>(ALL);
  const [archive, setArchive] = useState<OwnerPayrollArchive>("toutes");

  const filters = useMemo<OwnerPayrollFilters>(
    () => ({
      anneeScolaire: annee === ALL ? undefined : annee,
      periodId: periodId === ALL ? undefined : periodId,
      teacherId: enseignantId || undefined,
      status: status === ALL ? undefined : (status as OwnerPayrollStatus),
      archive,
    }),
    [annee, periodId, enseignantId, status, archive]
  );

  const { data, isLoading, error } = useOwnerPayroll(filters);

  /**
   * Périodes proposées : celles de l'année choisie.
   *
   * Même règle que la page administrateur des bulletins archivés — proposer une
   * période de 2024-2025 alors qu'on filtre 2025-2026 ne donnerait qu'un écran
   * vide. Changer d'année remet la période à « toutes » (cf. le sélecteur), ce
   * qui évite d'interroger l'API sur un couple année/période impossible.
   */
  const periodesOffertes = useMemo(
    () => (data?.periods ?? []).filter((p) => annee === ALL || p.anneeScolaire === annee),
    [data, annee]
  );

  /**
   * Enseignants proposés, avec leur nombre de bulletins — la liste et le format
   * de la page administrateur des bulletins archivés. `SearchableSelect` et non
   * un menu simple : à trente enseignants, dérouler n'est plus chercher.
   */
  const enseignantsOfferts = useMemo(
    () => [
      { value: "", label: "Tous les enseignants" },
      ...(data?.teachers ?? []).map((t) => ({
        value: t.id,
        label: `${t.name} (${t.bulletins})`,
      })),
    ],
    [data]
  );

  /**
   * Statuts proposés : ceux que la base porte vraiment, avec leur effectif.
   *
   * `payment_status` en compte six ; les lister tous offrait quatre chemins
   * vers un écran vide. Le statut déjà sélectionné est conservé même s'il
   * disparaît du décompte, faute de quoi on ne pourrait plus en sortir.
   */
  const statutsOfferts = useMemo(() => {
    const dispo = data?.statuts ?? [];
    const liste = dispo.map((s) => ({
      value: s.status as string,
      label: `${STATUS_LABELS[s.status]} (${s.bulletins})`,
    }));
    if (status !== ALL && !liste.some((o) => o.value === status)) {
      liste.push({ value: status, label: `${STATUS_LABELS[status as OwnerPayrollStatus]} (0)` });
    }
    return liste;
  }, [data, status]);

  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; message: string } | null>(null);

  /**
   * Lignes de bulletins montrées d'emblée.
   *
   * Le tableau vient après cinq autres blocs : y déverser une centaine de
   * lignes enterre tout ce qui suit. On en montre une page, dépliable — la
   * pagination de la page administrateur des bulletins archivés, ramenée à ce
   * dont un écran de synthèse a besoin. L'export PDF et le CSV, eux, portent
   * toujours l'intégralité du périmètre : le repli est un confort de lecture,
   * pas un critère de sélection.
   */
  const [toutAfficher, setToutAfficher] = useState(false);
  const BULLETINS_VISIBLES = 25;

  /** Validation propriétaire : `calculated` → `approved`. Action explicite. */
  const valider = useMutation({
    mutationFn: async (paymentId: string) => {
      const res = await fetch(`/api/v1/owner/payroll/${paymentId}/validate`, {
        method: "PATCH",
        headers: { ...createApiHeaders(session), "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message || `Erreur ${res.status}`);
      return body;
    },
    onSuccess: async () => {
      setFeedback({ type: "ok", message: "Paie approuvée." });
      await queryClient.invalidateQueries({ queryKey: ["owner-payroll", tenantId] });
    },
    onError: (e: Error) => setFeedback({ type: "err", message: e.message }),
  });

  const evolution = useMemo(
    () =>
      (data?.byPeriod ?? []).map((p) => ({
        periode: p.name,
        montant: p.montant,
      })),
    [data]
  );

  /**
   * « État de la masse salariale » : les paies à signer d'abord — c'est la
   * seule partie sur laquelle le propriétaire engage sa signature et de
   * l'argent —, puis le coût par enseignant, puis l'évolution.
   */
  const construireRapport = (): OwnerReportContent => {
    const d = data!;
    const blocks: ReportBlock[] = [
      {
        kind: "keyValues",
        columns: 2,
        items: [
          ["Année scolaire", d.anneeScolaire ?? "Toutes"],
          ["Période de paie", d.periodName ?? "Toutes"],
          ["Enseignant", d.teacherName ?? "Tous"],
          ["Statut", d.status ? STATUS_LABELS[d.status] : "Tous"],
          ["Archivage", ARCHIVE_LABELS[d.archive]],
          ["Masse salariale", formatFcfa(d.kpis.masseSalariale)],
          ["Bulletins", String(d.kpis.bulletins)],
          ["Enseignants payés", String(d.kpis.enseignantsPayes)],
          [
            "Coût moyen par enseignant",
            d.kpis.coutMoyenParEnseignant === null
              ? "Non mesuré"
              : formatFcfa(d.kpis.coutMoyenParEnseignant),
          ],
          [
            "En attente de validation",
            `${d.kpis.enAttenteValidation} pour ${formatFcfa(d.kpis.montantEnAttente)}`,
          ],
          [
            "Approuvé, non versé",
            `${d.kpis.approuveNonVerse} pour ${formatFcfa(d.kpis.montantApprouveNonVerse)}`,
          ],
        ],
      },
    ];

    // Une exclusion tue est une exclusion qu'on ne sait plus expliquer.
    if (d.kpis.montantHorsTotal > 0) {
      blocks.push({
        kind: "note",
        text: `${formatFcfa(
          d.kpis.montantHorsTotal
        )} de bulletins annulés ou contestés sont EXCLUS de la masse salariale ci-dessus.`,
      });
    }

    blocks.push(
      { kind: "heading", text: "Décomposition", level: 1 },
      {
        kind: "table",
        table: {
          columns: [{ header: "Poste" }, { header: "Montant", width: 50, align: "right" }],
          rows: [
            ["Base", formatFcfa(d.breakdown.base)],
            ["Heures supplémentaires", formatFcfa(d.breakdown.heuresSup)],
            ["Primes", formatFcfa(d.breakdown.primes)],
            ["Retenues", formatFcfa(d.breakdown.retenues)],
          ],
          footer: ["Total", formatFcfa(d.breakdown.total)],
        },
      },
      { kind: "heading", text: "Paies en attente de votre validation", level: 1 },
      tableOrNote(
        [
          { header: "Enseignant" },
          { header: "Période", width: 55 },
          { header: "Calculée le", width: 32, align: "right" },
          { header: "Montant", width: 42, align: "right" },
        ],
        d.pending.map((p) => [
          p.teacherName,
          p.periodName ?? "—",
          p.calculatedAt ? new Date(p.calculatedAt).toLocaleDateString("fr-FR") : "—",
          formatFcfa(p.amount),
        ]),
        "Aucune paie en attente de validation.",
        ["Total à engager", "", "", formatFcfa(d.kpis.montantEnAttente)]
      ),
      { kind: "heading", text: "Coût par enseignant", level: 1 },
      tableOrNote(
        [
          { header: "Enseignant" },
          { header: "Courriel", width: 62 },
          { header: "Bulletins", width: 26, align: "right" },
          { header: "Base", width: 36, align: "right" },
          { header: "Heures sup.", width: 32, align: "right" },
          { header: "Primes", width: 30, align: "right" },
          { header: "Retenues", width: 32, align: "right" },
          { header: "Total", width: 40, align: "right" },
        ],
        d.byTeacher.map((t) => [
          t.teacherName,
          t.email ?? "—",
          String(t.bulletins),
          formatFcfa(t.base),
          formatFcfa(t.heuresSup),
          formatFcfa(t.primes),
          formatFcfa(t.retenues),
          formatFcfa(t.total),
        ]),
        "Aucune paie sur ce périmètre.",
        ["Total", "", String(d.kpis.bulletins), "", "", "", "", formatFcfa(d.kpis.masseSalariale)]
      ),
      { kind: "pageBreak" },
      {
        kind: "heading",
        text: `Bulletins — ${d.bulletinsTotal}`,
        level: 1,
      },
      // La liste est plafonnée côté serveur ; le compteur porte sur tout ce que
      // le filtre retient. Un écrêtage se dit, il ne se devine pas.
      ...(d.bulletins.length < d.bulletinsTotal
        ? [
            {
              kind: "note" as const,
              text: `Extrait : ${d.bulletins.length} lignes affichées sur ${d.bulletinsTotal}.`,
            },
          ]
        : []),
      tableOrNote(
        [
          { header: "Enseignant" },
          { header: "Période", width: 55 },
          { header: "Statut", width: 30 },
          { header: "Archivé le", width: 30, align: "right" },
          { header: "Versé le", width: 30, align: "right" },
          { header: "Montant", width: 42, align: "right" },
        ],
        d.bulletins.map((b) => [
          b.teacherName,
          b.periodName ?? "—",
          STATUS_LABELS[b.status as OwnerPayrollStatus] ?? b.status,
          fmtDate(b.archivedAt),
          fmtDate(b.paidAt),
          formatFcfa(b.amount),
        ]),
        "Aucun bulletin sur ce périmètre."
      ),
      { kind: "pageBreak" },
      { kind: "heading", text: "Évolution par période de paie", level: 1 },
      tableOrNote(
        [
          { header: "Période" },
          { header: "Début", width: 32 },
          { header: "Bulletins", width: 28, align: "right" },
          { header: "Enseignants payés", width: 40, align: "right" },
          { header: "Montant", width: 44, align: "right" },
        ],
        d.byPeriod.map((p) => [
          p.name,
          p.periodStart,
          String(p.bulletins),
          String(p.enseignantsPayes),
          formatFcfa(p.montant),
        ]),
        "Aucune période de paie renseignée."
      ),
      {
        kind: "heading",
        text: `Cours sans titulaire actif — ${d.coursesWithoutTeacherTotal}`,
        level: 1,
      },
      // La liste est plafonnée côté serveur ; le compteur, lui, porte sur tout
      // ce qui est affichable.
      ...(d.coursesWithoutTeacher.length < d.coursesWithoutTeacherTotal
        ? [
            {
              kind: "note" as const,
              text: `Extrait : ${d.coursesWithoutTeacher.length} lignes affichées sur ${d.coursesWithoutTeacherTotal}.`,
            },
          ]
        : []),
      ...(d.coursesWithoutTeacherOrphaned > 0
        ? [
            {
              kind: "note" as const,
              text: `${d.coursesWithoutTeacherOrphaned} rattachement(s) classe–matière sans titulaire ne figurent pas dans ce tableau : la classe ou la matière référencée n'existe plus en base. Ce sont des données à réparer, pas des cours à pourvoir.`,
            },
          ]
        : []),
      tableOrNote(
        [{ header: "Classe", width: 80 }, { header: "Cours" }],
        d.coursesWithoutTeacher.map((c) => [c.className, c.courseName]),
        "Tous les cours ont un titulaire actif."
      )
    );

    return { filename: "masse-salariale", blocks };
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement de la masse salariale…
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
          {error instanceof Error ? error.message : "Chargement impossible."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <OwnerPageHeader
        title="Masse salariale"
        question="Combien je paie, à qui, et qu'est-ce qui attend ma signature ?"
        precision="Rémunérations enseignantes, scolaire et professionnel confondus. Les bulletins annulés ou contestés sont exclus du total."
        pdf={construireRapport}
        csv={{
          endpoint: "/api/v1/owner/payroll",
          queryString: `${buildQueryString(filters)}&format=csv`,
          filename: "masse-salariale.csv",
        }}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label>Enseignant</Label>
            <SearchableSelect
              value={enseignantId}
              onChange={setEnseignantId}
              placeholder="Tous les enseignants"
              searchPlaceholder="Rechercher un enseignant…"
              options={enseignantsOfferts}
            />
            <p className="text-xs text-muted-foreground">
              Seuls les enseignants ayant au moins un bulletin sont proposés ; le nombre
              entre parenthèses est le leur.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Année scolaire</Label>
            <Select
              value={annee}
              // Changer d'année remet la période à « toutes » : garder une
              // période de l'année précédente interrogerait l'API sur un couple
              // impossible et renverrait un écran vide sans dire pourquoi.
              onValueChange={(v) => {
                setAnnee(v);
                setPeriodId(ALL);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes les années</SelectItem>
                {data.anneesScolaires.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Année rattachée à la période de paie ; à défaut de rattachement en base, elle
              est déduite du milieu de l&apos;intervalle, l&apos;année démarrant en
              septembre — la même règle que la page administrateur des bulletins archivés.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Période de paie</Label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes les périodes</SelectItem>
                {periodesOffertes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {libellePeriode(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Le mois et l&apos;année sont déduits de l&apos;intervalle de dates : le nom de
              la période est saisi à la main et ne dit pas toujours ce qu&apos;il couvre.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Statut de paie</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les statuts</SelectItem>
                {statutsOfferts.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Seuls les statuts portés par au moins un bulletin du périmètre sont proposés.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Archivage</Label>
            <Select
              value={archive}
              onValueChange={(v) => setArchive(v as OwnerPayrollArchive)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* L'effectif est porté par l'option : sur un établissement dont
                    tous les exercices sont clos, « Hors archives (0) » se lit
                    avant d'être choisi, au lieu d'ouvrir un écran vide. */}
                <SelectItem value="toutes">
                  {ARCHIVE_LABELS.toutes} ({data.archiveCounts.actives + data.archiveCounts.archivees})
                </SelectItem>
                <SelectItem value="actives">
                  {ARCHIVE_LABELS.actives} ({data.archiveCounts.actives})
                </SelectItem>
                <SelectItem value="archivees">
                  {ARCHIVE_LABELS.archivees} ({data.archiveCounts.archivees})
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Archiver classe un exercice clos ; ce n&apos;est pas une annulation, le
              montant reste dans la masse salariale.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Masse salariale"
          value={formatFcfa(data.kpis.masseSalariale)}
          icon={Banknote}
          hint={`${data.kpis.bulletins} bulletin(s)`}
        />
        <StatCard
          label="Enseignants payés"
          value={String(data.kpis.enseignantsPayes)}
          icon={Users}
          hint={
            data.kpis.coutMoyenParEnseignant === null
              ? "Coût moyen non mesuré"
              : `${formatFcfa(data.kpis.coutMoyenParEnseignant)} en moyenne`
          }
        />
        <StatCard
          label="En attente de validation"
          value={String(data.kpis.enAttenteValidation)}
          icon={FileSignature}
          hint={formatFcfa(data.kpis.montantEnAttente)}
        />
        <StatCard
          label="Approuvé, non versé"
          value={String(data.kpis.approuveNonVerse)}
          icon={Wallet}
          hint={formatFcfa(data.kpis.montantApprouveNonVerse)}
        />
      </div>

      {/* Ce qui est retiré du total doit se voir, sinon l'écart est inexplicable. */}
      {data.kpis.montantHorsTotal > 0 && (
        <Card className="border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm">
            {formatFcfa(data.kpis.montantHorsTotal)} de bulletins annulés ou contestés sont
            exclus de la masse salariale affichée.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Décomposition</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Poste</TableHead>
                <TableHead className="text-right">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Base", data.breakdown.base],
                ["Heures supplémentaires", data.breakdown.heuresSup],
                ["Primes", data.breakdown.primes],
                ["Retenues", data.breakdown.retenues],
              ].map(([label, montant]) => (
                <TableRow key={String(label)}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatFcfa(Number(montant))}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatFcfa(data.breakdown.total)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Paies en attente de votre validation</CardTitle>
          <p className="text-sm text-muted-foreground">
            Bulletins calculés, pas encore approuvés. Valider fait passer la paie au statut
            « approuvée » ; le versement reste une étape distincte.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {feedback && (
            <p
              role="status"
              className={`text-sm ${
                feedback.type === "ok" ? "text-emerald-700" : "text-red-600"
              }`}
            >
              {feedback.message}
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enseignant</TableHead>
                <TableHead>Période</TableHead>
                <TableHead className="text-right">Calculée le</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pending.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    Aucune paie en attente de validation.
                  </TableCell>
                </TableRow>
              ) : (
                data.pending.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.teacherName}</TableCell>
                    <TableCell>{p.periodName ?? "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {p.calculatedAt
                        ? new Date(p.calculatedAt).toLocaleDateString("fr-FR")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(p.amount)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={valider.isPending}
                        onClick={() => valider.mutate(p.id)}
                      >
                        {/* Seule la ligne en cours passe en attente, pas la liste. */}
                        {valider.isPending && valider.variables === p.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Valider"
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BarChartCard
        title="Évolution par période de paie"
        subtitle="Les bulletins sont rattachés à des exercices, pas à des mois : la date de calcul ne dit pas quand le travail a été fait."
        data={evolution}
        categoryKey="periode"
        series={[{ key: "montant", label: "Masse salariale", color: VIZ_SEQUENTIAL[2] }]}
        valueFormatter={formatFcfa}
        axisFormatter={formatFcfaCompact}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Coût par enseignant</CardTitle>
          <p className="text-sm text-muted-foreground">
            Somme réelle des bulletins sur le périmètre choisi. Aucun taux horaire
            n&apos;est affiché : la table des heures d&apos;enseignement est vide, un coût
            horaire calculé dessus vaudrait zéro.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enseignant</TableHead>
                <TableHead className="text-right">Bulletins</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Heures sup.</TableHead>
                <TableHead className="text-right">Primes</TableHead>
                <TableHead className="text-right">Retenues</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byTeacher.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    Aucune paie sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                data.byTeacher.map((t) => (
                  <TableRow key={t.teacherId}>
                    <TableCell className="font-medium">{t.teacherName}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.bulletins}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(t.base)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(t.heuresSup)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(t.primes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(t.retenues)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatFcfa(t.total)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Bulletins — {data.bulletinsTotal}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Les lignes qui composent les totaux ci-dessus, telles que les montre la page
            administrateur des bulletins archivés. Deux dates, deux actes :
            «&nbsp;archivé&nbsp;» dit quand le montant a été arrêté, «&nbsp;versé&nbsp;»
            quand l&apos;argent est parti.
            {data.bulletins.length < data.bulletinsTotal
              ? ` Extrait : ${data.bulletins.length} lignes affichées.`
              : ""}
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enseignant</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Archivé le</TableHead>
                <TableHead className="text-right">Versé le</TableHead>
                <TableHead className="text-right">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.bulletins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    Aucun bulletin sur ce périmètre.
                  </TableCell>
                </TableRow>
              ) : (
                (toutAfficher
                  ? data.bulletins
                  : data.bulletins.slice(0, BULLETINS_VISIBLES)
                ).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.teacherName}</TableCell>
                    <TableCell>
                      {b.periodName ?? "—"}
                      {b.anneeScolaire ? (
                        <span className="block text-xs text-muted-foreground">
                          {b.anneeScolaire}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {STATUS_LABELS[b.status as OwnerPayrollStatus] ?? b.status}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {fmtDate(b.archivedAt)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {fmtDate(b.paidAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(b.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {data.bulletins.length > BULLETINS_VISIBLES && (
            <div className="pt-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setToutAfficher((v) => !v)}
              >
                {toutAfficher
                  ? `Réduire à ${BULLETINS_VISIBLES} lignes`
                  : `Afficher les ${data.bulletins.length} lignes`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Cours sans titulaire actif — {data.coursesWithoutTeacherTotal}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Chacun est une heure qui sera assurée sans être rattachée à personne, donc sans
            être payée à personne.
            {data.coursesWithoutTeacher.length < data.coursesWithoutTeacherTotal
              ? ` Extrait : ${data.coursesWithoutTeacher.length} lignes affichées.`
              : ""}
          </p>
          {/* Nommer le défaut de données plutôt que gonfler le compteur avec. */}
          {data.coursesWithoutTeacherOrphaned > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-500">
              {data.coursesWithoutTeacherOrphaned} rattachement(s) classe–matière sans
              titulaire ne sont pas listables : la classe ou la matière référencée n&apos;existe
              plus en base. Ce sont des données à réparer, pas des cours à pourvoir.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classe</TableHead>
                <TableHead>Cours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.coursesWithoutTeacher.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-sm text-muted-foreground">
                    {data.coursesWithoutTeacherOrphaned > 0
                      ? "Aucun cours listable sans titulaire. Les rattachements orphelins ci-dessus ne peuvent pas figurer dans ce tableau."
                      : "Tous les cours ont un titulaire actif."}
                  </TableCell>
                </TableRow>
              ) : (
                data.coursesWithoutTeacher.map((c) => (
                  <TableRow key={c.classCourseId}>
                    <TableCell className="font-medium">{c.className}</TableCell>
                    <TableCell>{c.courseName}</TableCell>
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
