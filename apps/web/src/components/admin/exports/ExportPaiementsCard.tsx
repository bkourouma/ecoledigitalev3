/**
 * ExportPaiementsCard Component
 * 
 * Card for configuring and exporting payments
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Label, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { DollarSign, Download } from "lucide-react";
import { useCreateExportJob } from "@/lib/hooks/use-exports";
import { ExportJobStatusModal } from "./ExportJobStatusModal";
import { Loader2 } from "lucide-react";

export function ExportPaiementsCard() {
  const [filters, setFilters] = useState({
    date_debut: "",
    date_fin: "",
    methode: "",
    statut: "",
  });
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [grouperPar, setGrouperPar] = useState<"methode" | "jour" | "formation" | undefined>(undefined);
  const [jobId, setJobId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const createExport = useCreateExportJob();

  const handleExport = async () => {
    try {
      const jobIdResult = await createExport.mutateAsync({
        type: "paiements",
        request: {
          filters: {
            date_debut: filters.date_debut || undefined,
            date_fin: filters.date_fin || undefined,
            methode: filters.methode || undefined,
            statut: filters.statut || undefined,
          },
          format,
          grouper_par: grouperPar,
        },
      });
      setJobId(jobIdResult);
      setModalOpen(true);
    } catch (error) {
      // Error handled by hook
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Export des Paiements
          </CardTitle>
          <CardDescription>
            Exportez les paiements avec filtres et regroupement optionnel
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filters */}
          <div className="space-y-4">
            <h3 className="font-semibold">Filtres</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Date début</Label>
                <Input
                  type="date"
                  value={filters.date_debut}
                  onChange={(e) => setFilters({ ...filters, date_debut: e.target.value })}
                />
              </div>
              <div>
                <Label>Date fin</Label>
                <Input
                  type="date"
                  value={filters.date_fin}
                  onChange={(e) => setFilters({ ...filters, date_fin: e.target.value })}
                />
              </div>
              <div>
                <Label>Méthode de paiement</Label>
                <Select value={filters.methode} onValueChange={(value) => setFilters({ ...filters, methode: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Toutes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Toutes</SelectItem>
                    <SelectItem value="orange_money">Orange Money</SelectItem>
                    <SelectItem value="mtn_money">MTN Money</SelectItem>
                    <SelectItem value="wave">Wave</SelectItem>
                    <SelectItem value="virement">Virement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Statut</Label>
                <Select value={filters.statut} onValueChange={(value) => setFilters({ ...filters, statut: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tous" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Tous</SelectItem>
                    <SelectItem value="valide">Validé</SelectItem>
                    <SelectItem value="en_attente">En attente</SelectItem>
                    <SelectItem value="echec">Échec</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Grouping */}
          <div className="space-y-4">
            <h3 className="font-semibold">Regroupement (optionnel)</h3>
            <Select value={grouperPar || ""} onValueChange={(value) => setGrouperPar(value ? (value as typeof grouperPar) : undefined)}>
              <SelectTrigger>
                <SelectValue placeholder="Aucun regroupement" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Aucun regroupement</SelectItem>
                <SelectItem value="methode">Par méthode de paiement</SelectItem>
                <SelectItem value="jour">Par jour</SelectItem>
                <SelectItem value="formation">Par formation</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Format */}
          <div>
            <Label>Format</Label>
            <Select value={format} onValueChange={(value) => setFormat(value as "xlsx" | "csv")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">Excel (XLSX)</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Export Button */}
          <Button
            onClick={handleExport}
            disabled={createExport.isPending}
            className="w-full"
          >
            {createExport.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Création de l'export...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Exporter
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Job Status Modal */}
      <ExportJobStatusModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        jobId={jobId}
      />
    </div>
  );
}

