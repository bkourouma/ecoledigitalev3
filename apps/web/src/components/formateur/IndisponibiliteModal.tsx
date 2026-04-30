"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@ecoledigitale/ui";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Loader2 } from "lucide-react";
import { useCreateIndisponibilite } from "@/lib/hooks/use-formateur-schedule";
import { toast } from "sonner";

interface IndisponibiliteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IndisponibiliteModal({
  open,
  onOpenChange,
}: IndisponibiliteModalProps) {
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [raison, setRaison] = useState("");
  const createIndispo = useCreateIndisponibilite();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!dateDebut || !dateFin) {
      toast.error("Les dates de début et de fin sont requises");
      return;
    }

    if (new Date(dateFin) < new Date(dateDebut)) {
      toast.error("La date de fin doit être supérieure ou égale à la date de début");
      return;
    }

    try {
      await createIndispo.mutateAsync({
        date_debut: dateDebut,
        date_fin: dateFin,
        raison: raison || undefined,
      });

      toast.success("Indisponibilité ajoutée avec succès");
      // Reset form
      setDateDebut("");
      setDateFin("");
      setRaison("");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de l'ajout de l'indisponibilité"
      );
    }
  };

  const handleClose = () => {
    if (!createIndispo.isPending) {
      setDateDebut("");
      setDateFin("");
      setRaison("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle>Ajouter une indisponibilité</DialogTitle>
              <DialogDescription className="mt-2">
                Indiquez les dates pendant lesquelles vous ne serez pas disponible
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-8 w-8 p-0"
              disabled={createIndispo.isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="date_debut">Date de début *</Label>
            <Input
              id="date_debut"
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              required
              disabled={createIndispo.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date_fin">Date de fin *</Label>
            <Input
              id="date_fin"
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              required
              min={dateDebut}
              disabled={createIndispo.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="raison">Raison (optionnelle)</Label>
            <Textarea
              id="raison"
              value={raison}
              onChange={(e) => setRaison(e.target.value)}
              placeholder="Ex: Congé personnel, Formation..."
              maxLength={500}
              disabled={createIndispo.isPending}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {raison.length}/500 caractères
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createIndispo.isPending}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={createIndispo.isPending}>
              {createIndispo.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Ajouter
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

