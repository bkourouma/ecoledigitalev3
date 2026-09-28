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
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  RotateCcw,
  UserRound,
  Wallet,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openCommissionsHistoriquePdf } from "@/lib/utils/commissions-historique-report";
import {
  useCommerciaux,
  useDeleteVersement,
  useLignesCommission,
} from "@/lib/hooks/use-prospection";
import { formatAmountFCFA } from "@/lib/utils";

/**
 * Historique des commissions PAYÉES.
 *
 * Le pendant de « Commissions à payer » : une commission quitte cette liste-là
 * dès qu'elle est réglée, et arrive ici. Les deux écrans lisent la même source
 * — les lignes de commission — filtrée sur l'état, de sorte qu'aucune ligne ne
 * peut figurer dans les deux ni manquer aux deux.
 *
 * Annuler un règlement est possible : c'est le seul moyen de rattraper une
 * ligne cochée par erreur. Elle repart alors dans les impayées, rien n'est
 * perdu.
 */

const PAGE_SIZES = [10, 20, 50];
const TOUS = "__tous__";

const fmtDate = (d: string | null): string => {
  if (!d) return "—";
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
};

const fcfa = (n: number) => formatAmountFCFA(Math.round(n));

export default function CommissionsPayeesPage() {
  const [commercialId, setCommercialId] = useState(TOUS);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [retour, setRetour] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  const commerciauxQuery = useCommerciaux();
  const lignesQuery = useLignesCommission({
    commercial_id: commercialId === TOUS ? undefined : commercialId,
    statut: "regle",
  });
  const annuler = useDeleteVersement();

  const lignes = useMemo(() => lignesQuery.data ?? [], [lignesQuery.data]);
  const total = lignes.reduce((s, l) => s + l.commission, 0);

  /** Ce qui a été payé à chaque commercial, sur le périmètre affiché. */
  const parCommercial = useMemo(() => {
    const map = new Map<string, { nom: string; n: number; montant: number }>();
    for (const l of lignes) {
      const e = map.get(l.commercial_id) ?? { nom: l.commercial_nom, n: 0, montant: 0 };
      e.n += 1;
      e.montant += l.commission;
      map.set(l.commercial_id, e);
    }
    return [...map.values()].sort((a, b) => b.montant - a.montant);
  }, [lignes]);

  const commercialOptions = [
    { value: TOUS, label: "Tous les commerciaux" },
    ...(commerciauxQuery.data ?? []).map((c) => ({ value: c.id, label: c.nom })),
  ];

  const nomCommercial =
    commercialId === TOUS
      ? "Tous les commerciaux"
      : ((commerciauxQuery.data ?? []).find((c) => c.id === commercialId)?.nom ?? "—");

  const totalPages = Math.max(1, Math.ceil(lignes.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * pageSize;
  const pageItems = lignes.slice(firstIndex, firstIndex + pageSize);

  async function annulerReglement(reglementId: string | null, nom: string, montant: number) {
    if (!reglementId) return;
    if (
      !window.confirm(
        `Annuler le règlement de ${fcfa(montant)} à ${nom} ?\n\n` +
          "La commission repartira dans les impayées."
      )
    ) {
      return;
    }
    setRetour(null);
    try {
      await annuler.mutateAsync(reglementId);
      setRetour({ kind: "ok", text: "Règlement annulé : la commission est repassée en impayée." });
    } catch (error) {
      setRetour({ kind: "warn", text: (error as Error).message });
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div>
          <Link
            href="/professionnel/admin/prospection/commissions/historique"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Commissions à payer
          </Link>
          <h1 className="whitespace-nowrap mt-2 font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 text-2xl leading-tight md:text-3xl">
            <History className="h-7 w-7 text-indigo-500" />
            Historique des commissions payées
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Tous les règlements enregistrés, du plus récent au plus ancien.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButtons
            formats={["pdf"]}
            disabled={lignesQuery.isLoading || lignes.length === 0}
            onError={(text) => setRetour({ kind: "warn", text })}
            onExportPdf={(win) =>
              openCommissionsHistoriquePdf(
                lignes,
                { commercial: nomCommercial, statut: "Commissions payées" },
                win
              )
            }
          />
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <label className="flex flex-col gap-1 text-sm max-w-md">
            <span className="text-muted-foreground">Commercial</span>
            <SearchableSelect
              value={commercialId}
              onChange={(v) => {
                setCommercialId(v);
                setPage(1);
              }}
              icon={<UserRound className="h-4 w-4 text-muted-foreground" />}
              placeholder="Tous les commerciaux"
              searchPlaceholder="Rechercher un commercial…"
              options={commercialOptions}
            />
          </label>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total payé</span>
              <span className="text-indigo-500">
                <Wallet className="h-5 w-5" />
              </span>
            </div>
            <div className="text-2xl font-bold mt-1">{fcfa(total)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {lignes.length} commission(s) réglée(s)
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <span className="text-sm text-muted-foreground">Par commercial</span>
            {parCommercial.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {parCommercial.slice(0, 4).map((c) => (
                  <li key={c.nom} className="flex justify-between gap-3">
                    <span className="truncate">{c.nom}</span>
                    <span className="tabular-nums font-medium whitespace-nowrap">
                      {fcfa(c.montant)}
                    </span>
                  </li>
                ))}
                {parCommercial.length > 4 && (
                  <li className="text-xs text-muted-foreground">
                    +{parCommercial.length - 4} autre(s)
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {retour && (
        <p className={`text-sm ${retour.kind === "ok" ? "text-emerald-600" : "text-amber-600"}`}>
          {retour.text}
        </p>
      )}

      {lignesQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : lignesQuery.isError ? (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-500">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(lignesQuery.error as Error)?.message ?? "Impossible de charger l'historique."}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Règlements</span>
              <span className="text-xs text-muted-foreground">{lignes.length}</span>
            </div>

            {lignes.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Aucune commission payée pour l&apos;instant. Elles arrivent ici une fois réglées
                depuis{" "}
                <Link
                  href="/professionnel/admin/prospection/commissions/historique"
                  className="text-indigo-600 hover:underline"
                >
                  Commissions à payer
                </Link>
                .
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3">Payé le</th>
                        <th className="py-2 pr-3">Commercial</th>
                        <th className="py-2 pr-3">Au titre de</th>
                        <th className="py-2 pr-3 text-right">Commission</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pageItems.map((l) => (
                        <tr key={l.payment_id} className="hover:bg-accent/40">
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(l.regle_le)}</td>
                          <td className="py-2 pr-3 font-medium">{l.commercial_nom}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{l.student_nom}</td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold text-emerald-600">
                            {fcfa(l.commission)}
                          </td>
                          <td className="py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={annuler.isPending}
                              title="Annuler ce règlement"
                              onClick={() =>
                                void annulerReglement(l.reglement_id, l.commercial_nom, l.commission)
                              }
                            >
                              <RotateCcw className="h-4 w-4 text-amber-600" />
                            </Button>
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
                      onValueChange={(v) => {
                        setPageSize(Number(v));
                        setPage(1);
                      }}
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
