/**
 * FacturationGroupeeModal Component
 * 
 * Modal for generating grouped invoices with enrollment selection
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
import { Button, Label, Checkbox } from "@ecoledigitale/ui";
import { useGenerateFacturationGroupee } from "@/lib/hooks/use-entreprises";
import { Loader2 } from "lucide-react";
import { GenerateFacturationGroupeeRequest } from "@ecoledigitale/contracts/src/entreprises";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// Format currency helper
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XOF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

interface FacturationGroupeeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entrepriseId: string;
  inscriptions: Array<{
    id: string;
    numero_inscription: string;
    date_inscription: string;
    statut: string;
    montant_ttc: number;
    formation: string;
    session_code: string;
    apprenant: string;
  }>;
}

export function FacturationGroupeeModal({
  open,
  onOpenChange,
  entrepriseId,
  inscriptions,
}: FacturationGroupeeModalProps) {
  const [selectedInscriptions, setSelectedInscriptions] = useState<Set<string>>(new Set());
  const [dateEcheance, setDateEcheance] = useState<string>("");
  const generateMutation = useGenerateFacturationGroupee();

  // Calculate total for selected inscriptions
  const total = inscriptions
    .filter((inscription) => selectedInscriptions.has(inscription.id))
    .reduce((sum, inscription) => sum + inscription.montant_ttc, 0);

  const handleToggleInscription = (inscriptionId: string) => {
    const newSelected = new Set(selectedInscriptions);
    if (newSelected.has(inscriptionId)) {
      newSelected.delete(inscriptionId);
    } else {
      newSelected.add(inscriptionId);
    }
    setSelectedInscriptions(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedInscriptions.size === inscriptions.length) {
      setSelectedInscriptions(new Set());
    } else {
      setSelectedInscriptions(new Set(inscriptions.map((i) => i.id)));
    }
  };

  const handleGenerate = async () => {
    if (selectedInscriptions.size === 0) {
      return;
    }

    try {
      const request: GenerateFacturationGroupeeRequest = {
        inscription_ids: Array.from(selectedInscriptions),
        date_echeance: dateEcheance || undefined,
      };
      await generateMutation.mutateAsync({ entrepriseId, request });
      onOpenChange(false);
      setSelectedInscriptions(new Set());
      setDateEcheance("");
    } catch (error) {
      // Error handled by hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Générer une facture groupée</DialogTitle>
          <DialogDescription>
            Sélectionnez les inscriptions à inclure dans la facture groupée
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Select All */}
          <div className="flex items-center justify-between border-b pb-2">
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={selectedInscriptions.size === inscriptions.length && inscriptions.length > 0}
                onCheckedChange={handleSelectAll}
              />
              <span>Tout sélectionner ({inscriptions.length} inscriptions)</span>
            </Label>
            <div className="text-sm font-semibold">
              Total: {formatCurrency(total)}
            </div>
          </div>

          {/* Inscriptions List */}
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {inscriptions.map((inscription) => (
              <div
                key={inscription.id}
                className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50"
              >
                <Checkbox
                  checked={selectedInscriptions.has(inscription.id)}
                  onCheckedChange={() => handleToggleInscription(inscription.id)}
                />
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{inscription.formation}</p>
                      <p className="text-sm text-muted-foreground">
                        {inscription.apprenant} - {inscription.session_code}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(inscription.date_inscription), "dd MMMM yyyy", { locale: fr })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(inscription.montant_ttc)}</p>
                      <span className={`text-xs px-2 py-1 rounded ${
                        inscription.statut === "confirmee" ? "bg-green-100 text-green-800" :
                        inscription.statut === "en_attente" ? "bg-yellow-100 text-yellow-800" :
                        "bg-gray-100 text-gray-800"
                      }`}>
                        {inscription.statut}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Due Date */}
          <div>
            <Label>Date d'échéance (optionnel)</Label>
            <input
              type="date"
              value={dateEcheance}
              onChange={(e) => setDateEcheance(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded-md"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generateMutation.isPending}>
            Annuler
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || selectedInscriptions.size === 0}
          >
            {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Générer la facture ({selectedInscriptions.size} inscription{selectedInscriptions.size > 1 ? "s" : ""})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

