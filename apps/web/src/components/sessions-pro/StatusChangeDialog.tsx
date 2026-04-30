"use client";

import { useState } from "react";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { Button, Label } from "@ecoledigitale/ui";
import { SessionProStatusSchema } from "@ecoledigitale/contracts/src/sessions-pro";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { createApiHeaders } from "@/lib/api-utils";

type SessionProStatus = z.infer<typeof SessionProStatusSchema>;

interface StatusChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus: SessionProStatus;
  sessionId: string;
  sessionCode: string;
  onSuccess?: () => void;
}

// Define valid status transitions
const validTransitions: Record<SessionProStatus, SessionProStatus[]> = {
  planifiee: ["ouverte", "annulee"],
  ouverte: ["complete", "en_cours", "annulee"],
  complete: ["en_cours", "annulee"],
  en_cours: ["terminee", "annulee"],
  terminee: [], // Terminal state
  annulee: [], // Terminal state
};

const statusLabels: Record<SessionProStatus, string> = {
  planifiee: "Planifiée",
  ouverte: "Ouverte",
  complete: "Complète",
  en_cours: "En cours",
  terminee: "Terminée",
  annulee: "Annulée",
};

export function StatusChangeDialog({
  open,
  onOpenChange,
  currentStatus,
  sessionId,
  sessionCode,
  onSuccess,
}: StatusChangeDialogProps) {
  const [selectedStatus, setSelectedStatus] = useState<SessionProStatus | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableStatuses = validTransitions[currentStatus] || [];

  const handleSubmit = async () => {
    if (!selectedStatus || selectedStatus === "") {
      toast.error("Veuillez sélectionner un nouveau statut");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/v1/admin/sessions-pro/${sessionId}/statut`, {
        method: "PATCH",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ statut: selectedStatus }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erreur lors du changement de statut");
      }

      toast.success(`Statut changé en "${statusLabels[selectedStatus]}" avec succès`);
      onOpenChange(false);
      setSelectedStatus("");
      onSuccess?.();
    } catch (error: any) {
      toast.error(error.message || "Erreur lors du changement de statut");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setSelectedStatus("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Changer le statut de la session</DialogTitle>
          <DialogDescription>
            Session: <strong>{sessionCode}</strong>
            <br />
            Statut actuel: <strong>{statusLabels[currentStatus]}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {availableStatuses.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Aucun changement de statut possible. Le statut "{statusLabels[currentStatus]}" est un état terminal.
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="status-select">Nouveau statut *</Label>
                <Select
                  value={selectedStatus}
                  onValueChange={(value) => setSelectedStatus(value as SessionProStatus)}
                >
                  <SelectTrigger id="status-select">
                    <SelectValue placeholder="Sélectionner un statut" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {statusLabels[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedStatus === "annulee" && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <strong>Attention :</strong> L'annulation de cette session déclenchera des notifications aux participants inscrits et pourra initier des remboursements si applicable.
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          {availableStatuses.length > 0 && (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !selectedStatus || selectedStatus === ""}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                "Confirmer"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

