"use client";

import { useEffect, useMemo, useState } from "react";
import { Receipt, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExportCsvButton } from "@/components/owner/charts/ExportCsvButton";
import { formatFcfa } from "@/components/owner/charts/palette";
import {
  buildCashRegisterQuery,
  useOwnerCashRegister,
  type TresorerieFilters,
} from "@/lib/hooks/use-owner-tresorerie";

/**
 * Journal de caisse — la pièce de contrôle interne et d'audit.
 *
 * POURQUOI CE COMPOSANT EST SORTI DE L'ÉCRAN DES IMPAYÉS
 *
 * Il y vivait par accident d'histoire : les deux lisent `professional_payments`.
 * Mais les Impayés répondent à « qu'est-ce qui n'est PAS rentré », et le journal
 * à « qu'est-ce qui EST rentré, ligne par ligne ». Le comptable qui vient
 * chercher sa pièce justificative n'a aucune raison de passer par un écran de
 * relance — et celui qui relance n'a que faire d'un journal de 25 lignes.
 *
 * Il est donc partagé, et non recopié : un journal qui divergerait d'un écran à
 * l'autre ne serait plus une pièce comptable.
 *
 * CE QUE LE LIBELLÉ DOIT DIRE, ET QUE L'ON N'INVENTE PAS
 *
 * Chaque ligne est datée au VERSEMENT, quand les agrégats des écrans d'argent
 * sont rattachés à l'année de la classe ouverte. Les deux totaux peuvent donc
 * légitimement différer sans qu'aucun soit faux. Le taire ferait passer une
 * différence normale pour une erreur de caisse.
 */

export type JournalDeCaisseProps = {
  /** Périmètre affiché par l'écran hôte : le journal ne s'en écarte jamais. */
  filters: TresorerieFilters;
  /**
   * Nom de fichier de l'export. L'écran hôte le compose, parce que lui seul
   * sait de quelle période il parle.
   */
  exportFilename: string;
};

export function JournalDeCaisse({ filters, exportFilename }: JournalDeCaisseProps) {
  const [page, setPage] = useState(1);
  // Changer de période ou de filière change le nombre de pages : rester en
  // page 7 afficherait un tableau vide sans expliquer pourquoi.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const journalFilters = useMemo(
    () => ({ ...filters, search: search || undefined, page, pageSize: 25 }),
    [filters, search, page]
  );
  const journal = useOwnerCashRegister(journalFilters);

  /** Export : tout le périmètre affiché, sans la pagination. */
  const exportQuery = useMemo(
    () => `${buildCashRegisterQuery({ ...journalFilters, page: undefined })}&format=csv`,
    [journalFilters]
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" />
            Journal de caisse
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Reçus émis sur la période — pièce de contrôle interne et d&apos;audit.{" "}
            {journal.data
              ? `${journal.data.totalCount} encaissement(s), ${formatFcfa(journal.data.totalAmount)} au total.`
              : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Daté à la date du versement, alors que les montants des autres blocs sont rattachés
            à l&apos;année de la classe ouverte : les deux totaux peuvent différer sans que
            l&apos;un des deux soit faux.
          </p>
        </div>
        <ExportCsvButton
          endpoint="/api/v1/owner/tresorerie/journal"
          queryString={exportQuery}
          filename={exportFilename}
          label="Exporter le journal"
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(searchInput);
          }}
        >
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Étudiant, matricule, n° de reçu…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Rechercher dans le journal de caisse"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Rechercher
          </Button>
        </form>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reçu</TableHead>
                <TableHead>Étudiant</TableHead>
                <TableHead>Filière</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!journal.data || journal.data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    {journal.isLoading ? "Chargement…" : "Aucun encaissement sur cette période."}
                  </TableCell>
                </TableRow>
              ) : (
                journal.data.rows.map((r) => (
                  <TableRow key={r.paymentId}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(r.paidAt).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.receiptNumber ?? (
                        <span className="text-red-600" title="Encaissement sans numéro de reçu">
                          manquant
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.studentName}</div>
                      {r.matricule && (
                        <div className="font-mono text-xs text-muted-foreground">
                          {r.matricule}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.filiereName ?? "—"}</TableCell>
                    <TableCell>{r.modeLabel}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatFcfa(r.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {journal.data && journal.data.totalCount > journal.data.pageSize && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {(journal.data.page - 1) * journal.data.pageSize + 1}–
              {Math.min(journal.data.page * journal.data.pageSize, journal.data.totalCount)} sur{" "}
              {journal.data.totalCount}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * journal.data.pageSize >= journal.data.totalCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Le journal ne dit pas qui a encaissé : <code>professional_payments</code> ne stocke pas
          l&apos;auteur de la saisie.
        </p>
      </CardContent>
    </Card>
  );
}
