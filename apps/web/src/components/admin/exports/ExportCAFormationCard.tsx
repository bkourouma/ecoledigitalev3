/**
 * ExportCAFormationCard Component
 * 
 * Card for exporting revenue by training
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { TrendingUp, Download } from "lucide-react";
import { useCreateExportJob } from "@/lib/hooks/use-exports";
import { ExportJobStatusModal } from "./ExportJobStatusModal";
import { Loader2 } from "lucide-react";

export function ExportCAFormationCard() {
  const currentYear = new Date().getFullYear();
  const [annee, setAnnee] = useState(currentYear);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [jobId, setJobId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const createExport = useCreateExportJob();

  const handleExport = async () => {
    try {
      const jobIdResult = await createExport.mutateAsync({
        type: "ca_formation",
        request: {
          annee,
          format,
        },
      });
      setJobId(jobIdResult);
      setModalOpen(true);
    } catch (error) {
      // Error handled by hook
    }
  };

  // Generate year options (last 5 years to next year)
  const yearOptions = Array.from({ length: 7 }, (_, i) => currentYear - 5 + i);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Export CA par Formation
          </CardTitle>
          <CardDescription>
            Exportez le chiffre d'affaires par formation pour une année
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label>Année</Label>
            <Select value={annee.toString()} onValueChange={(value) => setAnnee(parseInt(value))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
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

