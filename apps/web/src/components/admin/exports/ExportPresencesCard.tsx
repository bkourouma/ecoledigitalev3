/**
 * ExportPresencesCard Component
 * 
 * Card for exporting attendance for a session
 */

"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Calendar, Download } from "lucide-react";
import { useCreateExportJob } from "@/lib/hooks/use-exports";
import { ExportJobStatusModal } from "./ExportJobStatusModal";
import { Loader2 } from "lucide-react";

export function ExportPresencesCard() {
  const [sessionId, setSessionId] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const createExport = useCreateExportJob();

  const handleExport = async () => {
    if (!sessionId) return;

    try {
      const jobIdResult = await createExport.mutateAsync({
        type: "presences",
        request: {
          session_id: sessionId,
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
            <Calendar className="h-5 w-5" />
            Export des Présences
          </CardTitle>
          <CardDescription>
            Exportez les présences pour une session avec statistiques
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label>Session</Label>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner une session" />
              </SelectTrigger>
              <SelectContent>
                {/* TODO: Load sessions from API */}
                <SelectItem value="session-1">Session 1</SelectItem>
                <SelectItem value="session-2">Session 2</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground mt-2">
              Note: Les sessions seront chargées depuis l'API
            </p>
          </div>

          <Button
            onClick={handleExport}
            disabled={createExport.isPending || !sessionId}
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

