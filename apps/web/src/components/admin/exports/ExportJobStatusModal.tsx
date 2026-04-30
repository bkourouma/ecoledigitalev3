/**
 * ExportJobStatusModal Component
 * 
 * Modal displaying export job progress with polling and download link
 */

"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Progress } from "@ecoledigitale/ui";
import { useExportJobStatus, downloadExportFile } from "@/lib/hooks/use-exports";
import { Loader2, Download, CheckCircle2, XCircle } from "lucide-react";
import { useEffect } from "react";

interface ExportJobStatusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string | null;
}

export function ExportJobStatusModal({ open, onOpenChange, jobId }: ExportJobStatusModalProps) {
  const { data: job, isLoading } = useExportJobStatus(jobId);

  useEffect(() => {
    if (job?.status === "completed" || job?.status === "failed") {
      // Auto-close after 5 seconds if completed or failed
      const timer = setTimeout(() => {
        if (job.status === "completed") {
          onOpenChange(false);
        }
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [job?.status, onOpenChange]);

  const handleDownload = async () => {
    if (jobId && job?.fichier_url) {
      try {
        await downloadExportFile(jobId);
      } catch (error) {
        // Error handled in hook
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Statut de l'export</DialogTitle>
          <DialogDescription>
            Suivi de la progression de votre export
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isLoading && !job ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : job ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Statut</span>
                  <div className="flex items-center gap-2">
                    {job.status === "completed" && (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <span className="text-sm text-green-600">Terminé</span>
                      </>
                    )}
                    {job.status === "failed" && (
                      <>
                        <XCircle className="h-5 w-5 text-red-600" />
                        <span className="text-sm text-red-600">Échec</span>
                      </>
                    )}
                    {(job.status === "pending" || job.status === "processing") && (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <span className="text-sm">
                          {job.status === "pending" ? "En attente" : "En cours"}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {(job.status === "pending" || job.status === "processing") && (
                  <Progress value={job.progress} className="h-2" />
                )}

                {job.status === "failed" && job.error_message && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-800">{job.error_message}</p>
                  </div>
                )}

                {job.status === "completed" && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                    <p className="text-sm text-green-800">
                      Votre export est prêt à être téléchargé.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Aucune information disponible</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {job?.status === "completed" && job.fichier_url && (
            <Button onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Télécharger
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {job?.status === "completed" ? "Fermer" : "Annuler"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

