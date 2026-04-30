"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { updateRSOInstallation, RSOInstallation, UpdateRSOInstallationRequest } from "@/lib/rso/installations";

interface EditInstallationFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  installation: RSOInstallation | null;
}

export function EditInstallationForm({ open, onClose, onSuccess, installation }: EditInstallationFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<UpdateRSOInstallationRequest>({
    nom: "",
    code: "",
    ville: "",
    pays: "",
  });

  // Initialize form data when installation changes
  useEffect(() => {
    if (installation) {
      setFormData({
        nom: installation.nom,
        code: installation.code,
        ville: installation.ville,
        pays: installation.pays,
      });
      setError(null);
    }
  }, [installation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installation) return;

    setError(null);
    setLoading(true);

    try {
      await updateRSOInstallation(installation.id, formData);
      onSuccess();
      onClose();
    } catch (err: any) {
      const errorMessage = err.message || "Erreur lors de la modification de l'installation";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!installation) return null;

  const canSubmit =
    formData.nom &&
    formData.code &&
    formData.ville &&
    !loading;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier l'Installation</DialogTitle>
          <DialogDescription>
            Modifiez les informations de l'installation {installation.nom}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="nom">Nom *</Label>
            <Input
              id="nom"
              value={formData.nom}
              onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
              required
              placeholder="Port de commerce d'Abidjan"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Code *</Label>
            <Input
              id="code"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              required
              placeholder="ABJ-PORT"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ville">Ville *</Label>
              <Input
                id="ville"
                value={formData.ville}
                onChange={(e) => setFormData({ ...formData, ville: e.target.value })}
                required
                placeholder="Abidjan"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pays">Pays *</Label>
              <Input
                id="pays"
                value={formData.pays}
                onChange={(e) => setFormData({ ...formData, pays: e.target.value })}
                required
                placeholder="Côte d'Ivoire"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Annuler
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

