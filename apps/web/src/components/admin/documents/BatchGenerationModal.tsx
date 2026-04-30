/**
 * BatchGenerationModal Component
 * 
 * Modal for batch generating documents (attestations)
 */

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input } from "@ecoledigitale/ui";
import { useBatchGenerateDocuments } from "@/lib/hooks/use-documents";
import { Loader2 } from "lucide-react";

interface BatchGenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BatchGenerationModal({ open, onOpenChange }: BatchGenerationModalProps) {
  const [sessionId, setSessionId] = useState("");
  const [documentType, setDocumentType] = useState<"attestation_presence" | "attestation_reussite">(
    "attestation_presence"
  );

  const batchGenerate = useBatchGenerateDocuments();

  const handleGenerate = async () => {
    try {
      await batchGenerate.mutateAsync({
        session_id: sessionId,
        type: documentType,
      });
      onOpenChange(false);
      setSessionId("");
    } catch (error) {
      // Error handled by hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Génération en masse</DialogTitle>
          <DialogDescription>
            Générez des attestations pour tous les participants présents d'une session terminée.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label>Type de document</Label>
            <Select
              value={documentType}
              onValueChange={(value) =>
                setDocumentType(value as "attestation_presence" | "attestation_reussite")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="attestation_presence">Attestation de Présence</SelectItem>
                <SelectItem value="attestation_reussite">Attestation de Réussite</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>ID Session</Label>
            <Input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="UUID de la session"
            />
            <p className="text-sm text-muted-foreground mt-1">
              La session doit être terminée et les présences doivent être marquées.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={batchGenerate.isPending}>
            Annuler
          </Button>
          <Button onClick={handleGenerate} disabled={!sessionId || batchGenerate.isPending}>
            {batchGenerate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Générer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

