"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  AlertCircle,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  UserRound,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openCommissionsHistoriquePdf } from "@/lib/utils/commissions-historique-report";
import {
  useCommerciaux,
  useLignesCommission,
  useReglerCommissions,
} from "@/lib/hooks/use-prospection";
import { formatAmountFCFA } from "@/lib/utils";

/**
 * Commissions À PAYER — ce qui reste dû à chaque commercial, ligne à ligne.
 *
 * L'écran ne montre que les impayées : une commission réglée quitte cette liste
 * pour l'historique (`./payees`). C'est ce qui en fait un plan de travail — ce
 * qui reste à l'écran est ce qui reste à faire.
 *
 * Il ne montre QUE la commission. Le paiement de scolarité qui la déclenche
 * reste hors champ : son montant, son mode et son reçu regardent la caisse, pas
 * la rémunération du commercial. Seul l'étudiant est nommé, pour savoir au titre
 * de qui la commission est due.
 *
 * Le montant réglé n'est jamais saisi : le serveur le recalcule à partir du
 * paiement et du taux figé sur la fiche de l'étudiant.
 */

const PAGE_SIZES = [10, 20, 50];
const TOUS = "__tous__";

const fmtDate = (d: string | null): string => {
  if (!d) return "—";
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
};

const fcfa = (n: number) => formatAmountFCFA(Math.round(n));

export default function CommissionsAPayerPage() {
  const [commercialId, setCommercialId] = useState(TOUS);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<string[]>([]);
  const [retour, setRetour] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  const commerciauxQuery = useCommerciaux();
  const lignesQuery = useLignesCommission({
    commercial_id: commercialId === TOUS ? undefined : commercialId,
    // Jamais modifiable : cet écran EST la liste des impayées.
    statut: "impaye",
  });
  const regler = useReglerCommissions();

  const lignes = useMemo(() => lignesQuery.data ?? [], [lignesQuery.data]);
  const reste = useMemo(() => lignes.reduce((s, l) => s + l.commission, 0), [lignes]);

  const commercialOptions = [
    { value: TOUS, label: "Tous les commerciaux" },
    ...(commerciauxQuery.data ?? []).map((c) => ({ value: c.id, label: c.nom })),
  ];

  const nomCommercial =
    commercialId === TOUS
      ? "Tous les commerciaux"
      : ((commerciauxQuery.data ?? []).find((c) => c.id === commercialId)?.nom ?? "—");

  // Pagination côté client : la liste est déjà chargée en entier.
  const totalPages = Math.max(1, Math.ceil(lignes.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * pageSize;
  const pageItems = lignes.slice(firstIndex, firstIndex + pageSize);

  const toutesCochees =
    pageItems.length > 0 && pageItems.every((l) => selection.includes(l.payment_id));

  const montantSelection = lignes
    .filter((l) => selection.includes(l.payment_id))
    .reduce((s, l) => s + l.commission, 0);

  function bascule(paymentId: string) {
    setSelection((prev) =>
      prev.includes(paymentId) ? prev.filter((id) => id !== paymentId) : [...prev, paymentId]
    );
  }

  function basculeTout() {
    const ids = pageItems.map((l) => l.payment_id);
    setSelection((prev) =>
      toutesCochees ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]
    );
  }

  function changeFiltre<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
      setSelection([]);
    };
  }

  async function validerPaiement(ids: string[]) {
    if (ids.length === 0) return;
    setRetour(null);
    try {
      const r = await regler.mutateAsync({ payment_ids: ids, mode: "especes" });
      setSelection([]);
      setRetour({
        kind: "ok",
        text:
          `${r.reglees} ligne(s) marquée(s) payée(s) — ${fcfa(r.montant)}.` +
          (r.ignorees > 0 ? ` ${r.ignorees} déjà réglée(s), ignorée(s).` : ""),
      });
    } catch (error) {
      setRetour({ kind: "warn", text: (error as Error).message });
    }
  }

  const chargement = lignesQuery.isLoading;
  const erreur = lignesQuery.error as Error | null;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <History className="h-7 w-7 text-indigo-500" />
            Commissions à payer
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Une ligne par commission restant à payer. Cochez celles que vous réglez, puis validez.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButtons
            formats={["pdf"]}
            disabled={chargement || lignes.length === 0}
            onError={(text) => setRetour({ kind: "warn", text })}
            onExportPdf={(win) =>
              openCommissionsHistoriquePdf(
                lignes,
                { commercial: nomCommercial, statut: "Commissions à payer" },
                win
              )
            }
          />
          <Link href="/professionnel/admin/prospection/commissions/historique/payees">
            <Button variant="outline">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Button>
          </Link>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <label className="flex flex-col gap-1 text-sm max-w-md">
            <span className="text-muted-foreground">Commercial</span>
            <SearchableSelect
              value={commercialId}
              onChange={changeFiltre(setCommercialId)}
              icon={<UserRound className="h-4 w-4 text-muted-foreground" />}
              placeholder="Tous les commerciaux"
              searchPlaceholder="Rechercher un commercial…"
              options={commercialOptions}
            />
          </label>
        </CardContent>
      </Card>

      {/* Un seul indicateur de montant : toutes les lignes affichées sont
          impayées, donc « acquis » et « reste à payer » diraient le même chiffre. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Carte
          label="Reste à payer"
          valeur={fcfa(reste)}
          hint={`${lignes.length} commission(s) en attente`}
          icone={<AlertCircle className="h-5 w-5" />}
          alerte={reste > 0}
        />
        <Carte
          label="Commerciaux concernés"
          valeur={String(new Set(lignes.map((l) => l.commercial_id)).size)}
          icone={<UserRound className="h-5 w-5" />}
        />
      </div>

      {/* Règlement groupé de tout ce qui est impayé sur le périmètre affiché.
          Ambre et non rouge : un impayé n'est pas une anomalie, c'est une étape. */}
      {lignes.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <BadgeCheck className="h-5 w-5 shrink-0 text-amber-500" />
            <p className="text-sm">
              <span className="font-semibold text-amber-600">
                {lignes.length} commission(s) en attente
              </span>{" "}
              <span className="text-muted-foreground">— {fcfa(reste)} à régler</span>
            </p>
            <Button
              className="ml-auto"
              disabled={regler.isPending}
              onClick={() => void validerPaiement(lignes.map((l) => l.payment_id))}
            >
              {regler.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <BadgeCheck className="h-4 w-4 mr-2" />
              )}
              Tout marquer payé ({lignes.length})
            </Button>
          </CardContent>
        </Card>
      )}

      {retour && (
        <p className={`text-sm ${retour.kind === "ok" ? "text-emerald-600" : "text-amber-600"}`}>
          {retour.text}
        </p>
      )}

      {chargement ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : erreur ? (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-500">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{erreur.message ?? "Impossible de charger les commissions."}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">Commissions en attente</span>
              <span className="text-xs text-muted-foreground">{lignes.length} ligne(s)</span>
              {selection.length > 0 && (
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={regler.isPending}
                  onClick={() => void validerPaiement(selection)}
                >
                  {regler.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <BadgeCheck className="h-4 w-4 mr-2" />
                  )}
                  Marquer payé — {selection.length} ligne(s), {fcfa(montantSelection)}
                </Button>
              )}
            </div>

            {lignes.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Aucune commission en attente — tout est réglé.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-2 w-8">
                          <input
                            type="checkbox"
                            checked={toutesCochees}
                            disabled={pageItems.length === 0}
                            onChange={basculeTout}
                            title="Tout cocher sur cette page"
                          />
                        </th>
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Commercial</th>
                        <th className="py-2 pr-3">Au titre de</th>
                        <th className="py-2 pr-3 text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pageItems.map((l) => (
                        <tr
                          key={l.payment_id}
                          className={
                            selection.includes(l.payment_id)
                              ? "bg-primary/10"
                              : "hover:bg-accent/40"
                          }
                        >
                          <td className="py-2 pr-2">
                            <input
                              type="checkbox"
                              checked={selection.includes(l.payment_id)}
                              onChange={() => bascule(l.payment_id)}
                              title="Sélectionner"
                            />
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(l.paiement_le)}</td>
                          <td className="py-2 pr-3 font-medium">{l.commercial_nom}</td>
                          {/* Ce que la commission rémunère : l'étudiant amené. Le
                              montant qu'il a versé, lui, ne regarde pas cet écran. */}
                          <td className="py-2 pr-3 text-muted-foreground">{l.student_nom}</td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold text-indigo-600">
                            {fcfa(l.commission)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Lignes par page</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => changeFiltre(setPageSize)(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[4.5rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZES.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span>
                      {firstIndex + 1}–{firstIndex + pageItems.length} sur {lignes.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={currentPage <= 1}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Précédent
                    </Button>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      Page {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Suivant
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Carte({
  label,
  valeur,
  hint,
  icone,
  alerte,
}: {
  label: string;
  valeur: string;
  hint?: string;
  icone: React.ReactNode;
  alerte?: boolean;
}) {
  return (
    <Card className={alerte ? "border-amber-500/40" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className={alerte ? "text-amber-500" : "text-indigo-500"}>{icone}</span>
        </div>
        <div className={`text-2xl font-bold mt-1 ${alerte ? "text-amber-600" : ""}`}>{valeur}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}
