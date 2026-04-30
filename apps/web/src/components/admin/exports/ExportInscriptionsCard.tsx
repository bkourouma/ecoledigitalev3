/**
 * ExportInscriptionsCard Component
 * 
 * Card for configuring and exporting enrollments
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Label, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Checkbox } from "@ecoledigitale/ui";
import { FileSpreadsheet, Download } from "lucide-react";
import { useCreateExportJob } from "@/lib/hooks/use-exports";
import { ExportJobStatusModal } from "./ExportJobStatusModal";
import { Loader2 } from "lucide-react";

const availableColumns = [
  { id: "numero_inscription", label: "Numéro inscription" },
  { id: "date_inscription", label: "Date inscription" },
  { id: "statut", label: "Statut" },
  { id: "montant_ht", label: "Montant HT" },
  { id: "montant_ttc", label: "Montant TTC" },
  { id: "apprenant_nom", label: "Nom apprenant" },
  { id: "apprenant_prenom", label: "Prénom apprenant" },
  { id: "apprenant_email", label: "Email apprenant" },
  { id: "apprenant_telephone", label: "Téléphone apprenant" },
  { id: "formation", label: "Formation" },
  { id: "session_code", label: "Code session" },
  { id: "session_date_debut", label: "Date début session" },
  { id: "session_date_fin", label: "Date fin session" },
  { id: "entreprise", label: "Entreprise" },
];

export function ExportInscriptionsCard() {
  const [filters, setFilters] = useState({
    date_debut: "",
    date_fin: "",
    statut: "",
    formation_id: "",
    session_id: "",
  });
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "numero_inscription",
    "date_inscription",
    "apprenant_nom",
    "apprenant_prenom",
    "formation",
    "montant_ttc",
  ]);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [jobId, setJobId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const createExport = useCreateExportJob();

  const handleColumnToggle = (columnId: string) => {
    if (selectedColumns.includes(columnId)) {
      setSelectedColumns(selectedColumns.filter((id) => id !== columnId));
    } else {
      setSelectedColumns([...selectedColumns, columnId]);
    }
  };

  const handleExport = async () => {
    if (selectedColumns.length === 0) {
      return;
    }

    try {
      const jobIdResult = await createExport.mutateAsync({
        type: "inscriptions",
        request: {
          filters: {
            date_debut: filters.date_debut || undefined,
            date_fin: filters.date_fin || undefined,
            statut: filters.statut || undefined,
            formation_id: filters.formation_id || undefined,
            session_id: filters.session_id || undefined,
          },
          format,
          colonnes: selectedColumns,
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
            <FileSpreadsheet className="h-5 w-5" />
            Export des Inscriptions
          </CardTitle>
          <CardDescription>
            Configurez les filtres et sélectionnez les colonnes à exporter
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
                <Label>Statut</Label>
                <Select value={filters.statut} onValueChange={(value) => setFilters({ ...filters, statut: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tous" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Tous</SelectItem>
                    <SelectItem value="en_attente">En attente</SelectItem>
                    <SelectItem value="confirmee">Confirmée</SelectItem>
                    <SelectItem value="annulee">Annulée</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
            </div>
          </div>

          {/* Column Selection */}
          <div className="space-y-4">
            <h3 className="font-semibold">Colonnes à exporter</h3>
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto border rounded-md p-4">
              {availableColumns.map((column) => (
                <div key={column.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedColumns.includes(column.id)}
                    onCheckedChange={() => handleColumnToggle(column.id)}
                  />
                  <Label className="text-sm">{column.label}</Label>
                </div>
              ))}
            </div>
          </div>

          {/* Export Button */}
          <Button
            onClick={handleExport}
            disabled={createExport.isPending || selectedColumns.length === 0}
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

